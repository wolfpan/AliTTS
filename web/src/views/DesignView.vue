<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  NCard, NButton, NSpace, NText, NAlert, NForm, NFormItem, NSelect, NInput, NTag, NDivider,
  useMessage,
} from 'naive-ui';
import { MODELS } from '../data/models';
import { apiGet, apiSend, ApiError } from '../api/client';
import { base64ToBytes, pcmToWav, MIME_BY_FORMAT } from '../audio/assemble';

const router = useRouter();
const message = useMessage();

const targetOptions = MODELS
  .filter((m) => m.id !== 'qwen3-tts-flash' && m.id !== 'cosyvoice-v2')
  .map((m) => ({ label: m.label, value: m.id }));

const PROMPT_GROUPS: Array<{ title: string; chips: string[] }> = [
  { title: '性别/年龄', chips: ['年轻女性', '年轻男性', '中年男性', '中年女性', '老年男性', '老年女性'] },
  { title: '音色质感', chips: ['低沉浑厚', '清亮通透', '磁性', '沙哑', '甜美', '温柔', '空灵', '播音腔'] },
  { title: '风格', chips: ['沉稳播报', '温柔陪伴', '活泼俏皮', '游戏角色', '有声书旁白', '广告配音'] },
  { title: '适用场景', chips: ['适合广告配音', '适合有声书', '适合游戏 NPC', '适合客服播报'] },
];

const PRESET_PROMPTS = [
  '沉稳的中年男性播音员，音色低沉浑厚，语速偏慢，适合纪录片旁白',
  '年轻女性，声音清亮甜美，语气亲切活泼，适合短视频口播',
  '老年男性，音色沧桑有质感，适合历史故事讲述',
  '温柔知性的女性，声音柔和自然，适合睡前故事与陪伴场景',
  '沙哑磁性的男性，情绪克制，适合悬疑小说旁白',
  '活泼可爱的少女音，语速轻快，适合游戏角色配音',
];

const PREVIEW_SAMPLES = [
  '各位听众朋友们大家好，欢迎收听本期节目。',
  '夜风轻轻吹过窗台，我带你去看看这座小城的故事。',
  '欢迎光临，今天为您准备了最新鲜的食材和最用心的服务。',
];

const voicePrompt = ref('');
const promptLen = computed(() => voicePrompt.value.length);

const previewText = ref(PREVIEW_SAMPLES[0]);
const previewLen = computed(() => previewText.value.length);

const targetModel = ref('qwen-audio-3.1-tts-flash');
const prefix = ref('d' + Date.now().toString(36).slice(-7));
const languageHint = ref('zh');
const sampleRate = ref(24000);
const format = ref<'wav' | 'mp3' | 'pcm'>('wav');

const rateOptions = [
  { label: '16000 Hz', value: 16000 },
  { label: '24000 Hz', value: 24000 },
  { label: '48000 Hz', value: 48000 },
];
const formatOptions = [
  { label: 'WAV', value: 'wav' },
  { label: 'MP3', value: 'mp3' },
  { label: 'PCM', value: 'pcm' },
];
const langOptions = [
  { label: '中文（zh）', value: 'zh' },
  { label: '英文（en）', value: 'en' },
];

function appendChip(text: string) {
  voicePrompt.value = voicePrompt.value
    ? voicePrompt.value.replace(/[，。,\s]+$/, '') + '，' + text
    : text;
}

// ---- 创建 ----
const creating = ref(false);
const voiceId = ref('');
const status = ref<'' | 'DEPLOYING' | 'OK' | 'UNDEPLOYED'>('');
const previewUrl = ref('');
const polling = ref(false);
let pollTimer: number | undefined;
let pollAttempts = 0;

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = undefined; polling.value = false; }
}

function startPolling(id: string) {
  stopPolling();
  polling.value = true;
  pollAttempts = 0;
  const tick = async () => {
    pollAttempts++;
    try {
      const v = await apiGet<{ status: string }>(`/api/voices/custom/${id}`);
      if (v.status === 'OK' || v.status === 'UNDEPLOYED') {
        status.value = v.status;
        stopPolling();
        if (v.status === 'OK') message.success('音色已可用，可在声音库与高级模式中使用');
      }
    } catch { /* 忽略单次失败 */ }
    if (pollAttempts >= 24) stopPolling();
  };
  tick();
  pollTimer = window.setInterval(tick, 2500);
}

function playPreview(data: string, fmt: string, rate: number) {
  let bytes = base64ToBytes(data);
  let mime = MIME_BY_FORMAT[fmt] || 'audio/wav';
  if (fmt === 'pcm') { bytes = pcmToWav(bytes, rate || 24000); mime = 'audio/wav'; }
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  const blob = new Blob([bytes], { type: mime });
  previewUrl.value = URL.createObjectURL(blob);
  new Audio(previewUrl.value).play().catch(() => {});
}

