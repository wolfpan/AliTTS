<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  NCard, NTabs, NTabPane, NButton, NSpace, NText, NAlert, NForm, NFormItem, NSelect, NInput,
  NSlider, NSwitch, NTag, NSpin, NDivider, NTooltip, useMessage,
} from 'naive-ui';
import { MODELS, getModel } from '../data/models';
import { prepareSample, formatDuration, type PreparedSample } from '../audio/samplePrep';
import { apiGet, apiSend, ApiError } from '../api/client';
import { synthesizeToBlob } from '../audio/synth';

const router = useRouter();
const message = useMessage();

const targetOptions = MODELS
  .filter((m) => m.endpoint === 'speech')
  .map((m) => ({ label: m.label, value: m.id }));

const languageOptions = [
  { label: '中文（zh）', value: 'zh' },
  { label: '英文（en）', value: 'en' },
  { label: '日语（ja）', value: 'ja' },
  { label: '韩语（ko）', value: 'ko' },
  { label: '俄语（ru）', value: 'ru' },
  { label: '法语（fr）', value: 'fr' },
  { label: '德语（de）', value: 'de' },
  { label: '葡萄牙语（pt）', value: 'pt' },
  { label: '泰语（th）', value: 'th' },
  { label: '印尼语（id）', value: 'id' },
  { label: '越南语（vi）', value: 'vi' },
  { label: '西班牙语（es）', value: 'es' },
  { label: '意大利语（it）', value: 'it' },
  { label: '马来语（ms）', value: 'ms' },
  { label: '菲律宾语（fil）', value: 'fil' },
  { label: '阿拉伯语（ar）', value: 'ar' },
];

// ---- 样本 ----
const sourceTab = ref<'upload' | 'record'>('upload');
const preparing = ref(false);
const sampleError = ref('');
const sample = ref<PreparedSample | null>(null);
const sampleUrl = ref('');
const sampleName = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const dragging = ref(false);

async function loadSample(blob: Blob, name: string) {
  preparing.value = true;
  sampleError.value = '';
  try {
    const s = await prepareSample(blob, { maxSeconds: 30, targetRate: 24000 });
    if (s.duration < 3) {
      sampleError.value = `样本仅 ${formatDuration(s.duration)}，太短了（至少 3 秒，建议 10–20 秒）`;
      sample.value = null;
      return;
    }
    if (sampleUrl.value) URL.revokeObjectURL(sampleUrl.value);
    sample.value = s;
    sampleName.value = name;
    sampleUrl.value = URL.createObjectURL(s.blob);
    if (s.originalDuration > 30) message.info('样本已自动裁剪为前 30 秒');
  } catch (e) {
    sampleError.value = (e as Error).message;
    sample.value = null;
  } finally {
    preparing.value = false;
  }
}

function onFileChange(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (f) loadSample(f, f.name);
}
function onDrop(ev: DragEvent) {
  dragging.value = false;
  const f = ev.dataTransfer?.files?.[0];
  if (f) loadSample(f, f.name);
}

// ---- 录音 ----
const recording = ref(false);
const recElapsed = ref(0);
const recError = ref('');
let mediaRecorder: MediaRecorder | null = null;
let mediaStream: MediaStream | null = null;
let recChunks: Blob[] = [];
let recTimer: number | undefined;

const readingScript = '今天天气不错，我准备出门散步。小区门口的桂花开了，香气淡淡的。我喜欢这样的下午，安静，又有一点风。请用自然的语气读完这段话，不要刻意模仿播音腔。';

async function startRecording() {
  recError.value = '';
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recChunks = [];
    mediaRecorder = new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      mediaStream?.getTracks().forEach((t) => t.stop());
      mediaStream = null;
      const blob = new Blob(recChunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
      if (blob.size) await loadSample(blob, '录音样本');
    };
    mediaRecorder.start();
    recording.value = true;
    recElapsed.value = 0;
    recTimer = window.setInterval(() => {
      recElapsed.value += 0.2;
      if (recElapsed.value >= 30) stopRecording();
    }, 200);
  } catch (e) {
    recError.value = `无法访问麦克风：${(e as Error).message}（可改用上传文件）`;
  }
}

