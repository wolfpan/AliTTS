<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  NDrawer, NDrawerContent, NInput, NSelect, NGrid, NGi, NTag, NButton, NSpace, NText, NEmpty, NTabs, NTabPane,
  NSpin, useMessage,
} from 'naive-ui';
import { voicesForModel, LANGS, SCENES, type VoiceEntry } from '../data/voiceCatalog';
import { getModel } from '../data/models';
import { synthesizeToBlob } from '../audio/synth';
import { apiGet } from '../api/client';

const props = defineProps<{ show: boolean; modelId: string; selectedId: string }>();
const emit = defineEmits<{ (e: 'update:show', v: boolean): void; (e: 'select', v: VoiceEntry): void }>();
const message = useMessage();
const router = useRouter();

const tab = ref('system');
const keyword = ref('');
const gender = ref<string | null>(null);
const lang = ref<string | null>(null);
const scene = ref<string | null>(null);
const previewing = ref('');
let previewAudio: HTMLAudioElement | null = null;

const modelMeta = computed(() => getModel(props.modelId));
const all = computed(() => voicesForModel(props.modelId));

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return all.value.filter((v) => {
    if (gender.value && v.gender !== gender.value) return false;
    if (lang.value && !v.langs.includes(lang.value)) return false;
    if (scene.value && !v.scenes.includes(scene.value)) return false;
    if (kw) {
      const hay = `${v.id} ${v.name} ${v.tags.join(' ')} ${v.note || ''}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
});

const genderOptions = [
  { label: '全部性别', value: '' },
  { label: '女', value: '女' },
  { label: '男', value: '男' },
];
const langOptions = [{ label: '全部语言', value: '' }, ...LANGS.map((l) => ({ label: l, value: l }))];
const sceneOptions = [{ label: '全部场景', value: '' }, ...SCENES.map((s) => ({ label: s, value: s }))];

// ---- 自定义音色 ----
interface CustomVoice {
  voiceId: string; status: string; kind: 'clone' | 'design'; targetModel: string; alias: string; prompt: string;
}
const customItems = ref<CustomVoice[]>([]);
const customLoading = ref(false);

async function loadCustom() {
  customLoading.value = true;
  try {
    const r = await apiGet<{ items: CustomVoice[] }>('/api/voices/custom');
    customItems.value = r.items.filter((v) => v.targetModel === props.modelId);
  } catch {
    customItems.value = [];
  } finally {
    customLoading.value = false;
  }
}

watch(() => props.show, (v) => {
  if (v) loadCustom();
});
watch(() => props.modelId, () => {
  keyword.value = '';
  gender.value = null;
  lang.value = null;
  scene.value = null;
  loadCustom();
});

const customByKind = (kind: 'clone' | 'design') => customItems.value.filter((v) => v.kind === kind);

function pick(v: VoiceEntry) {
  emit('select', v);
  emit('update:show', false);
}

function customDisplayName(v: CustomVoice) {
  return v.alias || `${v.kind === 'clone' ? '复刻' : '设计'} · ${v.voiceId.slice(-6)}`;
}

function pickCustom(v: CustomVoice) {
  pick({
    id: v.voiceId,
    name: customDisplayName(v),
    gender: '女',
    langs: [],
    scenes: [],
    tags: [v.kind === 'clone' ? '复刻音色' : '设计音色'],
    models: [props.modelId],
    custom: true,
    kind: v.kind,
  });
}

async function previewVoice(id: string) {
  if (previewing.value) return;
  previewing.value = id;
  try {
    const m = modelMeta.value;
    const params: Record<string, unknown> = { format: 'mp3', sample_rate: 24000 };
    if (m?.supportsProsody) { params.rate = 1; params.pitch = 1; params.volume = 50; }
    if (m?.supportsLanguageType) params.language_type = 'Chinese';
    const r = await synthesizeToBlob({
      model: props.modelId,
      voice: id,
      text: '你好，这是我的声音，很高兴认识你。',
      params,
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

const statusTag = (s: string) => (s === 'OK' ? '可用' : s === 'UNDEPLOYED' ? '未通过' : '审核中');
</script>

<template>
  <n-drawer :show="show" :width="680" placement="right" @update:show="emit('update:show', $event)">
    <n-drawer-content :title="`选择音色 · ${modelMeta?.label || modelId}`" closable>
      <n-tabs v-model:value="tab" type="line">
        <n-tab-pane name="system" :tab="`系统音色（${all.length}）`">
          <n-space vertical :size="12">
            <n-space :size="8" align="center" style="flex-wrap: wrap">
              <n-input v-model:value="keyword" placeholder="搜索名称 / 标签" clearable style="width: 180px" size="small" />
              <n-select v-model:value="gender" :options="genderOptions" size="small" style="width: 110px" />
              <n-select v-model:value="lang" :options="langOptions" size="small" style="width: 130px" />
              <n-select v-model:value="scene" :options="sceneOptions" size="small" style="width: 140px" />
              <n-text depth="3" style="font-size: 12px">共 {{ filtered.length }} 个可用音色</n-text>
            </n-space>
            <n-empty v-if="!filtered.length" description="该模型下没有匹配的系统音色" />
            <div class="voice-scroll">
              <n-grid :cols="3" :x-gap="10" :y-gap="10" item-responsive responsive="screen">
                <n-gi v-for="v in filtered" :key="v.id" span="3 s:2 m:1">
                  <div class="vc" :class="{ active: v.id === selectedId }" @click="pick(v)">
                    <div class="vc-head">
                      <n-tag size="tiny" :bordered="false" :type="v.gender === '女' ? 'error' : 'info'">{{ v.gender }}</n-tag>
                      <span class="vc-name">{{ v.name }}</span>
                      <n-button text size="tiny" type="primary" :loading="previewing === v.id" @click.stop="previewVoice(v.id)">试听</n-button>
                    </div>
                    <div class="vc-tags">
                      <span v-for="t in v.tags.slice(0, 3)" :key="t" class="vc-tag">{{ t }}</span>
                    </div>
                    <div class="vc-id">{{ v.id }}</div>
                  </div>
                </n-gi>
              </n-grid>
            </div>
          </n-space>
        </n-tab-pane>

        <n-tab-pane name="clone" :tab="`我的复刻（${customByKind('clone').length}）`">
          <n-space vertical :size="10">
            <n-space justify="end" :size="8">
              <n-button size="tiny" :loading="customLoading" @click="loadCustom">刷新</n-button>
              <n-button size="tiny" quaternary type="primary" @click="router.push('/clone')">+ 新建复刻</n-button>
            </n-space>
            <n-spin v-if="customLoading" :size="14" />
            <n-empty v-else-if="!customByKind('clone').length"
              :description="`当前模型（${modelId}）下没有复刻音色；注意复刻音色与创建时的目标模型绑定`" />
            <div v-else class="voice-scroll">
              <n-grid :cols="3" :x-gap="10" :y-gap="10" item-responsive responsive="screen">
                <n-gi v-for="v in customByKind('clone')" :key="v.voiceId" span="3 s:2 m:1">
                  <div class="vc" :class="{ active: v.voiceId === selectedId, disabled: v.status !== 'OK' }"
                    @click="v.status === 'OK' && pickCustom(v)">
                    <div class="vc-head">
                      <n-tag size="tiny" :bordered="false" type="info">复刻</n-tag>
                      <span class="vc-name">{{ customDisplayName(v) }}</span>
                      <n-button text size="tiny" type="primary" :disabled="v.status !== 'OK'"
                        :loading="previewing === v.voiceId" @click.stop="previewVoice(v.voiceId)">试听</n-button>
                    </div>
                    <div class="vc-tags"><span class="vc-tag">{{ statusTag(v.status) }}</span></div>
                    <div class="vc-id">{{ v.voiceId }}</div>
                  </div>
                </n-gi>
              </n-grid>
            </div>
          </n-space>
        </n-tab-pane>

        <n-tab-pane name="design" :tab="`我的设计（${customByKind('design').length}）`">
          <n-space vertical :size="10">
            <n-space justify="end" :size="8">
              <n-button size="tiny" :loading="customLoading" @click="loadCustom">刷新</n-button>
              <n-button size="tiny" quaternary type="primary" @click="router.push('/design')">+ 新建设计</n-button>
            </n-space>
            <n-spin v-if="customLoading" :size="14" />
            <n-empty v-else-if="!customByKind('design').length"
              :description="`当前模型（${modelId}）下没有设计音色；注意设计音色与创建时的目标模型绑定`" />
            <div v-else class="voice-scroll">
              <n-grid :cols="3" :x-gap="10" :y-gap="10" item-responsive responsive="screen">
                <n-gi v-for="v in customByKind('design')" :key="v.voiceId" span="3 s:2 m:1">
                  <div class="vc" :class="{ active: v.voiceId === selectedId, disabled: v.status !== 'OK' }"
                    @click="v.status === 'OK' && pickCustom(v)">
                    <div class="vc-head">
                      <n-tag size="tiny" :bordered="false" type="warning">设计</n-tag>
                      <span class="vc-name">{{ customDisplayName(v) }}</span>
                      <n-button text size="tiny" type="primary" :disabled="v.status !== 'OK'"
                        :loading="previewing === v.voiceId" @click.stop="previewVoice(v.voiceId)">试听</n-button>
                    </div>
                    <div class="vc-tags">
                      <span class="vc-tag">{{ statusTag(v.status) }}</span>
                      <span v-if="v.prompt" class="vc-tag" :title="v.prompt">{{ v.prompt.slice(0, 18) }}…</span>
                    </div>
                    <div class="vc-id">{{ v.voiceId }}</div>
                  </div>
                </n-gi>
              </n-grid>
            </div>
          </n-space>
        </n-tab-pane>
      </n-tabs>
    </n-drawer-content>
  </n-drawer>
</template>

<style scoped>
.voice-scroll { max-height: calc(100vh - 230px); overflow-y: auto; padding-right: 4px; }
.vc { border: 1.5px solid rgba(128,128,128,.22); border-radius: 8px; padding: 8px 10px; cursor: pointer; transition: all .15s; }
.vc:hover { border-color: rgba(64,128,255,.5); }
.vc.active { border-color: #3a8bff; background: rgba(58,139,255,.08); }
.vc.disabled { opacity: .55; cursor: not-allowed; }
.vc-head { display: flex; align-items: center; gap: 6px; }
.vc-name { font-weight: 600; flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vc-tags { display: flex; gap: 6px; margin-top: 4px; flex-wrap: wrap; }
.vc-tag { font-size: 11px; opacity: .65; }
.vc-id { font-size: 10px; opacity: .4; margin-top: 4px; font-family: monospace; }
</style>
