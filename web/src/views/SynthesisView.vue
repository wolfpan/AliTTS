<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import {
  NCard, NGrid, NGi, NButton, NInput, NSpace, NTag, NSlider, NSelect, NAlert, NProgress,
  NText, useMessage, NPopselect,
} from 'naive-ui';
import { TEMPLATES, type QuickTemplate, type QuickVoice } from '../data/templates';
import { getModel } from '../data/models';
import { ApiError, type TtsEvent } from '../api/client';
import { synthesizeToBlob } from '../audio/synth';
import { StreamPlayer } from '../audio/streamPlayer';
import { formatBytes } from '../audio/assemble';
import AudioResult from '../components/AudioResult.vue';
import { useCustomTemplates } from '../stores/customTemplates';

const message = useMessage();
const customTemplates = useCustomTemplates();

const allTemplates = computed<QuickTemplate[]>(() => [...TEMPLATES, ...customTemplates.items]);
const isCustom = (id: string) => id.startsWith('custom-');

// ---- 步骤 1：模板 ----
const templateId = ref<string>(TEMPLATES[0].id);
const template = computed<QuickTemplate>(() => allTemplates.value.find((t) => t.id === templateId.value) || TEMPLATES[0]);
const modelMeta = computed(() => getModel(template.value.model));

// ---- 步骤 2：音色与微调 ----
const voiceId = ref<string>(template.value.voices[0].id);
const voice = computed<QuickVoice>(() => template.value.voices.find((v) => v.id === voiceId.value) || template.value.voices[0]);

function onTemplateChange(id: string) {
  templateId.value = id;
  voiceId.value = template.value.voices[0].id;
  resetProsody();
  text.value = '';
}

const prosody = reactive({ rate: 1, pitch: 1, volume: 50 });
function resetProsody() {
  prosody.rate = template.value.params.rate;
  prosody.pitch = template.value.params.pitch;
  prosody.volume = template.value.params.volume;
}
resetProsody();

const format = ref<'mp3' | 'wav'>(template.value.params.format);
const formatOptions = [
  { label: 'MP3', value: 'mp3' },
  { label: 'WAV', value: 'wav' },
];
function onResetParams() {
  resetProsody();
  format.value = template.value.params.format;
}

function removeTemplate(id: string) {
  customTemplates.remove(id);
  if (templateId.value === id) onTemplateChange(TEMPLATES[0].id);
  message.success('已删除自定义模板');
}

// ---- 步骤 3：文本 ----
const text = ref('');
const textLen = computed(() => text.value.length);
const overLimit = computed(() =>
  modelMeta.value ? modelMeta.value.maxChars > 0 && textLen.value > modelMeta.value.maxChars : false,
);

function fillSample() {
  text.value = template.value.sampleText;
}

// ---- 合成 ----
interface ResultItem {
  id: number;
  blob: Blob;
  filename: string;
  bytes: number;
  elapsedMs: number;
  model: string;
  voice: string;
  requestId: string;
}
let resultSeq = 0;
const results = ref<ResultItem[]>([]);

const running = ref(false);
const progress = reactive({ bytes: 0, chunk: 0, total: 1, streaming: false });
let aborter: AbortController | null = null;
let streamPlayer: StreamPlayer | null = null;

function stopStream() {
  streamPlayer?.stop();
  streamPlayer = null;
  progress.streaming = false;
}

function buildParams(): Record<string, unknown> {
  const p: Record<string, unknown> = {
    format: format.value,
    sample_rate: template.value.params.sample_rate,
  };
  if (modelMeta.value?.supportsProsody) {
    p.rate = prosody.rate;
    p.pitch = prosody.pitch;
    p.volume = prosody.volume;
  }
  if (template.value.instruction && modelMeta.value?.instructionMode !== 'none') {
    p.instruction = template.value.instruction;
  }
  if (template.value.languageHints) p.language_hints = template.value.languageHints;
  if (template.value.languageType) p.language_type = template.value.languageType;
  return p;
}

