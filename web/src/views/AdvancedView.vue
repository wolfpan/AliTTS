<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import {
  NCard, NGrid, NGi, NSelect, NButton, NSpace, NText, NSwitch, NAlert, NProgress, NTag,
  NTooltip, NModal, NInput, NCheckbox, useMessage,
} from 'naive-ui';
import { MODELS, getModel } from '../data/models';
import { voicesForModel, type VoiceEntry } from '../data/voiceCatalog';
import { INSTRUCTION_CHIPS, INLINE_TAGS, SSML_SNIPPETS } from '../data/instructionPresets';
import ParamPanel, { type AdvParams } from '../components/ParamPanel.vue';
import VoicePickerDrawer from '../components/VoicePickerDrawer.vue';
import AudioResult from '../components/AudioResult.vue';
import { synthesizeToBlob, type SynthResult } from '../audio/synth';
import { StreamPlayer, type StreamPlayerInfo } from '../audio/streamPlayer';
import { ApiError } from '../api/client';
import { formatBytes } from '../audio/assemble';
import { splitText } from '../util/chunker';
import { useCustomTemplates } from '../stores/customTemplates';
import { useUiState } from '../stores/uiState';
import { useSettingsStore } from '../stores/settings';

const message = useMessage();
const customTemplates = useCustomTemplates();
const uiState = useUiState();
const settingsStore = useSettingsStore();

const selectedModelId = ref('qwen-audio-3.1-tts-flash');
const model = computed(() => getModel(selectedModelId.value) || MODELS[0]);
const voice = ref<VoiceEntry | null>(null);
const showPicker = ref(false);

const text = ref('');
const textEl = ref<HTMLTextAreaElement | null>(null);
const instruction = ref('');
const enableSsml = ref(false);

const params = reactive<AdvParams>({
  rate: 1, pitch: 1, volume: 50,
  format: 'mp3', sampleRate: 24000, bitRate: 32, seed: 0,
  languageHint: '', languageType: 'Auto', wordTimestamp: false, segmentSilenceMs: 0,
  hp: [], hr: [],
});

function resetVoiceForModel() {
  const list = voicesForModel(model.value.id);
  if (voice.value && voice.value.models.includes(model.value.id)) return;
  voice.value = model.value.systemVoices ? (list[0] || null) : null;
}
resetVoiceForModel();
watch(selectedModelId, () => { resetVoiceForModel(); });

// 历史"载入参数"
onMounted(() => {
  const pending = uiState.takePendingAdvanced();
  if (!pending) return;
  if (getModel(pending.model)) selectedModelId.value = pending.model;
  const found = voicesForModel(pending.model).find((v) => v.id === pending.voice);
  voice.value = found || {
    id: pending.voice, name: pending.voice, gender: '女', langs: [], scenes: [], tags: ['自定义音色'], models: [pending.model], custom: true,
  };
  text.value = pending.text || '';
  const p = pending.params || {};
  const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
  params.rate = num(p.rate, 1);
  params.pitch = num(p.pitch, 1);
  params.volume = num(p.volume, 50);
  if (['mp3', 'wav', 'pcm', 'opus'].includes(String(p.format))) params.format = p.format as AdvParams['format'];
  params.sampleRate = num(p.sample_rate, 24000);
  params.bitRate = num(p.bit_rate, 32);
  params.seed = num(p.seed, 0);
  params.wordTimestamp = Boolean(p.word_timestamp_enabled);
  if (Array.isArray(p.language_hints) && p.language_hints[0]) params.languageHint = String(p.language_hints[0]);
  if (p.language_type) params.languageType = String(p.language_type);
  if (p.instruction) instruction.value = String(p.instruction);
  enableSsml.value = Boolean(p.enable_ssml);
  params.segmentSilenceMs = num(p.segment_silence_ms, 0);
});

const modelOptions = MODELS.map((m) => ({ label: m.label, value: m.id }));

const voiceTags = computed(() => (voice.value ? voice.value.tags : []));
const isQwenAudio = computed(() => /^qwen-audio/.test(model.value.id));

// 自定义音色（复刻/设计）的指令能力与系统音色不同：
// - qwen-audio：全音色自然语言
// - cosyvoice v3.5 / v3-flash：复刻/设计音色支持自然语言
// - cosyvoice v3-plus 的复刻/设计音色不支持指令；v2 无指令
const effectiveInstructionMode = computed(() => {
  if (!voice.value?.custom) return model.value.instructionMode;
  if (isQwenAudio.value) return 'free';
  if (['cosyvoice-v3.5-plus', 'cosyvoice-v3.5-flash', 'cosyvoice-v3-flash'].includes(model.value.id)) return 'free';
  return 'none';
});