function stopRecording() {
  if (recTimer) { clearInterval(recTimer); recTimer = undefined; }
  recording.value = false;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  mediaRecorder = null;
}

// ---- 配置 ----
const targetModel = ref('qwen-audio-3.1-tts-flash');
const prefix = ref('v' + Date.now().toString(36).slice(-7));
const languageHint = ref('zh');
const maxLen = ref(10);
const enablePreprocess = ref(false);
const enableVolumeNormalization = ref(false);
const modelMeta = computed(() => getModel(targetModel.value));

// ---- 创建 ----
const creating = ref(false);
const voiceId = ref('');
const status = ref<'' | 'DEPLOYING' | 'OK' | 'UNDEPLOYED'>('');
const polling = ref(false);
let pollTimer: number | undefined;

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = undefined; polling.value = false; }
}

function startPolling(id: string) {
  stopPolling();
  polling.value = true;
  let attempts = 0;
  const tick = async () => {
    attempts++;
    try {
      const v = await apiGet<{ status: string }>(`/api/voices/custom/${id}`);
      if (v.status === 'OK' || v.status === 'UNDEPLOYED') {
        status.value = v.status;
        stopPolling();
        if (v.status === 'OK') message.success('音色已可用');
        else message.warning('音色审核未通过，请更换更清晰的样本后重试');
      }
    } catch { /* 轮询失败忽略，下一轮再试 */ }
    if (attempts >= 24) stopPolling();
  };
  tick();
  pollTimer = window.setInterval(tick, 2500);
}

async function create() {
  if (!sample.value) { message.warning('请先上传或录制样本'); return; }
  if (!/^[0-9A-Za-z]{1,10}$/.test(prefix.value)) { message.warning('prefix 仅支持 1–10 位字母或数字'); return; }
  creating.value = true;
  voiceId.value = '';
  status.value = '';
  try {
    const r = await apiSend<{ voiceId: string }>('/api/voices/clone', 'POST', {
      audio: sample.value.dataUri,
      targetModel: targetModel.value,
      prefix: prefix.value,
      languageHint: languageHint.value,
      maxPromptAudioLength: maxLen.value,
      enablePreprocess: enablePreprocess.value,
      enableVolumeNormalization: enableVolumeNormalization.value,
    });
    voiceId.value = r.voiceId;
    status.value = 'DEPLOYING';
    startPolling(r.voiceId);
    message.success('已提交创建，正在审核（通常几十秒）');
  } catch (e) {
    message.error(e instanceof ApiError ? `${e.message}${e.code ? `（${e.code}）` : ''}` : (e as Error).message);
  } finally {
    creating.value = false;
  }
}

// ---- 试音 ----
const testing = ref(false);
async function testPlay() {
  if (!voiceId.value) return;
  testing.value = true;
  try {
    const m = modelMeta.value;
    const params: Record<string, unknown> = { format: 'mp3', sample_rate: 24000 };
    if (m?.supportsProsody) { params.rate = 1; params.pitch = 1; params.volume = 50; }
    const r = await synthesizeToBlob({
      model: targetModel.value, voice: voiceId.value,
      text: '你好，我是你的专属复刻音色，很高兴为你服务。', params,
    });
    new Audio(URL.createObjectURL(r.blob)).play();
  } catch (e) {
    message.error(`试音失败：${(e as Error).message}`);
  } finally {
    testing.value = false;
  }
}

onBeforeUnmount(() => {
  stopPolling();
  stopRecording();
  if (sampleUrl.value) URL.revokeObjectURL(sampleUrl.value);
});
</script>

