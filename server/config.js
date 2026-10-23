const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.ALITTS_DATA_DIR || path.join(__dirname, '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');

for (const dir of [DATA_DIR, AUDIO_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const DEFAULT_SETTINGS = {
  dashscope: {
    apiKey: '',
    region: 'cn-beijing', // cn-beijing | ap-southeast-1
    domainMode: 'public', // public | workspace
    workspaceId: '',
  },
  preferences: {
    defaultFormat: 'mp3',
    defaultSampleRate: 24000,
    theme: 'auto', // light | dark | auto
    chunkLimit: 600,
  },
  server: {
    port: Number(process.env.PORT) || 3210,
    lan: false,
    accessToken: '',
  },
};

let cached = null;

function load() {
  if (cached) return cached;
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    cached = deepMerge(structuredClone(DEFAULT_SETTINGS), raw);
  } catch {
    cached = structuredClone(DEFAULT_SETTINGS);
  }
  // OpenRouter 备份通道已于 v1.2 移除：清除磁盘上残留的旧配置（含 Key）
  delete cached.openrouter;
  return cached;
}

function deepMerge(base, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof base[k] === 'object' && base[k] !== null) {
      deepMerge(base[k], v);
    } else if (v !== undefined) {
      base[k] = v;
    }
  }
  return base;
}

// 业务空间 ID 清洗：用户常误粘完整 URL（https://llm-xxx.cn-beijing.maas.aliyuncs.com/compatible-mode/v1），
// 统一提取纯 slug（如 llm-xxx），避免拼出无效域名
function normalizeWorkspaceId(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/^https?:\/\//i, ''); // 去协议
  s = s.split('/')[0];                // 去路径
  s = s.split('?')[0].split('#')[0];  // 去查询串/锚点
  s = s.split('.')[0];                // 去域名后缀（workspace slug 本身不含点）
  return s;
}

// 原子写：先写临时文件再替换，避免写一半损坏
function save(patch) {
  const next = deepMerge(load(), patch || {});
  if (next.dashscope.workspaceId) {
    next.dashscope.workspaceId = normalizeWorkspaceId(next.dashscope.workspaceId);
  }
  const tmp = SETTINGS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, SETTINGS_FILE);
  cached = next;
  return next;
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return key.slice(0, 2) + '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

function isConfigured() {
  return Boolean(load().dashscope.apiKey);
}

// 给前端的视图：不含明文 Key
function publicView() {
  const s = load();
  return {
    configured: isConfigured(),
    dashscope: {
      hasKey: Boolean(s.dashscope.apiKey),
      maskedKey: maskKey(s.dashscope.apiKey),
      region: s.dashscope.region,
      domainMode: s.dashscope.domainMode,
      workspaceId: s.dashscope.workspaceId,
    },
    preferences: s.preferences,
    server: { port: s.server.port, lan: s.server.lan, accessTokenSet: Boolean(s.server.accessToken) },
  };
}

module.exports = {
  DATA_DIR,
  HISTORY_FILE,
  AUDIO_DIR,
  load,
  save,
  isConfigured,
  publicView,
  normalizeWorkspaceId,
};