// 指令字数：cosyvoice 汉字按 2 计，上限 100
const instructionLen = computed(() => {
  let n = 0;
  for (const ch of instruction.value) n += ch.charCodeAt(0) > 255 ? 2 : 1;
  return n;
});
const instructionLimit = computed(() => (/^cosyvoice/.test(model.value.id) ? 100 : 0));
const instructionOver = computed(() => instructionLimit.value > 0 && instructionLen.value > instructionLimit.value);

// 分段预览（与服务端同算法）
const segLimit = computed(() => model.value.maxChars
  || Number(settingsStore.view.preferences.chunkLimit) || 600);
const segCount = computed(() => (enableSsml.value ? 1 : splitText(text.value, segLimit.value).length));

// SSML 助手
const ssmlUnwrapped = computed(() =>
  enableSsml.value && text.value.trim().length > 0 && !/^\s*<speak[\s>]/i.test(text.value),
);

function insertAtCursor(snippet: string) {
  const el = textEl.value;
  if (!el) { text.value += snippet; return; }
  const start = el.selectionStart ?? text.value.length;
  const end = el.selectionEnd ?? text.value.length;
  text.value = text.value.slice(0, start) + snippet + text.value.slice(end);
  nextTick(() => {
    el.focus();
    const pos = start + snippet.length;
    el.setSelectionRange(pos, pos);
  });
}

function wrapSpeak() {
  const t = text.value.trim();
  if (!t) return;
  text.value = `<speak>${t}</speak>`;
}

function appendInstruction(s: string) {
  instruction.value = (instruction.value ? instruction.value.replace(/[，。,\s]+$/, '') + '，' : '') + s;
}

// ---- 合成 ----
const running = ref(false);
const progress = reactive({ bytes: 0, chunk: 0, total: 1 });
const result = ref<SynthResult | null>(null);
const errorInfo = ref<{ code: string; message: string; requestId: string } | null>(null);
let aborter: AbortController | null = null;

// 流式边收边播（单段 wav/pcm）
const streamEnabled = ref(true);
const streamInfo = ref<StreamPlayerInfo | null>(null);
let player: StreamPlayer | null = null;

function stopStreamPlayer() {
  player?.stop();
  player = null;
  streamInfo.value = null;
}

// A/B 对比：保留最近两次生成快照
interface AbEntry {
  ts: number;
  model: string;
  voiceId: string;
  voiceName: string;
  text: string;
  instruction: string;
  params: Record<string, unknown>;
  blob: Blob;
  filename: string;
  bytes: number;
  elapsedMs: number;
  requestId: string;
  format: string;
}
const ab = ref<AbEntry[]>([]);

function pushAb(r: SynthResult, builtParams: Record<string, unknown>) {
  const entry: AbEntry = {
    ts: Date.now(),
    model: model.value.id,
    voiceId: voice.value?.id || '',
    voiceName: voice.value?.name || '',
    text: text.value,
    instruction: instruction.value.trim(),
    params: builtParams,
    blob: r.blob,
    filename: `alitts-${model.value.id}-${voice.value?.id || 'voice'}-${Date.now()}.${r.format}`,
    bytes: r.bytes,
    elapsedMs: r.elapsedMs,
    requestId: r.requestId,
    format: r.format,
  };
  ab.value = [...ab.value.slice(-1), entry];
}

const DIFF_KEYS: Array<{ k: string; label: string }> = [
  { k: 'model', label: '模型' },
  { k: 'voice', label: '音色' },
  { k: 'text', label: '文本' },
  { k: 'instruction', label: '指令' },
  { k: 'rate', label: '语速' },
  { k: 'pitch', label: '音调' },
  { k: 'volume', label: '音量' },
  { k: 'format', label: '格式' },
  { k: 'sample_rate', label: '采样率' },
  { k: 'bit_rate', label: '码率' },
  { k: 'seed', label: '种子' },
  { k: 'language_hints', label: '语言' },
  { k: 'language_type', label: '语言类型' },
  { k: 'enable_ssml', label: 'SSML' },
  { k: 'word_timestamp_enabled', label: '时间戳' },
];