<template>
  <div class="clone">
    <n-card size="small" title="① 提供声音样本">
      <n-tabs v-model:value="sourceTab" type="line">
        <n-tab-pane name="upload" tab="上传文件">
          <div
            class="dropzone"
            :class="{ dragging }"
            @click="fileInput?.click()"
            @dragover.prevent="dragging = true"
            @dragleave.prevent="dragging = false"
            @drop.prevent="onDrop"
          >
            <div class="dz-icon">📁</div>
            <div>点击选择或拖拽音频文件到这里</div>
            <n-text depth="3" style="font-size: 12px">支持 wav / mp3 / m4a / webm 等；建议 10–20 秒清晰人声，最长 30 秒</n-text>
            <input ref="fileInput" type="file" accept="audio/*" style="display:none" @change="onFileChange" />
          </div>
        </n-tab-pane>
        <n-tab-pane name="record" tab="浏览器录音">
          <div class="record-box">
            <n-text depth="3" style="font-size: 12px">请朗读以下段落（约 15–20 秒），环境尽量安静：</n-text>
            <div class="script">{{ readingScript }}</div>
            <div class="rec-row">
              <n-button v-if="!recording" type="primary" size="small" @click="startRecording">● 开始录音</n-button>
              <n-button v-else type="error" size="small" @click="stopRecording">■ 停止（{{ recElapsed.toFixed(1) }}s / 30s）</n-button>
              <n-text v-if="recording" depth="3" style="font-size: 12px">正在录音…</n-text>
            </div>
            <n-alert v-if="recError" type="error" :bordered="false" style="margin-top: 8px">{{ recError }}</n-alert>
          </div>
        </n-tab-pane>
      </n-tabs>

      <div v-if="preparing" style="margin-top: 12px"><n-spin :size="16" /> <n-text depth="3">正在解码并转换样本…</n-text></div>
      <n-alert v-if="sampleError" type="error" :bordered="false" style="margin-top: 12px">{{ sampleError }}</n-alert>

      <div v-if="sample" class="sample-info">
        <n-space align="center" :size="10" style="flex-wrap: wrap">
          <n-tag type="success" :bordered="false">样本就绪</n-tag>
          <n-text style="font-size: 12px">{{ sampleName }} · 时长 {{ formatDuration(sample.duration) }} · 已转换为 24kHz 单声道 WAV</n-text>
          <audio :src="sampleUrl" controls style="height: 32px" />
        </n-space>
      </div>
    </n-card>

    <n-card size="small" title="② 配置复刻参数" style="margin-top: 14px">
      <n-form label-placement="top" size="small">
        <n-form-item>
          <template #label>
            <span class="param-label">
              目标模型
              <n-tooltip trigger="hover" :delay="100">
                <template #trigger><span class="qmark">?</span></template>
                <div class="tip">创建音色时绑定的合成模型。复刻音色只能在该模型下使用，创建后不可更换；如需在其他模型使用，请重新创建。</div>
              </n-tooltip>
            </span>
          </template>
          <n-select v-model:value="targetModel" :options="targetOptions" style="max-width: 420px" />
        </n-form-item>
        <n-alert v-if="modelMeta?.note" type="info" :bordered="false" style="margin-bottom: 12px">
          {{ modelMeta.note }}
        </n-alert>
        <n-space :size="16" style="flex-wrap: wrap">
          <n-form-item>
            <template #label>
              <span class="param-label">
                音色前缀
                <n-tooltip trigger="hover" :delay="100">
                  <template #trigger><span class="qmark">?</span></template>
                  <div class="tip">仅字母/数字，最长 10 位，用于生成音色 ID 并在列表中识别（如 brand01）。最终 ID 形如「目标模型-前缀-随机串」。</div>
                </n-tooltip>
              </span>
            </template>
            <n-input v-model:value="prefix" style="width: 180px" placeholder="字母/数字，≤10 位" />
          </n-form-item>
          <n-form-item>
            <template #label>
              <span class="param-label">
                语言倾向
                <n-tooltip trigger="hover" :delay="100">
                  <template #trigger><span class="qmark">?</span></template>
                  <div class="tip">样本的主要语言，默认中文（zh）。选择与样本一致的语言可提升复刻相似度；复刻音色还支持多种中文方言与外语。</div>
                </n-tooltip>
              </span>
            </template>
            <n-select v-model:value="languageHint" :options="languageOptions" style="width: 180px" />
          </n-form-item>
          <n-form-item>
            <template #label>
              <span class="param-label">
                样本截取长度 {{ maxLen }}s
                <n-tooltip trigger="hover" :delay="100">
                  <template #trigger><span class="qmark">?</span></template>
                  <div class="tip">从样本开头截取多少秒参与复刻（3–30 秒）。建议 10–20 秒：太短音色特征不足，太长可能混入噪声；超出部分不会使用。</div>
                </n-tooltip>
              </span>
            </template>
            <n-slider v-model:value="maxLen" :min="3" :max="30" :step="1" style="width: 180px" />
          </n-form-item>
        </n-space>
        <n-space :size="16">
          <n-form-item>
            <template #label>
              <span class="param-label">
                启用预处理
                <n-tooltip trigger="hover" :delay="100">
                  <template #trigger><span class="qmark">?</span></template>
                  <div class="tip">由上游对参考音频做降噪、清洗等预处理。样本环境嘈杂时建议开启；本身很干净时可保持关闭，避免音色细节被削弱。</div>
                </n-tooltip>
              </span>
            </template>
            <n-switch v-model:value="enablePreprocess" size="small" />
          </n-form-item>
          <n-form-item>
            <template #label>
              <span class="param-label">
                音量归一化
                <n-tooltip trigger="hover" :delay="100">
                  <template #trigger><span class="qmark">?</span></template>
                  <div class="tip">把样本响度统一到标准水平。录音音量偏小、复刻音色发虚时建议开启；样本本身音量正常时可不开启。</div>
                </n-tooltip>
              </span>
            </template>
            <n-switch v-model:value="enableVolumeNormalization" size="small" />
          </n-form-item>
        </n-space>
      </n-form>
      <n-divider style="margin: 4px 0 12px" />
      <n-button type="primary" :loading="creating" :disabled="!sample" @click="create">创建复刻音色</n-button>
    </n-card>

    <n-card v-if="voiceId" size="small" title="③ 创建结果" style="margin-top: 14px">
      <n-space vertical :size="10">
        <n-space align="center" :size="8">
          <n-text depth="3" style="font-size: 12px">voice_id</n-text>
          <n-text code style="font-size: 12px">{{ voiceId }}</n-text>
        </n-space>
        <n-space align="center" :size="8">
          <n-text depth="3" style="font-size: 12px">状态</n-text>
          <n-tag v-if="status === 'OK'" type="success" :bordered="false">可用</n-tag>
          <n-tag v-else-if="status === 'UNDEPLOYED'" type="error" :bordered="false">审核未通过</n-tag>
          <n-tag v-else type="warning" :bordered="false">
            审核中{{ polling ? '…' : '' }}
          </n-tag>
          <n-button size="tiny" quaternary :loading="testing" :disabled="status !== 'OK'" @click="testPlay">试音</n-button>
        </n-space>
        <n-alert v-if="status === 'UNDEPLOYED'" type="warning" :bordered="false">
          请使用更安静、更清晰的 10–20 秒人声样本重试（避免背景音乐与多人说话）。
        </n-alert>
        <n-space :size="8">
          <n-button size="small" @click="router.push('/library')">前往声音库</n-button>
          <n-button size="small" quaternary @click="router.push('/advanced')">在高级模式中使用</n-button>
        </n-space>
      </n-space>
    </n-card>
  </div>