async function create() {
  const prompt = voicePrompt.value.trim();
  if (prompt.length < 2) { message.warning('请描述你想要的声音（至少几个字）'); return; }
  if (prompt.length > 500) { message.warning('声音描述需 ≤500 字'); return; }
  if (previewLen.value < 15 || previewLen.value > 200) { message.warning('预览文本需 15–200 字'); return; }
  if (!/^[0-9A-Za-z]{1,10}$/.test(prefix.value)) { message.warning('prefix 仅支持 1–10 位字母或数字'); return; }

  creating.value = true;
  voiceId.value = '';
  status.value = '';
  if (previewUrl.value) { URL.revokeObjectURL(previewUrl.value); previewUrl.value = ''; }
  try {
    const r = await apiSend<{
      voiceId: string;
      previewAudio: { data: string; sampleRate: number; format: string } | null;
    }>('/api/voices/design', 'POST', {
      voicePrompt: prompt,
      previewText: previewText.value.trim(),
      targetModel: targetModel.value,
      prefix: prefix.value,
      languageHint: languageHint.value,
      sampleRate: sampleRate.value,
      format: format.value,
    });
    voiceId.value = r.voiceId;
    status.value = 'DEPLOYING';
    startPolling(r.voiceId);
    if (r.previewAudio) playPreview(r.previewAudio.data, r.previewAudio.format, r.previewAudio.sampleRate);
    message.success('已创建设计音色并生成试听');
    // 每次创建都会产生新音色，换一个 prefix 避免混淆
    prefix.value = 'd' + Date.now().toString(36).slice(-7);
  } catch (e) {
    message.error(e instanceof ApiError ? `${e.message}${e.code ? `（${e.code}）` : ''}` : (e as Error).message);
  } finally {
    creating.value = false;
  }
}

onBeforeUnmount(() => {
  stopPolling();
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
});
</script>

<template>
  <div class="design">
    <n-card size="small" title="① 描述你想要的声音">
      <n-space :size="4" style="flex-wrap: wrap; margin-bottom: 8px">
        <n-text depth="3" style="font-size: 11px">灵感模板：</n-text>
        <n-button v-for="(p, i) in PRESET_PROMPTS" :key="i" size="tiny" quaternary @click="voicePrompt = p">
          模板 {{ i + 1 }}
        </n-button>
      </n-space>
      <n-input v-model:value="voicePrompt" type="textarea" :autosize="{ minRows: 3, maxRows: 6 }"
        :maxlength="500" show-count placeholder="例如：沉稳的中年男性，音色低沉浑厚，语速偏慢，适合纪录片旁白" />
      <n-space v-for="g in PROMPT_GROUPS" :key="g.title" :size="4" style="margin-top: 8px; flex-wrap: wrap">
        <n-text depth="3" style="font-size: 11px; width: 62px">{{ g.title }}</n-text>
        <n-button v-for="c in g.chips" :key="c" size="tiny" quaternary @click="appendChip(c)">{{ c }}</n-button>
      </n-space>
    </n-card>

    <n-card size="small" title="② 预览文本与参数" style="margin-top: 14px">
      <n-space :size="4" style="margin-bottom: 6px">
        <n-text depth="3" style="font-size: 11px">示例：</n-text>
        <n-button v-for="(s, i) in PREVIEW_SAMPLES" :key="i" size="tiny" quaternary @click="previewText = s">
          示例 {{ i + 1 }}
        </n-button>
      </n-space>
      <n-input v-model:value="previewText" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }"
        :maxlength="200" show-count placeholder="15–200 字的试听文本" />
      <n-form label-placement="top" size="small" style="margin-top: 10px">
        <n-space :size="16" style="flex-wrap: wrap">
          <n-form-item label="目标模型（创建后只能用同一模型合成）">
            <n-select v-model:value="targetModel" :options="targetOptions" style="width: 300px" />
          </n-form-item>
          <n-form-item label="音色前缀（字母/数字，≤10）">
            <n-input v-model:value="prefix" style="width: 160px" />
          </n-form-item>
          <n-form-item label="语言倾向">
            <n-select v-model:value="languageHint" :options="langOptions" style="width: 150px" />
          </n-form-item>
          <n-form-item label="预览采样率">
            <n-select v-model:value="sampleRate" :options="rateOptions" style="width: 130px" />
          </n-form-item>
          <n-form-item label="预览格式">
            <n-select v-model:value="format" :options="formatOptions" style="width: 110px" />
          </n-form-item>
        </n-space>
      </n-form>
      <n-divider style="margin: 4px 0 12px" />
      <n-space align="center" :size="10">
        <n-button type="primary" :loading="creating" @click="create">创建设计音色</n-button>
        <n-text depth="3" style="font-size: 12px">每次创建都会生成一个新音色（消耗一次额度），不满意请调整描述后重新生成</n-text>
      </n-space>
    </n-card>

    <n-card v-if="voiceId" size="small" title="③ 试听与入库" style="margin-top: 14px">
      <n-space vertical :size="10">
        <n-space align="center" :size="8">
          <n-text depth="3" style="font-size: 12px">voice_id</n-text>
          <n-text code style="font-size: 12px">{{ voiceId }}</n-text>
          <n-tag v-if="status === 'OK'" type="success" :bordered="false">可用</n-tag>
          <n-tag v-else-if="status === 'UNDEPLOYED'" type="error" :bordered="false">审核未通过</n-tag>
          <n-tag v-else type="warning" :bordered="false">审核中{{ polling ? '…' : '' }}</n-tag>
        </n-space>
        <audio v-if="previewUrl" :src="previewUrl" controls style="width: 100%; max-width: 480px" />
        <n-space :size="8">
          <n-button size="small" @click="router.push('/library')">前往声音库</n-button>
          <n-button size="small" quaternary @click="router.push('/advanced')">在高级模式中使用</n-button>
        </n-space>
      </n-space>
    </n-card>
  </div>
</template>