function snapVal(e: AbEntry, k: string): string {
  if (k === 'model') return e.model;
  if (k === 'voice') return e.voiceName || e.voiceId;
  if (k === 'text') return e.text.length > 14 ? e.text.slice(0, 14) + '…' : e.text;
  if (k === 'instruction') return e.instruction || '—';
  const v = e.params[k];
  if (v === undefined || v === null || v === '') return '—';
  if (Array.isArray(v)) return v.join(',');
  return String(v);
}

const showSameParams = ref(false);
const diffRows = computed(() => {
  if (ab.value.length < 2) return [];
  const [a, b] = ab.value;
  return DIFF_KEYS
    .map((d) => {
      const va = snapVal(a, d.k);
      const vb = snapVal(b, d.k);
      return { ...d, a: va, b: vb, same: va === vb };
    })
    .filter((r) => showSameParams.value || !r.same);
});

function applySnapshotA() {
  const e = ab.value[0];
  if (!e) return;
  if (getModel(e.model)) selectedModelId.value = e.model;
  const found = voicesForModel(e.model).find((v) => v.id === e.voiceId);
  voice.value = found || {
    id: e.voiceId, name: e.voiceName || e.voiceId, gender: '女', langs: [], scenes: [],
    tags: ['自定义音色'], models: [e.model], custom: true,
  };
  text.value = e.text;
  instruction.value = e.instruction;
  enableSsml.value = Boolean(e.params.enable_ssml);
  const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
  params.rate = num(e.params.rate, params.rate);
  params.pitch = num(e.params.pitch, params.pitch);
  params.volume = num(e.params.volume, params.volume);
  params.sampleRate = num(e.params.sample_rate, params.sampleRate);
  params.bitRate = num(e.params.bit_rate, params.bitRate);
  params.seed = num(e.params.seed, params.seed);
  params.segmentSilenceMs = num(e.params.segment_silence_ms, 0);
  if (['mp3', 'wav', 'pcm', 'opus'].includes(String(e.params.format))) params.format = e.params.format as AdvParams['format'];
  if (Array.isArray(e.params.language_hints) && e.params.language_hints[0]) params.languageHint = String(e.params.language_hints[0]);
  if (e.params.language_type) params.languageType = String(e.params.language_type);
  message.success('已应用 A 的参数，可直接重新生成对比');
}

function buildHotfix() {
  const pron = params.hp.filter((r) => r.word.trim() && r.pinyin.trim())
    .map((r) => ({ [r.word.trim()]: r.pinyin.trim() }));
  const rep = params.hr.filter((r) => r.from.trim() && r.to.trim())
    .map((r) => ({ [r.from.trim()]: r.to.trim() }));
  if (!pron.length && !rep.length) return null;
  return {
    ...(pron.length ? { pronunciation: pron } : {}),
    ...(rep.length ? { replace: rep } : {}),
  };
}

function buildParams(): Record<string, unknown> {
  const m = model.value;
  const p: Record<string, unknown> = {};
  if (!m.outputFixed) {
    p.format = params.format;
    p.sample_rate = params.sampleRate;
    if (params.format === 'opus') p.bit_rate = params.bitRate;
  }
  if (m.supportsProsody) { p.rate = params.rate; p.pitch = params.pitch; p.volume = params.volume; }
  if (m.supportsSeed) p.seed = params.seed;
  if (m.supportsLanguageHints && params.languageHint) p.language_hints = [params.languageHint];
  if (m.supportsLanguageType) p.language_type = params.languageType;
  if (m.supportsSsml && enableSsml.value) p.enable_ssml = true;
  if (m.supportsTimestamps && params.wordTimestamp) p.word_timestamp_enabled = true;
  if (effectiveInstructionMode.value !== 'none' && instruction.value.trim()) p.instruction = instruction.value.trim();
  if (!m.outputFixed && params.segmentSilenceMs > 0 && (params.format === 'wav' || params.format === 'pcm')) {
    p.segment_silence_ms = params.segmentSilenceMs;
  }
  if (m.supportsHotfix) {
    const hf = buildHotfix();
    if (hf) p.hot_fix = hf;
  }
  return p;
}

