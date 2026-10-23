const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const dashscope = require('../providers/dashscope');
const { initSSE, sendEvent, endSSE } = require('../util/sse');
const { splitText } = require('../util/chunker');
const wavutil = require('../util/wav');
const store = require('../util/store');
const log = require('../util/logger');

const router = express.Router();

// 允许的音频格式 -> 扩展名 / mime
const FORMATS = {
  mp3: { ext: 'mp3', mime: 'audio/mpeg' },
  wav: { ext: 'wav', mime: 'audio/wav' },
  pcm: { ext: 'pcm', mime: 'audio/L16' },
  opus: { ext: 'opus', mime: 'audio/ogg' },
};

router.post('/', async (req, res) => {
  const { model, text, voice, params = {}, templateId = '' } = req.body || {};
  if (!config.isConfigured()) {
    return res.status(400).json({ error: { code: 'NOT_CONFIGURED', message: '请先完成首次运行配置' } });
  }
  if (!model || !voice || !text || !String(text).trim()) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: '缺少 model / voice / text' } });
  }

  const format = FORMATS[params.format] ? params.format : (config.load().preferences.defaultFormat || 'mp3');
  const isMultimodal = /^qwen3-tts/.test(model);
  // multimodal 端点固定返回 24kHz WAV，与请求参数无关，按实际产物落盘
  const effectiveFormat = isMultimodal ? 'wav' : format;
  // SSML 必须一次性完整提交（上游不支持分段），此时不做文本切分
  const ssmlMode = Boolean(params.enable_ssml);
  // qwen3-tts 有 600 字符硬限制，强制分段
  const chunkLimit = ssmlMode ? Number.MAX_SAFE_INTEGER
    : isMultimodal ? 600
    : Number(config.load().preferences.chunkLimit) || 100000;
  const chunks = splitText(String(text), chunkLimit);

  initSSE(res);
  const ac = new AbortController();
  // 注意：不能用 req 的 close（请求体读完后即触发），要用响应 close 且未正常结束时才算客户端断开
  res.on('close', () => {
    if (!res.writableEnded) ac.abort();
  });

  sendEvent(res, {
    type: 'meta',
    model, voice, format: effectiveFormat,
    sampleRate: isMultimodal ? 24000 : (params.sample_rate || null),
    chunks: chunks.length,
    chars: String(text).length,
    // 单段 wav/pcm 可被前端流式边收边播（多段拼接的中间流含多个文件头，不可直接播）
    streamable: chunks.length === 1 && ['wav', 'pcm'].includes(effectiveFormat),
  });

  const segmentBuffers = []; // 每段完整文件（多段合并用）
  const started = Date.now();
  let requestId = '';
  const wordMap = new Map(); // sentence index -> words，去重取后值

  try {
    for (let i = 0; i < chunks.length; i++) {
      if (chunks.length > 1) {
        sendEvent(res, { type: 'progress', chunk: i + 1, total: chunks.length });
      }
      const segParts = [];
      for await (const evt of dashscope.synthesize({
        model, text: chunks[i], voice, params: { ...params, format }, signal: ac.signal,
      })) {
        if (evt.type === 'audio') {
          segParts.push(Buffer.from(evt.data, 'base64'));
          sendEvent(res, { type: 'audio', data: evt.data });
        } else if (evt.type === 'words') {
          const key = `c${i}-s${evt.index}`;
          wordMap.set(key, evt.words);
          sendEvent(res, { type: 'words', chunk: i, index: evt.index, words: evt.words });
        } else if (evt.type === 'done') {
          requestId = requestId || evt.requestId;
        }
      }
      segmentBuffers.push(Buffer.concat(segParts));
    }

    // 多段 wav/pcm 需要正确合并（剥离各段文件头 + 段间静音），mp3/opus 帧流直接拼接
    const silenceMs = Math.min(1000, Math.max(0, Number(params.segment_silence_ms) || 0));
    const buffer = chunks.length > 1 && ['wav', 'pcm'].includes(effectiveFormat)
      ? wavutil.mergeSegments(segmentBuffers, effectiveFormat, silenceMs, Number(params.sample_rate) || 24000)
      : Buffer.concat(segmentBuffers);
    const { fileId, bytes } = store.saveAudio(buffer, effectiveFormat);
    const wordTimeline = [];
    for (const [key, words] of wordMap) wordTimeline.push({ key, words });
    const record = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      provider: 'dashscope',
      model, voice, templateId,
      text: String(text),
      params: { ...params, format: effectiveFormat },
      file: fileId,
      bytes, chars: String(text).length,
      elapsedMs: Date.now() - started,
      requestId,
      ...(wordTimeline.length ? { wordTimeline } : {}),
    };
    store.addRecord(record);
    log.info(`tts done model=${model} voice=${voice} chars=${record.chars} bytes=${bytes} ${record.elapsedMs}ms`);

    sendEvent(res, {
      type: 'done',
      historyId: record.id,
      fileId,
      url: `/api/audio/${fileId}`,
      mime: FORMATS[effectiveFormat].mime,
      bytes, elapsedMs: record.elapsedMs, requestId,
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      log.info('tts aborted by client');
      sendEvent(res, { type: 'aborted' });
    } else {
      log.error('tts failed:', e.code || '', e.message, e.requestId || '');
      sendEvent(res, {
        type: 'error',
        code: e.code || 'TTS_FAILED',
        message: friendlyError(e),
        requestId: e.requestId || '',
      });
    }
  } finally {
    endSSE(res);
  }
});

function friendlyError(e) {
  const map = {
    InvalidApiKey: 'API Key 无效',
    NO_API_KEY: '未配置 API Key',
    Throttling: '请求过于频繁，请稍后重试',
    Arrearage: '账户欠费或额度不足',
    InvalidParameter: '参数错误（音色与模型不匹配时会报此错误）',
  };
  return map[e.code] || `${e.message || '合成失败'}${e.code && e.code !== 'NETWORK_ERROR' ? `（${e.code}）` : ''}`;
}

router.get('/history', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json({ items: store.loadHistory().slice(0, limit), total: store.loadHistory().length });
});

router.delete('/history', (req, res) => {
  store.clearHistory();
  res.json({ ok: true });
});

router.delete('/history/:id', (req, res) => {
  const ok = store.removeRecord(req.params.id);
  res.json({ ok });
});

module.exports = router;