async function generate() {
  if (!text.value.trim()) {
    message.warning('请输入要合成的文本');
    return;
  }
  if (overLimit.value) {
    message.warning(`当前模板单次限 ${modelMeta.value?.maxChars} 字，超出部分将自动分段合成`);
  }

  running.value = true;
  progress.bytes = 0;
  progress.chunk = 0;
  progress.total = 1;
  progress.streaming = false;
  aborter = new AbortController();
  stopStream();

  try {
    const r = await synthesizeToBlob(
      {
        model: template.value.model,
        voice: voice.value.id,
        text: text.value,
        templateId: template.value.id,
        params: buildParams(),
      },
      {
        signal: aborter.signal,
        onEvent: (e: TtsEvent) => {
          if (e.type === 'meta') {
            progress.total = e.chunks;
            if (e.streamable) {
              streamPlayer = new StreamPlayer(e.format as 'wav' | 'pcm', e.sampleRate || template.value.params.sample_rate);
            }
          } else if (e.type === 'audio') {
            progress.bytes += Math.floor(e.data.length * 0.75);
            if (streamPlayer) { streamPlayer.feedChunk(e.data); progress.streaming = streamPlayer.active && !streamPlayer.info().suspended; }
          } else if (e.type === 'progress') progress.chunk = e.chunk;
        },
      },
    );
    results.value.unshift({
      id: ++resultSeq,
      blob: r.blob,
      filename: `alitts-${template.value.id}-${voice.value.id}-${Date.now()}.${r.format}`,
      bytes: r.bytes,
      elapsedMs: r.elapsedMs,
      model: template.value.model,
      voice: voice.value.id,
      requestId: r.requestId,
    });
    if (results.value.length > 5) results.value.pop();
    message.success('合成完成');
  } catch (e) {
    if ((e as Error).name === 'AbortError') message.info('已取消');
    else if (e instanceof ApiError) message.error(`${e.message}${e.requestId ? `（${e.code}）` : ''}`);
    else message.error(`合成失败：${(e as Error).message}`);
  } finally {
    running.value = false;
    aborter = null;
  }
}

function stop() {
  aborter?.abort();
  stopStream();
}

onBeforeUnmount(() => {
  stopStream();
});

// ---- 音色试听 ----
const previewing = ref<string>('');
let previewAudio: HTMLAudioElement | null = null;

async function previewVoice(v: QuickVoice) {
  if (running.value || previewing.value) return;
  previewing.value = v.id;
  try {
    const r = await synthesizeToBlob({
      model: template.value.model,
      voice: v.id,
      text: '你好，这是我的声音，很高兴认识你。',
      templateId: template.value.id,
      params: buildParams(),
    });
    previewAudio?.pause();
    previewAudio = new Audio(URL.createObjectURL(r.blob));
    await previewAudio.play();
  } catch (e) {
    if ((e as Error).name !== 'AbortError') message.error(`试听失败：${(e as Error).message}`);
  } finally {
    previewing.value = '';
  }
}
</script>