async function generate() {
  if (!voice.value) { message.warning('当前模型没有可用系统音色，请切换模型或等待 M3 复刻音色'); return; }
  if (!text.value.trim()) { message.warning('请输入文本'); return; }
  if (instructionOver.value) { message.warning('指令超过 100 字（汉字计 2），请精简'); return; }
  if (ssmlUnwrapped.value) { message.warning('SSML 文本需整体包裹在 <speak> 中（可点击“包裹为 <speak>”）'); return; }

  running.value = true;
  errorInfo.value = null;
  result.value = null;
  progress.bytes = 0; progress.chunk = 0; progress.total = 1;
  aborter = new AbortController();
  stopStreamPlayer();

  const builtParams = buildParams();
  try {
    const r = await synthesizeToBlob(
      { model: model.value.id, voice: voice.value.id, text: text.value, params: builtParams },
      {
        signal: aborter.signal,
        onEvent: (e) => {
          if (e.type === 'meta') {
            progress.total = e.chunks;
            if (streamEnabled.value && e.streamable) {
              player = new StreamPlayer(e.format as 'wav' | 'pcm', e.sampleRate || params.sampleRate);
            }
          } else if (e.type === 'audio') {
            progress.bytes += Math.floor(e.data.length * 0.75);
            if (player) { player.feedChunk(e.data); streamInfo.value = player.info(); }
          } else if (e.type === 'progress') {
            progress.chunk = e.chunk;
          }
        },
      },
    );
    result.value = r;
    pushAb(r, builtParams);
    message.success(`合成完成${r.words.length ? `（含 ${r.words.length} 个词级时间戳）` : ''}`);
  } catch (e) {
    if ((e as Error).name === 'AbortError') message.info('已取消');
    else if (e instanceof ApiError) errorInfo.value = { code: e.code, message: e.message, requestId: e.requestId || '' };
    else errorInfo.value = { code: 'ERROR', message: (e as Error).message, requestId: '' };
  } finally {
    running.value = false;
    aborter = null;
  }
}

function stop() {
  aborter?.abort();
  stopStreamPlayer();
}

onBeforeUnmount(() => {
  stopStreamPlayer();
});

const resultFilename = computed(() => {
  if (!result.value || !voice.value) return 'audio';
  return `alitts-${model.value.id}-${voice.value.id}-${Date.now()}.${result.value.format}`;
});

// ---- 存为快捷模板 ----
const showSave = ref(false);
const tplName = ref('');

function openSave() {
  if (!voice.value || !result.value) return;
  tplName.value = `${model.value.label.split('（')[0]} · ${voice.value.name}`;
  showSave.value = true;
}

function doSave() {
  if (!voice.value || !result.value) return;
  const fmt: 'mp3' | 'wav' = params.format === 'wav' ? 'wav' : 'mp3';
  customTemplates.add({
    id: '', icon: '⭐', name: tplName.value.trim() || '自定义模板',
    desc: `${model.value.label} · ${voice.value.name}`,
    model: model.value.id,
    params: { format: fmt, sample_rate: params.sampleRate, rate: params.rate, pitch: params.pitch, volume: params.volume },
    ...(instruction.value.trim() ? { instruction: instruction.value.trim() } : {}),
    ...(model.value.supportsLanguageHints && params.languageHint ? { languageHints: [params.languageHint] } : {}),
    ...(model.value.supportsLanguageType ? { languageType: params.languageType } : {}),
    voices: [{ id: voice.value.id, name: voice.value.name, gender: voice.value.gender, style: voice.value.tags.join('，') }],
    sampleText: text.value.slice(0, 80),
  });
  showSave.value = false;
  message.success('已保存为快捷模板，可在“语音合成”页使用');
}
</script>

