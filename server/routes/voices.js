const express = require('express');
const dashscope = require('../providers/dashscope');
const registry = require('../util/voiceRegistry');
const log = require('../util/logger');

const router = express.Router();

// 合成模型清单（用于推断外部创建音色的 target_model）
const TTS_MODELS = [
  'qwen-audio-3.1-tts-plus', 'qwen-audio-3.1-tts-flash',
  'qwen-audio-3.0-tts-plus', 'qwen-audio-3.0-tts-flash',
  'cosyvoice-v3.5-plus', 'cosyvoice-v3.5-flash',
  'cosyvoice-v3-plus', 'cosyvoice-v3-flash', 'cosyvoice-v2',
  'qwen3-tts-flash',
];
const CLONE_TARGETS = TTS_MODELS.filter((m) => !m.startsWith('qwen3-tts'));
const DESIGN_TARGETS = CLONE_TARGETS.filter((m) => m !== 'cosyvoice-v2');
const SORTED = [...TTS_MODELS].sort((a, b) => b.length - a.length);

function inferTargetModel(voiceId) {
  return SORTED.find((m) => voiceId.startsWith(`${m}-`)) || '';
}

function fail(res, e, status = 400) {
  const code = e.code || 'VOICE_ERROR';
  const message = e.message || '操作失败';
  log.warn('voices api failed:', code, message, e.requestId || '');
  res.status(status).json({ error: { code, message, requestId: e.requestId || '' } });
}

function inferKind(voiceId) {
  // 设计音色 ID 形如 {target_model}-vd-{prefix}-{uid}
  return /-vd-/.test(voiceId) ? 'design' : 'clone';
}

function enrich(v) {
  const voiceId = v.voice_id || v.voiceId;
  const meta = registry.get(voiceId) || {};
  const targetModel = meta.targetModel || inferTargetModel(voiceId) || '';
  return {
    voiceId,
    status: v.status || meta.status || 'UNKNOWN',
    kind: meta.kind || inferKind(voiceId),
    targetModel,
    prefix: meta.prefix || '',
    alias: meta.alias || '',
    languageHints: meta.languageHints || [],
    prompt: meta.prompt || '',
    gmtCreate: v.gmt_create || v.gmtCreate || '',
    gmtModified: v.gmt_modified || v.gmtModified || '',
    createdTs: meta.createdTs || 0,
  };
}

// 创建复刻音色 {audio(dataURI), targetModel, prefix, languageHint, maxPromptAudioLength, enablePreprocess, enableVolumeNormalization}
router.post('/clone', async (req, res) => {
  const b = req.body || {};
  const audio = String(b.audio || '');
  if (!audio.startsWith('data:audio/')) return fail(res, { code: 'BAD_AUDIO', message: '请提供音频样本（data:audio/... base64）' });
  if (!CLONE_TARGETS.includes(b.targetModel)) return fail(res, { code: 'BAD_TARGET_MODEL', message: '目标模型不支持声音复刻' });
  if (!/^[0-9A-Za-z]{1,10}$/.test(String(b.prefix || ''))) return fail(res, { code: 'BAD_PREFIX', message: 'prefix 仅支持 1–10 位字母或数字' });

  try {
    const r = await dashscope.voiceEnrollment('create_voice', {
      target_model: b.targetModel,
      audio,
      prefix: String(b.prefix),
      language_hints: [b.languageHint || 'zh'],
      max_prompt_audio_length: Math.min(30, Math.max(3, Number(b.maxPromptAudioLength) || 10)),
      enable_preprocess: Boolean(b.enablePreprocess),
      enable_volume_normalization: String(Boolean(b.enableVolumeNormalization)),
    });
    const voiceId = r.output && r.output.voice_id;
    if (!voiceId) throw Object.assign(new Error('上游未返回 voice_id'), { code: 'NO_VOICE_ID' });
    registry.upsert(voiceId, {
      kind: 'clone', targetModel: b.targetModel, prefix: String(b.prefix),
      languageHints: [b.languageHint || 'zh'], createdTs: Date.now(),
    });
    log.info(`voice cloned: ${voiceId} target=${b.targetModel}`);
    res.json({ voiceId, status: 'DEPLOYING' });
  } catch (e) {
    fail(res, e);
  }
});