<template>
  <div class="synthesis">
    <!-- 1. 场景模板 -->
    <n-card title="① 选择场景模板" size="small">
      <n-grid :cols="3" :x-gap="10" :y-gap="10" item-responsive responsive="screen">
        <n-gi v-for="t in allTemplates" :key="t.id" span="2 s:1">
          <div class="tpl-card" :class="{ active: t.id === templateId }" @click="onTemplateChange(t.id)">
            <div class="tpl-head">
              <span class="tpl-icon">{{ t.icon }}</span>
              <span class="tpl-name">{{ t.name }}</span>
              <n-tag v-if="isCustom(t.id)" size="tiny" :bordered="false" type="warning">自定义</n-tag>
              <span v-if="isCustom(t.id)" class="tpl-del" title="删除模板" @click.stop="removeTemplate(t.id)">×</span>
            </div>
            <div class="tpl-desc">{{ t.desc }}</div>
          </div>
        </n-gi>
      </n-grid>
      <template #header-extra>
        <n-text depth="3" style="font-size: 12px">模型：{{ template.model }}</n-text>
      </template>
    </n-card>

    <!-- 2. 音色 -->
    <n-card title="② 选择音色" size="small" style="margin-top: 14px">
      <n-grid :cols="4" :x-gap="10" :y-gap="10" item-responsive responsive="screen">
        <n-gi v-for="v in template.voices" :key="v.id" span="4 s:2 m:1">
          <div class="voice-card" :class="{ active: v.id === voiceId }" @click="voiceId = v.id">
            <div class="voice-head">
              <n-tag size="tiny" :type="v.gender === '女' ? 'error' : 'info'" :bordered="false">{{ v.gender }}</n-tag>
              <span class="voice-name">{{ v.name }}</span>
              <n-button text size="tiny" type="primary" :loading="previewing === v.id" @click.stop="previewVoice(v)">
                试听
              </n-button>
            </div>
            <div class="voice-style">{{ v.style }}</div>
          </div>
        </n-gi>
      </n-grid>

      <div class="fine-tune">
        <n-popselect trigger="click" :show-arrow="true" style="width: 320px; padding: 16px">
          <n-button size="small" quaternary type="primary">🎚 微调参数</n-button>
          <template #empty>
            <div v-if="modelMeta?.supportsProsody" class="tune-panel">
              <div class="tune-row">
                <span>语速 {{ prosody.rate.toFixed(2) }}</span>
                <n-slider v-model:value="prosody.rate" :min="0.5" :max="2" :step="0.05" />
              </div>
              <div class="tune-row">
                <span>音调 {{ prosody.pitch.toFixed(2) }}</span>
                <n-slider v-model:value="prosody.pitch" :min="0.5" :max="2" :step="0.05" />
              </div>
              <div class="tune-row">
                <span>音量 {{ prosody.volume }}</span>
                <n-slider v-model:value="prosody.volume" :min="0" :max="100" :step="1" />
              </div>
              <n-space justify="space-between" style="margin-top: 4px">
                <n-select v-model:value="format" :options="formatOptions" size="small" style="width: 100px" />
                <n-button size="tiny" @click="onResetParams">恢复模板默认</n-button>
              </n-space>
            </div>
            <n-text v-else depth="3" style="font-size: 12px; display: block; padding: 12px">
              当前模型（{{ template.model }}）不支持语速/音调/音量参数
            </n-text>
          </template>
        </n-popselect>
        <n-text v-if="modelMeta?.supportsProsody" depth="3" style="font-size: 12px">
          语速 {{ prosody.rate.toFixed(2) }} · 音调 {{ prosody.pitch.toFixed(2) }} · 音量 {{ prosody.volume }} · {{ format.toUpperCase() }}
        </n-text>
        <n-text v-if="template.instruction" depth="3" style="font-size: 12px">
          · 指令：「{{ template.instruction }}」
        </n-text>
      </div>
    </n-card>

    <!-- 3. 文本与合成 -->
    <n-card title="③ 输入文本并合成" size="small" style="margin-top: 14px">
      <n-input v-model:value="text" type="textarea" :autosize="{ minRows: 4, maxRows: 12 }"
        :placeholder="`例如：${template.sampleText.slice(0, 30)}…`" />
      <div class="text-meta">
        <n-text depth="3" style="font-size: 12px">
          {{ textLen }} 字
          <template v-if="modelMeta?.maxChars">/ 单次 {{ modelMeta.maxChars }} 字，超出自动分段</template>
        </n-text>
        <n-space :size="8">
          <n-button size="tiny" quaternary @click="fillSample">填入示例</n-button>
          <n-button v-if="text" size="tiny" quaternary @click="text = ''">清空</n-button>
        </n-space>
      </div>

      <div class="gen-row">
        <n-button type="primary" size="large" :loading="running" :disabled="!text.trim()" @click="generate">
          🎧 生成语音
        </n-button>
        <n-button v-if="running" size="large" quaternary type="error" @click="stop">停止</n-button>
        <div v-if="running" class="progress">
          <n-progress type="line" :percentage="progress.total > 1 ? Math.round((progress.chunk / progress.total) * 100) : undefined"
            :indeterminate="progress.total <= 1" :height="8" :show-indicator="progress.total > 1" />
          <n-text depth="3" style="font-size: 12px">
            已接收 {{ formatBytes(progress.bytes) }}
            <template v-if="progress.streaming"> · ▶ 边收边播中</template>
            <template v-if="progress.total > 1">（第 {{ progress.chunk }}/{{ progress.total }} 段）</template>
          </n-text>
        </div>
      </div>
    </n-card>

    <!-- 结果 -->
    <n-card v-if="results.length" title="本次生成" size="small" style="margin-top: 14px">
      <n-space vertical :size="12">
        <AudioResult v-for="r in results" :key="r.id" :blob="r.blob" :filename="r.filename" :bytes="r.bytes"
          :elapsed-ms="r.elapsedMs" :model="r.model" :voice="r.voice" :request-id="r.requestId" />
      </n-space>
    </n-card>

    <n-alert style="margin-top: 14px" :bordered="false" type="info">
      需要全参数、全音色、SSML、指令与纠音？前往 <b>高级模式</b>；历史记录可在 <b>历史</b> 页回放与载入参数。
    </n-alert>
  </div>
</template>

<style scoped>
.tpl-card, .voice-card {
  border: 1.5px solid rgba(128, 128, 128, 0.22);
  border-radius: 8px;
  padding: 10px 12px;
  cursor: pointer;
  transition: all .15s;
  height: 100%;
  box-sizing: border-box;
  position: relative;
}
.tpl-card:hover, .voice-card:hover { border-color: rgba(64, 128, 255, 0.5); }
.tpl-card.active, .voice-card.active { border-color: #3a8bff; background: rgba(58, 139, 255, 0.08); }
.tpl-head { display: flex; align-items: center; gap: 8px; }
.tpl-icon { font-size: 18px; }
.tpl-name { font-weight: 600; flex: 1; }
.tpl-del {
  position: absolute; top: 2px; right: 6px; font-size: 15px; opacity: .35; line-height: 1;
}
.tpl-del:hover { opacity: .9; color: #e88080; }
.tpl-desc { font-size: 12px; opacity: .65; margin-top: 4px; }
.voice-head { display: flex; align-items: center; gap: 6px; }
.voice-name { font-weight: 600; flex: 1; }
.voice-style { font-size: 12px; opacity: .65; margin-top: 4px; }
.fine-tune { margin-top: 12px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tune-panel { padding: 4px; }
.tune-row { margin-bottom: 8px; font-size: 12px; display: flex; flex-direction: column; gap: 2px; }
.text-meta { display: flex; justify-content: space-between; align-items: center; margin-top: 6px; }
.gen-row { display: flex; align-items: center; gap: 12px; margin-top: 14px; flex-wrap: wrap; }
.progress { flex: 1; min-width: 220px; }
</style>