<template>
  <div class="advanced">
    <!-- 模型与音色 -->
    <n-card size="small" title="模型与音色">
      <n-grid :cols="24" :x-gap="12" :y-gap="10" item-responsive responsive="screen">
        <n-gi span="24 m:9">
          <n-select v-model:value="selectedModelId" :options="modelOptions" />
        </n-gi>
        <n-gi span="24 m:10">
          <div class="voice-pick" @click="showPicker = true">
            <template v-if="voice">
              <span class="vp-name">{{ voice.name }}</span>
              <span class="vp-id">{{ voice.id }}</span>
              <span class="vp-tags">
                <n-tag v-for="t in voiceTags.slice(0, 3)" :key="t" size="tiny" :bordered="false">{{ t }}</n-tag>
              </span>
            </template>
            <span v-else class="vp-empty">该模型无系统音色（M3 复刻音色可用）</span>
            <n-button size="tiny" type="primary" quaternary>选择音色 ›</n-button>
          </div>
        </n-gi>
        <n-gi span="24 m:5">
          <div class="cap-tags">
            <n-tag v-if="model.supportsSsml" size="tiny" :bordered="false" type="info">SSML</n-tag>
            <n-tag v-if="model.supportsSeed" size="tiny" :bordered="false" type="info">seed</n-tag>
            <n-tag v-if="model.supportsHotfix" size="tiny" :bordered="false" type="info">纠音</n-tag>
            <n-tag v-if="effectiveInstructionMode !== 'none'" size="tiny" :bordered="false" type="info">指令</n-tag>
            <n-tag v-if="model.supportsTimestamps" size="tiny" :bordered="false" type="info">时间戳</n-tag>
          </div>
        </n-gi>
      </n-grid>
      <n-alert v-if="model.note" type="info" :bordered="false" style="margin-top: 10px" :show-icon="true">
        {{ model.note }}
      </n-alert>
    </n-card>

    <n-grid :cols="24" :x-gap="14" :y-gap="14" item-responsive responsive="screen" style="margin-top: 14px">
      <!-- 左：文本 + 指令 -->
      <n-gi span="24 m:15">
        <n-card size="small">
          <template #header>
            <n-space align="center" :size="8">
              <span>文本</span>
              <n-text depth="3" style="font-size: 12px">{{ text.length }} 字</n-text>
            </n-space>
          </template>
          <template #header-extra>
            <div v-if="model.supportsSsml" class="ssml-toggle">
              <n-switch v-model:value="enableSsml" size="small" />
              <n-text depth="3" style="font-size: 12px">SSML</n-text>
            </div>
          </template>

          <n-alert v-if="enableSsml" type="warning" :bordered="false" style="margin-bottom: 8px" :show-icon="true">
            SSML 模式需整体包裹在 &lt;speak&gt; 中，不支持自动分段；&lt; &gt; &amp; 等特殊字符需转义。
            支持：<b>speak / break / sub / phoneme / soundEvent / say-as</b>（每次仅一次完整提交）。
          </n-alert>

          <n-space v-if="enableSsml" :size="6" style="margin-bottom: 8px; flex-wrap: wrap">
            <n-button size="tiny" @click="wrapSpeak">包裹为 &lt;speak&gt;</n-button>
            <n-tooltip v-for="s in SSML_SNIPPETS" :key="s.label" trigger="hover">
              <template #trigger>
                <n-button size="tiny" quaternary @click="insertAtCursor(s.snippet)">{{ s.label }}</n-button>
              </template>
              {{ s.hint }}
            </n-tooltip>
          </n-space>

          <textarea ref="textEl" v-model="text" class="adv-textarea" rows="7"
            placeholder="输入要合成的文本，支持多语种混合；开启 SSML 后可插入停顿、多音字、数字读法等标签" />

          <div class="text-foot">
            <n-space v-if="isQwenAudio" :size="4" align="center">
              <n-text depth="3" style="font-size: 11px">内联情感标签：</n-text>
              <n-button v-for="t in INLINE_TAGS" :key="t.tag" size="tiny" quaternary
                @click="insertAtCursor(t.tag)">{{ t.tag }}</n-button>
            </n-space>
            <n-text v-if="!text.trim()" depth="3" style="font-size: 11px">
              {{ model.maxChars ? `单次上限 ${model.maxChars} 字（超出自动分段）` : '长文本按句自动分段拼接' }}
            </n-text>
            <n-text v-else-if="segCount > 1" type="warning" style="font-size: 11px">
              将分 {{ segCount }} 段顺序合成拼接{{ params.segmentSilenceMs > 0 && (params.format === 'wav' || params.format === 'pcm') ? `（段间静音 ${params.segmentSilenceMs}ms）` : '' }}
            </n-text>
            <n-text v-else depth="3" style="font-size: 11px">
              {{ enableSsml ? 'SSML 模式不分段' : '单段合成' }}
            </n-text>
          </div>
        </n-card>

        <n-card v-if="effectiveInstructionMode !== 'none'" size="small" style="margin-top: 14px">
          <template #header>
            <n-space align="center" :size="8">
              <span>指令 instruction</span>
              <n-text v-if="instructionLimit" :type="instructionOver ? 'error' : 'default'" depth="3" style="font-size: 12px">
                {{ instructionLen }}/{{ instructionLimit }}
              </n-text>
            </n-space>
          </template>
          <n-alert v-if="effectiveInstructionMode === 'fixed'" type="info" :bordered="false" style="margin-bottom: 8px">
            该模型的系统音色需按「音色列表」规定的固定指令格式填写；自然语言指令建议切换 Qwen-Audio 系列。
          </n-alert>
          <n-input v-model:value="instruction" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }"
            :status="instructionOver ? 'error' : undefined"
            placeholder="用自然语言描述语气、方言、角色或节奏，如：用温柔的语气，语速稍慢一点" />
          <n-space v-for="g in INSTRUCTION_CHIPS" :key="g.title" :size="4" style="margin-top: 8px; flex-wrap: wrap">
            <n-text depth="3" style="font-size: 11px; width: 44px">{{ g.title }}</n-text>
            <n-button v-for="c in g.chips" :key="c" size="tiny" quaternary @click="appendInstruction(c)">{{ c }}</n-button>
          </n-space>
        </n-card>
      </n-gi>

      <!-- 右：参数 -->
      <n-gi span="24 m:9">
        <ParamPanel :model="model" :params="params" />
      </n-gi>
    </n-grid>

    <!-- 生成 -->
    <n-card size="small" style="margin-top: 14px">
      <!-- 生成：不用 n-space——其子项包裹 div 均为同一 key，v-if 子节点增删时会产生重复渲染 -->
      <div class="gen-row">
        <n-button type="primary" size="large" :loading="running" :disabled="!voice || !text.trim()" @click="generate">
          🎧 生成语音
        </n-button>
        <n-button v-if="running" size="large" quaternary type="error" @click="stop">停止</n-button>
        <div class="stream-toggle">
          <n-switch v-model:value="streamEnabled" size="small" :disabled="running" />
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-text depth="3" style="font-size: 12px; border-bottom: 1px dashed">边收边播</n-text>
            </template>
            单段 WAV/PCM 时音频边到达边播放；多段拼接或 MP3/Opus 仍完成后一次播放
          </n-tooltip>
        </div>
        <div v-if="running" class="gen-progress">
          <n-progress type="line" :percentage="progress.total > 1 ? Math.round((progress.chunk / progress.total) * 100) : undefined"
            :indeterminate="progress.total <= 1" :height="8" :show-indicator="progress.total > 1" />
          <n-text depth="3" style="font-size: 12px">
            已接收 {{ formatBytes(progress.bytes) }}
            <template v-if="streamInfo && streamInfo.active && !streamInfo.suspended">
              · ▶ 流式播放中 已播 {{ streamInfo.playedSeconds }}s / 缓冲 {{ streamInfo.bufferedSeconds }}s
            </template>
          </n-text>
        </div>
      </div>

      <n-alert v-if="errorInfo" type="error" style="margin-top: 12px" :title="`合成失败（${errorInfo.code}）`">
        {{ errorInfo.message }}
        <n-text v-if="errorInfo.requestId" depth="3" style="font-size: 11px; display: block; margin-top: 4px">
          requestId: {{ errorInfo.requestId }}
        </n-text>
      </n-alert>

      <div v-if="result" style="margin-top: 12px">
        <AudioResult
          :blob="result.blob"
          :filename="resultFilename"
          :bytes="result.bytes"
          :elapsed-ms="result.elapsedMs"
          :model="model.id"
          :voice="voice?.id || ''"
          :request-id="result.requestId"
        />
        <n-space style="margin-top: 8px" :size="8" align="center">
          <n-button size="small" @click="openSave">存为快捷模板</n-button>
          <n-text v-if="result.words.length" depth="3" style="font-size: 12px">
            词级时间戳 {{ result.words.length }} 个，已存入历史
          </n-text>
        </n-space>
      </div>
    </n-card>

    <!-- A/B 对比 -->
    <n-card v-if="ab.length === 2" size="small" style="margin-top: 14px">
      <template #header>
        <n-space align="center" :size="10">
          <span>A/B 对比</span>
          <n-text depth="3" style="font-size: 12px">最近两次生成并排试听，差异参数高亮</n-text>
        </n-space>
      </template>
      <template #header-extra>
        <n-space :size="10" align="center">
          <n-checkbox size="small" @update:checked="(v: boolean) => (showSameParams = v)">显示相同项</n-checkbox>
          <n-button size="small" @click="applySnapshotA">应用 A 的参数</n-button>
        </n-space>
      </template>

      <n-grid :cols="2" :x-gap="14" item-responsive responsive="screen">
        <n-gi span="2 m:1">
          <div class="ab-tag">A · {{ new Date(ab[0].ts).toLocaleTimeString('zh-CN', { hour12: false }) }}</div>
          <AudioResult :blob="ab[0].blob" :filename="ab[0].filename" :bytes="ab[0].bytes"
            :elapsed-ms="ab[0].elapsedMs" :model="ab[0].model" :voice="ab[0].voiceId" :request-id="ab[0].requestId" />
        </n-gi>
        <n-gi span="2 m:1">
          <div class="ab-tag ab-b">B · {{ new Date(ab[1].ts).toLocaleTimeString('zh-CN', { hour12: false }) }}（最新）</div>
          <AudioResult :blob="ab[1].blob" :filename="ab[1].filename" :bytes="ab[1].bytes"
            :elapsed-ms="ab[1].elapsedMs" :model="ab[1].model" :voice="ab[1].voiceId" :request-id="ab[1].requestId" />
        </n-gi>
      </n-grid>

      <div v-if="diffRows.length" class="ab-diff">
        <div class="ab-diff-head">
          <span>参数</span><span>A</span><span>B</span>
        </div>
        <div v-for="row in diffRows" :key="row.k" class="ab-diff-row" :class="{ diff: !row.same }">
          <span class="k">{{ row.label }}</span>
          <span>{{ row.a }}</span>
          <span>{{ row.b }}</span>
        </div>
      </div>
      <n-text v-else depth="3" style="font-size: 12px">两次参数完全一致（仅音频生成差异）</n-text>
    </n-card>

    <!-- 存模板弹窗 -->
    <n-modal v-model:show="showSave" preset="dialog" title="存为快捷模板"
      positive-text="保存" negative-text="取消" @positive-click="doSave">
      <n-input v-model:value="tplName" placeholder="模板名称" style="margin-top: 8px" />
      <n-text depth="3" style="font-size: 12px; display: block; margin-top: 8px">
        将保存当前模型/音色/参数/指令/示例文本，出现在「语音合成」快捷模式中。
      </n-text>
    </n-modal>

    <VoicePickerDrawer v-model:show="showPicker" :model-id="selectedModelId" :selected-id="voice?.id || ''"
      @select="(v) => (voice = v)" />
  </div>
