const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const log = require('./util/logger');
const runtime = require('./util/runtime');

const app = express();
app.use(express.json({ limit: '32mb' })); // 复刻音频 base64 上传留量

// ---- API ----
// 健康检查保持公开：局域网设备靠它获知"是否需要令牌"，再弹窗索取
app.get('/api/health', (req, res) => {
  const s = config.load().server;
  res.json({
    ok: true,
    ts: Date.now(),
    host: runtime.get().host,
    port: runtime.get().port,
    lan: runtime.get().host === '0.0.0.0',
    tokenRequired: Boolean(s.accessToken),
    lanUrls: runtime.lanUrls(),
  });
});

// 访问令牌校验：设置后所有 /api（除 /health）需带 X-AliTTS-Token 头、
// Authorization: Bearer 或 ?token= 查询参数（音频 <audio src> 走查询参数）
app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  const token = config.load().server.accessToken;
  if (!token) return next();
  const auth = req.get('authorization') || '';
  const provided = req.get('x-alitts-token') || auth.replace(/^Bearer\s+/i, '') || req.query.token;
  if (provided === token) return next();
  return res.status(401).json({ error: { code: 'TOKEN_REQUIRED', message: '此服务已启用访问令牌，请提供正确的令牌' } });
});

app.use('/api/settings', require('./routes/settings'));
app.use('/api/tts', require('./routes/tts'));
app.use('/api/voices', require('./routes/voices'));
app.use('/api/audio', express.static(store_audioDir(), { fallthrough: false }));

function store_audioDir() {
  return require('./util/store').AUDIO_DIR;
}

// API 错误统一处理
app.use('/api', (err, req, res, next) => {
  log.error('api error:', req.method, req.path, err.message);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: { code: 'SERVER_ERROR', message: err.message } });
});

// ---- 前端静态托管（构建产物）----
const DIST = path.join(__dirname, '..', 'web', 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  // SPA 回退：非 /api 路径交给前端路由
  app.get(/^(?!\/api\/).*/, (req, res) => {
    res.sendFile(path.join(DIST, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.type('text/plain').send('AliTTS server is running.\n前端尚未构建：请先执行 npm run build（开发期可直接访问 Vite 开发服务器 http://127.0.0.1:5173）。');
  });
}

const settings = config.load();
const host = settings.server.lan ? '0.0.0.0' : '127.0.0.1';
const port = settings.server.port;
app.listen(port, host, () => {
  runtime.set(host, port);
  log.info(`AliTTS server listening on http://${host}:${port}`);
  if (settings.server.accessToken) log.info('access token protection: ON');
  if (!fs.existsSync(DIST)) log.warn('web/dist 不存在：开发期请用 npm run dev，或先 npm run build');
});
