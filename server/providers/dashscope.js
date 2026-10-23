// 阿里百炼 DashScope provider：
// - SpeechSynthesizer 端点：qwen-audio-*-tts-* / cosyvoice-*（SSE 流式）
// - multimodal-generation 端点：qwen3-tts-*（SSE 流式）
// - customization 端点：list_voice（连通性测试 / 声音管理，M3 扩展）
// 域名策略：公共域名优先；配置了业务空间 WorkspaceId 时失败自动回退专属域名。
const log = require('../util/logger');

const PUBLIC_BASE = {
  'cn-beijing': 'https://dashscope.aliyuncs.com',
  'ap-southeast-1': 'https://dashscope-intl.aliyun.com',
};

const SPEECH_PATH = '/api/v1/services/audio/tts/SpeechSynthesizer';
const MULTIMODAL_PATH = '/api/v1/services/aigc/multimodal-generation/generation';
const CUSTOMIZATION_PATH = '/api/v1/services/audio/tts/customization';

class DashScopeError extends Error {
  constructor(status, code, message, requestId) {
    super(message || code || `DashScope HTTP ${status}`);
    this.status = status;
    this.code = code || `HTTP_${status}`;
    this.requestId = requestId || '';
  }
}

function candidateBases(settings) {
  const bases = [PUBLIC_BASE[settings.dashscope.region] || PUBLIC_BASE['cn-beijing']];
  const { normalizeWorkspaceId } = require('../config');
  const wsId = normalizeWorkspaceId(settings.dashscope.workspaceId);
  if (wsId && settings.dashscope.domainMode === 'workspace') {
    bases.unshift(`https://${wsId}.${settings.dashscope.region || 'cn-beijing'}.maas.aliyuncs.com`);
  }
  return [...new Set(bases)];
}

async function dsFetch(path, { method = 'POST', body, sse = false, signal } = {}) {
  const settings = require('../config').load();
  const apiKey = settings.dashscope.apiKey;
  if (!apiKey) throw new DashScopeError(401, 'NO_API_KEY', '未配置 DashScope API Key');

  let lastErr = null;
  for (const base of candidateBases(settings)) {
    try {
      log.info(`dsFetch try base=${base} path=${path}`);
      const headers = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      };
      if (sse) headers['X-DashScope-SSE'] = 'enable';
      const res = await fetch(base + path, { method, headers, body: JSON.stringify(body), signal });
      log.info(`dsFetch base=${base} -> HTTP ${res.status} ct=${res.headers.get('content-type')}`);
      if (!res.ok) {
        const err = await toError(res);
        // 业务空间专属域名对部分端点（如 multimodal-generation）不支持，返回空 400：
        // 凡 maas 域名的错误一律回退到公共域名再试一次（公共域名会给出真实结果或完整报错）
        if (base.includes('.maas.aliyuncs.com')) {
          lastErr = err;
          continue;
        }
        throw err;
      }
      return res;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      if (e instanceof DashScopeError && !isNetworkRetryable(e)) throw e;
      lastErr = e instanceof DashScopeError ? e : new DashScopeError(0, 'NETWORK_ERROR', String(e.message || e));
      if (String(lastErr.code).startsWith('HTTP_4') || String(lastErr.code).startsWith('HTTP_5')) {
        // 4xx/5xx 明确响应：除非来自 maas 域名，否则不换域名重试
        if (!isNetworkRetryable(lastErr)) throw lastErr;
      }
    }
  }
  throw lastErr || new DashScopeError(0, 'NETWORK_ERROR', '请求 DashScope 失败');
}

function isNetworkRetryable(err) {
  if (!err) return false;
  if (err.code === 'NETWORK_ERROR') return true;
  return [403, 404].includes(err.status);
}

async function toError(res) {
  let code = '', message = '', requestId = '';
  try {
    const raw = await res.text();
    try {
      const j = JSON.parse(raw);
      code = j.code || (j.error && j.error.code) || '';
      message = j.message || (j.error && j.error.message) || '';
      requestId = j.request_id || '';
    } catch {
      message = raw.slice(0, 300);
    }
  } catch { /* 响应体读取失败 */ }
  return new DashScopeError(res.status, code, message, requestId);
}

// 上游 SSE 解析：按 SSE 规范以空行分事件块，块内所有 data: 行拼接后整体 JSON.parse。
// 兼容两种上游格式：公共域名的单行紧凑 JSON；业务空间域名的多行 pretty JSON（每行都带 data: 前缀）。
// 注意：fetch 响应流迭代出的 chunk 是 Uint8Array，必须用 TextDecoder 解码，
// 不能用 chunk.toString('utf8')（那是 Array.toString，会变成逗号分隔的字节数字）。
async function* sseJson(res) {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream')) {
    // 上游未按 SSE 返回（如整体 JSON）：整体解析为一个事件
    const j = await res.json().catch(() => null);
    if (j) yield j;
    return;
  }
  const decoder = new TextDecoder();
  let buf = '';
  let block = ''; // 当前事件块累积的 data 载荷
  let chunkCount = 0;
  let parsedCount = 0;

  const emit = function* (payload) {
    const trimmed = payload.trim();
    if (!trimmed || trimmed === '[DONE]') return;
    try {
      parsedCount++;
      yield JSON.parse(trimmed);
    } catch { /* 坏块忽略 */ }
  };

  for await (const chunk of res.body) {
    chunkCount++;
    buf += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      if (line === '') {
        // 空行 = 事件边界，产出累积块
        if (block) {
          yield* emit(block);
          block = '';
        }
      } else if (line.startsWith('data:')) {
        block += (block ? '\n' : '') + line.slice(5).trimStart();
      }
      // 其余 id:/event:/:注释行忽略
    }
  }
  buf += decoder.decode();
  if (block) yield* emit(block);
  if (parsedCount === 0) {
    log.warn(`sseJson: 0 events parsed (chunks=${chunkCount}, content-type=${ct})`);
  }
}