</template>

<style scoped>
.voice-pick {
  display: flex; align-items: center; gap: 8px; padding: 4px 10px; min-height: 34px;
  border: 1px solid rgba(128,128,128,.28); border-radius: 4px; cursor: pointer; box-sizing: border-box;
}
.voice-pick:hover { border-color: rgba(64,128,255,.6); }
.vp-name { font-weight: 600; font-size: 13px; }
.vp-id { font-size: 11px; opacity: .45; font-family: monospace; }
.vp-tags { display: flex; gap: 4px; flex: 1; }
.vp-empty { flex: 1; font-size: 12px; opacity: .55; }
.adv-textarea {
  width: 100%; box-sizing: border-box; resize: vertical; min-height: 150px; padding: 10px 12px;
  border: 1px solid rgba(128,128,128,.3); border-radius: 4px; background: transparent;
  color: inherit; font: inherit; font-size: 14px; line-height: 1.7; outline: none;
}
.adv-textarea:focus { border-color: rgba(58,139,255,.7); }
.text-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 6px; flex-wrap: wrap; gap: 6px; }
.gen-progress { flex: 1; min-width: 220px; }
.gen-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.cap-tags { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.stream-toggle { display: flex; align-items: center; gap: 6px; }
.ssml-toggle { display: flex; align-items: center; gap: 8px; }
.ab-tag { font-size: 12px; font-weight: 600; margin-bottom: 6px; opacity: .8; }
.ab-b { color: #3a8bff; }
.ab-diff { margin-top: 14px; font-size: 12px; }
.ab-diff-head, .ab-diff-row { display: grid; grid-template-columns: 90px 1fr 1fr; gap: 8px; padding: 4px 8px; }
.ab-diff-head { opacity: .5; border-bottom: 1px solid rgba(128,128,128,.25); }
.ab-diff-row { border-bottom: 1px dashed rgba(128,128,128,.12); }
.ab-diff-row .k { opacity: .6; }
.ab-diff-row.diff { background: rgba(58,139,255,.08); }
.ab-diff-row.diff span:not(.k) { font-weight: 600; }
</style>
