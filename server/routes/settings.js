const express = require('express');
const config = require('../config');
const dashscope = require('../providers/dashscope');
const runtime = require('../util/runtime');
const log = require('../util/logger');

const router = express.Router();

// 期望配置 + 实际运行状态（host/port 是启动时绑定的，改配置需重启）
function viewWithRuntime() {
  const v = config.publicView();
  const rt = runtime.get();
  v.server.effectiveHost = rt.host;
  v.server.effectivePort = rt.port;
  v.server.pendingRestart = Boolean(
    rt.host && (rt.host !== (v.server.lan ? '0.0.0.0' : '127.0.0.1') || rt.port !== v.server.port),
  );
  v.server.lanUrls = runtime.lanUrls();
  return v;
}

router.get('/', (req, res) => {
  res.json(viewWithRuntime());
});

// 部分更新；空字符串 Key 视为"不修改"；accessToken 传空串表示清除
router.put('/', (req, res) => {
  const p = req.body || {};
  const patch = {};

  if (p.dashscope) {
    patch.dashscope = {};
    if (p.dashscope.apiKey) patch.dashscope.apiKey = String(p.dashscope.apiKey).trim();
    if (p.dashscope.region) patch.dashscope.region = p.dashscope.region;
    if (p.dashscope.domainMode) patch.dashscope.domainMode = p.dashscope.domainMode;
    if (p.dashscope.workspaceId !== undefined) patch.dashscope.workspaceId = String(p.dashscope.workspaceId).trim();
  }
  if (p.preferences) patch.preferences = p.preferences;
  if (p.server) {
    patch.server = {};
    if (p.server.lan !== undefined) patch.server.lan = Boolean(p.server.lan);
    if (p.server.accessToken !== undefined) patch.server.accessToken = String(p.server.accessToken).trim();
    if (p.server.port) patch.server.port = Number(p.server.port) || 3210;
  }

  config.save(patch);
  log.info('settings updated:', Object.keys(patch).join(','));
  res.json(viewWithRuntime());
});

// 连通性测试（DashScope）
router.post('/test', async (req, res) => {
  const result = await dashscope.testConnection();
  res.json(result);
});

module.exports = router;