// 创建声音设计音色 {voicePrompt, previewText, targetModel, prefix, languageHint, sampleRate, format}
router.post('/design', async (req, res) => {
  const b = req.body || {};
  const voicePrompt = String(b.voicePrompt || '').trim();
  const previewText = String(b.previewText || '').trim();
  if (!voicePrompt || voicePrompt.length > 500) return fail(res, { code: 'BAD_PROMPT', message: '声音描述需在 1–500 字之间' });
  if (previewText.length < 15 || previewText.length > 200) return fail(res, { code: 'BAD_PREVIEW_TEXT', message: '预览文本需在 15–200 字之间' });
  if (!DESIGN_TARGETS.includes(b.targetModel)) return fail(res, { code: 'BAD_TARGET_MODEL', message: '目标模型不支持声音设计' });
  if (!/^[0-9A-Za-z]{1,10}$/.test(String(b.prefix || ''))) return fail(res, { code: 'BAD_PREFIX', message: 'prefix 仅支持 1–10 位字母或数字' });

  try {
    const r = await dashscope.voiceEnrollment('create_voice', {
      target_model: b.targetModel,
      voice_prompt: voicePrompt,
      preview_text: previewText,
      prefix: String(b.prefix),
      language_hints: [b.languageHint || 'zh'],
    }, {
      sample_rate: [16000, 24000, 48000].includes(Number(b.sampleRate)) ? Number(b.sampleRate) : 24000,
      response_format: ['pcm', 'wav', 'mp3'].includes(b.format) ? b.format : 'wav',
    });
    const voiceId = r.output && r.output.voice_id;
    if (!voiceId) throw Object.assign(new Error('上游未返回 voice_id'), { code: 'NO_VOICE_ID' });
    registry.upsert(voiceId, {
      kind: 'design', targetModel: b.targetModel, prefix: String(b.prefix),
      languageHints: [b.languageHint || 'zh'], prompt: voicePrompt, createdTs: Date.now(),
    });
    const pa = (r.output && r.output.preview_audio) || {};
    log.info(`voice designed: ${voiceId} target=${b.targetModel}`);
    res.json({
      voiceId,
      status: 'DEPLOYING',
      previewAudio: pa.data ? {
        data: pa.data,
        sampleRate: pa.sample_rate || 24000,
        format: pa.response_format || 'wav',
      } : null,
    });
  } catch (e) {
    fail(res, e);
  }
});

// 自定义音色列表（上游 list_voice + 本地别名注册表）
router.get('/custom', async (req, res) => {
  try {
    const list = await dashscope.listAllVoices();
    res.json({ items: list.map(enrich).sort((a, b) => b.createdTs - a.createdTs) });
  } catch (e) {
    fail(res, e);
  }
});

router.get('/custom/:id', async (req, res) => {
  try {
    const r = await dashscope.voiceEnrollment('query_voice', { voice_id: req.params.id });
    const v = (r.output && (r.output.voice || r.output)) || {};
    const item = enrich({ ...v, voice_id: req.params.id });
    if (v.status) item.status = v.status;
    res.json(item);
  } catch (e) {
    fail(res, e);
  }
});

// 更新复刻音色样本
router.post('/custom/:id/update', async (req, res) => {
  const audio = String((req.body || {}).audio || '');
  if (!audio.startsWith('data:audio/')) return fail(res, { code: 'BAD_AUDIO', message: '请提供音频样本' });
  try {
    await dashscope.voiceEnrollment('update_voice', { voice_id: req.params.id, audio });
    res.json({ ok: true, status: 'DEPLOYING' });
  } catch (e) {
    fail(res, e);
  }
});

// 本地别名（不调用上游）
router.patch('/custom/:id', (req, res) => {
  const alias = String((req.body || {}).alias || '').trim();
  registry.setAlias(req.params.id, alias);
  res.json({ ok: true, alias });
});

router.delete('/custom/:id', async (req, res) => {
  try {
    await dashscope.voiceEnrollment('delete_voice', { voice_id: req.params.id });
    registry.remove(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
});

module.exports = router;