function isMultimodalModel(model) {
  return /^qwen3-tts/.test(model);
}

/**
 * 语音合成（单段文本）。异步生成器产出归一化事件：
 *   { type: 'audio', data: <base64> }
 *   { type: 'done', url, requestId, usage }
 * 抛出的异常带 code/message/requestId。
 */
async function* synthesize({ model, text, voice, params = {}, signal }) {
  const input = { text, voice };
  let path;
  if (isMultimodalModel(model)) {
    path = MULTIMODAL_PATH;
    if (params.language_type && params.language_type !== 'Auto') input.language_type = params.language_type;
  } else {
    path = SPEECH_PATH;
    for (const key of ['format', 'sample_rate', 'volume', 'rate', 'pitch', 'bit_rate',
      'instruction', 'seed', 'enable_ssml', 'language_hints', 'word_timestamp_enabled']) {
      if (params[key] !== undefined && params[key] !== null && params[key] !== '') input[key] = params[key];
    }
    if (Array.isArray(input.language_hints) && input.language_hints.length === 0) delete input.language_hints;
  }

  const started = Date.now();
  const res = await dsFetch(path, { body: { model, input }, sse: true, signal });
  log.info(`dashscope ${model} chars=${text.length} voice=${voice} -> streaming`);

  let sawDone = false;
  for await (const evt of sseJson(res)) {
    if (evt.code && evt.code !== '200') {
      throw new DashScopeError(200, evt.code, evt.message, evt.request_id);
    }
    const out = evt.output || {};
    const audio = out.audio || {};
    // 词级时间戳（word_timestamp_enabled=true 时随句事件返回）
    const sent = out.sentence;
    if (sent && Array.isArray(sent.words) && sent.words.length) {
      yield { type: 'words', index: sent.index ?? 0, words: sent.words };
    }
    if (audio.data) yield { type: 'audio', data: audio.data };
    if (out.finish_reason === 'stop' || (out.finish_reason === undefined && audio.url && !audio.data)) {
      sawDone = true;
      yield {
        type: 'done',
        url: audio.url || '',
        requestId: evt.request_id || '',
        usage: evt.usage || null,
        elapsedMs: Date.now() - started,
      };
    }
  }
  if (!sawDone) {
    yield { type: 'done', url: '', requestId: '', usage: null, elapsedMs: Date.now() - started };
  }
}

/** 复刻/设计音色管理（声音复刻、声音设计、连通性测试共用） */
async function voiceEnrollment(action, input = {}, parameters) {
  const body = {
    model: 'voice-enrollment',
    input: { action, ...input },
    ...(parameters ? { parameters } : {}),
  };
  const res = await dsFetch(CUSTOMIZATION_PATH, { body });
  const json = await res.json();
  if (json.code && json.code !== '200') {
    throw new DashScopeError(200, json.code, json.message, json.request_id);
  }
  return json;
}

async function listVoices(prefix) {
  return voiceEnrollment('list_voice', prefix ? { prefix } : {});
}

// 拉取全部自定义音色（分页，最多 5 页；page_index 0/1 起点差异做兼容）
async function listAllVoices({ pageSize = 100, maxPages = 5 } = {}) {
  const all = [];
  let pageIndex = 0;
  for (let page = 0; page < maxPages; page++) {
    let r;
    try {
      r = await voiceEnrollment('list_voice', { page_index: pageIndex, page_size: pageSize });
    } catch (e) {
      // page_index 1-based 的实现：第 0 页报错时切到 1
      if (page === 0) {
        pageIndex = 1;
        r = await voiceEnrollment('list_voice', { page_index: pageIndex, page_size: pageSize });
      } else {
        throw e;
      }
    }
    const list = (r.output && r.output.voice_list) || [];
    all.push(...list);
    if (list.length < pageSize) break;
    pageIndex += 1;
  }
  // 去重
  const seen = new Set();
  return all.filter((v) => {
    const id = v.voice_id || v.voiceId;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function testConnection() {
  try {
    const r = await listVoices();
    if (r.status_code && r.status_code !== 200) {
      return { ok: false, message: r.message || `状态码 ${r.status_code}` };
    }
    const count = (r.output && r.output.voice_list || []).length;
    return { ok: true, message: `连接成功${count ? `，已有 ${count} 个自定义音色` : ''}` };
  } catch (e) {
    const msg = e.code === 'InvalidApiKey' || e.status === 401
      ? 'API Key 无效或未开通百炼服务'
      : e.code === 'NO_API_KEY' ? '未填写 API Key'
      : `${e.code || ''} ${e.message}`.trim();
    return { ok: false, message: msg, requestId: e.requestId };
  }
}

module.exports = { DashScopeError, synthesize, listVoices, listAllVoices, voiceEnrollment, testConnection };