</template>

<style scoped>
.dropzone {
  border: 1.5px dashed rgba(128,128,128,.4); border-radius: 10px; padding: 30px 16px; text-align: center;
  cursor: pointer; transition: all .15s; display: flex; flex-direction: column; gap: 6px; align-items: center;
}
.dropzone:hover, .dropzone.dragging { border-color: #3a8bff; background: rgba(58,139,255,.06); }
.dz-icon { font-size: 28px; }
.record-box { display: flex; flex-direction: column; gap: 10px; }
.rec-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.script { padding: 10px 12px; border-radius: 6px; background: rgba(128,128,128,.1); font-size: 13px; line-height: 1.8; }
.sample-info { margin-top: 12px; padding: 10px 12px; border-radius: 6px; background: rgba(58,139,255,.06); }
.param-label { display: inline-flex; align-items: center; }
.qmark {
  display: inline-flex; align-items: center; justify-content: center;
  width: 14px; height: 14px; margin-left: 4px; border-radius: 50%;
  border: 1px solid currentColor; font-size: 10px; line-height: 1; font-weight: 600;
  opacity: .45; cursor: help; user-select: none; transition: opacity .15s;
}
.qmark:hover { opacity: .95; }
.tip { max-width: 280px; line-height: 1.6; font-size: 12px; }
</style>
