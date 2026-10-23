<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  NCard, NButton, NSpace, NText, NInput, NSelect, NTag, NDataTable, NEmpty, NModal, NSpin,
  useDialog, useMessage, type DataTableColumns,
} from 'naive-ui';
import { apiGet, apiSend } from '../api/client';
import { getModel } from '../data/models';
import { synthesizeToBlob } from '../audio/synth';
import { prepareSample } from '../audio/samplePrep';

interface CustomVoice {
  voiceId: string;
  status: string;
  kind: 'clone' | 'design';
  targetModel: string;
  prefix: string;
  alias: string;
  languageHints: string[];
  prompt: string;
  gmtCreate: string;
  gmtModified: string;
  createdTs: number;
}

const router = useRouter();
const dialog = useDialog();
const message = useMessage();

const items = ref<CustomVoice[]>([]);
const loading = ref(false);
const keyword = ref('');
const kindFilter = ref<string | null>(null);
const statusFilter = ref<string | null>(null);

const kindOptions = [
  { label: '全部类型', value: '' },
  { label: '复刻', value: 'clone' },
  { label: '设计', value: 'design' },
];
const statusOptions = [
  { label: '全部状态', value: '' },
  { label: '可用', value: 'OK' },
  { label: '审核中', value: 'DEPLOYING' },
  { label: '未通过', value: 'UNDEPLOYED' },
];

const filtered = computed(() => items.value.filter((v) => {
  if (kindFilter.value && v.kind !== kindFilter.value) return false;
  if (statusFilter.value && v.status !== statusFilter.value) return false;
  const kw = keyword.value.trim().toLowerCase();
  if (kw) {
    const hay = `${v.voiceId} ${v.alias} ${v.targetModel} ${v.prompt}`.toLowerCase();
    if (!hay.includes(kw)) return false;
  }
  return true;
}));

async function refresh() {
  loading.value = true;
  try {
    const r = await apiGet<{ items: CustomVoice[] }>('/api/voices/custom');
    items.value = r.items;
  } catch (e) {
    message.error(`加载音色失败：${(e as Error).message}`);
  } finally {
    loading.value = false;
  }
}
onMounted(refresh);

const statusType = (s: string) => (s === 'OK' ? 'success' : s === 'UNDEPLOYED' ? 'error' : 'warning');
const statusLabel = (s: string) => (s === 'OK' ? '可用' : s === 'UNDEPLOYED' ? '未通过' : '审核中');

// ---- 试听 ----
const previewing = ref('');
const previewUrl = ref('');
function playBlob(b: Blob) {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = URL.createObjectURL(b);
  new Audio(previewUrl.value).play().catch(() => {});
}
async function preview(v: CustomVoice) {
  if (previewing.value) return;
  const m = getModel(v.targetModel);
  if (!m) { message.warning('无法识别该音色的目标模型，暂不能试听'); return; }
  previewing.value = v.voiceId;
  try {
    const params: Record<string, unknown> = { format: 'mp3', sample_rate: 24000 };
    if (m.supportsProsody) { params.rate = 1; params.pitch = 1; params.volume = 50; }
    const r = await synthesizeToBlob({ model: v.targetModel, voice: v.voiceId, text: '你好，这是我的声音，很高兴认识你。', params });
    playBlob(r.blob);
  } catch (e) {
    message.error(`试听失败：${(e as Error).message}`);
  } finally {
    previewing.value = '';
  }
}

// ---- 别名 ----
const aliasModal = ref(false);
const aliasTarget = ref<CustomVoice | null>(null);
const aliasValue = ref('');
function openAlias(v: CustomVoice) {
  aliasTarget.value = v;
  aliasValue.value = v.alias;
  aliasModal.value = true;
}
async function saveAlias() {
  if (!aliasTarget.value) return;
  try {
    await apiSend(`/api/voices/custom/${aliasTarget.value.voiceId}`, 'PATCH', { alias: aliasValue.value });
    message.success('已保存别名');
    aliasModal.value = false;
    refresh();
  } catch (e) {
    message.error(`保存失败：${(e as Error).message}`);
  }
}

// ---- 换样本 ----
const updateModal = ref(false);
const updateTarget = ref<CustomVoice | null>(null);
const updating = ref(false);
const updateBusy = ref(false);
const updateFileName = ref('');
let pendingAudio = '';

function openUpdate(v: CustomVoice) {
  updateTarget.value = v;
  updateFileName.value = '';
  pendingAudio = '';
  updateModal.value = true;
}
async function onUpdateFile(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f) return;
  updateBusy.value = true;
  try {
    const s = await prepareSample(f, { maxSeconds: 30, targetRate: 24000 });
    pendingAudio = s.dataUri;
    updateFileName.value = `${f.name}（${s.duration.toFixed(1)}s）`;
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    updateBusy.value = false;
  }
}
async function doUpdate() {
  if (!updateTarget.value || !pendingAudio) return;
  updating.value = true;
  try {
    await apiSend(`/api/voices/custom/${updateTarget.value.voiceId}/update`, 'POST', { audio: pendingAudio });
    message.success('已提交新样本，音色重新审核中');
    updateModal.value = false;
    refresh();
  } catch (e) {
    message.error(`更新失败：${(e as Error).message}`);
  } finally {
    updating.value = false;
  }
}

// ---- 删除 ----
function remove(v: CustomVoice) {
  dialog.warning({
    title: '删除音色',
    content: `删除后该音色不可恢复，使用它的合成会失败。确定删除 ${v.alias || v.voiceId}？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await apiSend(`/api/voices/custom/${v.voiceId}`, 'DELETE');
        message.success('已删除');
        refresh();
      } catch (e) {
        message.error(`删除失败：${(e as Error).message}`);
      }
    },
  });
}

const columns: DataTableColumns<CustomVoice> = [
  {
    title: '音色', key: 'alias',
    render: (v) => h('div', [
      h('div', { style: 'font-size:13px;font-weight:600' },
        v.alias || `${v.kind === 'clone' ? '复刻' : '设计'} · ${v.voiceId.slice(-6)}`),
      h('div', { style: 'font-size:10px;opacity:.45;font-family:monospace' }, v.voiceId),
    ]),
  },
  {
    title: '类型', key: 'kind', width: 78,
    render: (v) => h(NTag, { size: 'small', bordered: false, type: v.kind === 'clone' ? 'info' : 'warning' },
      { default: () => (v.kind === 'clone' ? '复刻' : '设计') }),
  },
  {
    title: '目标模型', key: 'targetModel', width: 210,
    render: (v) => h('span', { style: 'font-size:12px' }, v.targetModel || '未知'),
  },
  {
    title: '状态', key: 'status', width: 90,
    render: (v) => h(NTag, { size: 'small', bordered: false, type: statusType(v.status) }, { default: () => statusLabel(v.status) }),
  },
  {
    title: '创建', key: 'gmtCreate', width: 150,
    render: (v) => h('span', { style: 'font-size:12px' },
      v.gmtCreate ? String(v.gmtCreate).replace('T', ' ').slice(0, 19) : '—'),
  },
  {
    title: '操作', key: 'actions', width: 280,
    render: (v) => h(NSpace, { size: 4 }, {
      default: () => [
        h(NButton, { size: 'tiny', disabled: v.status !== 'OK', loading: previewing.value === v.voiceId, onClick: () => preview(v) }, { default: () => '试听' }),
        h(NButton, { size: 'tiny', quaternary: true, onClick: () => openAlias(v) }, { default: () => '别名' }),
        v.kind === 'clone' ? h(NButton, { size: 'tiny', quaternary: true, onClick: () => openUpdate(v) }, { default: () => '换样本' }) : null,
        h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => remove(v) }, { default: () => '删除' }),
      ],
    }),
  },
];
</script>

<template>
  <div class="library">
    <n-card size="small">
      <template #header>
        <n-space align="center" :size="10">
          <span>声音库</span>
          <n-tag size="small" :bordered="false">{{ items.length }} 个自定义音色</n-tag>
        </n-space>
      </template>
      <template #header-extra>
        <n-space :size="8">
          <n-button size="small" type="primary" quaternary @click="router.push('/clone')">🎙 声音复刻</n-button>
          <n-button size="small" type="primary" quaternary @click="router.push('/design')">🎨 声音设计</n-button>
          <n-button size="small" :loading="loading" @click="refresh">刷新</n-button>
        </n-space>
      </template>

      <n-space :size="8" style="margin-bottom: 12px; flex-wrap: wrap">
        <n-input v-model:value="keyword" placeholder="搜索名称 / voice_id / 模型" clearable style="width: 240px" size="small" />
        <n-select v-model:value="kindFilter" :options="kindOptions" size="small" style="width: 120px" />
        <n-select v-model:value="statusFilter" :options="statusOptions" size="small" style="width: 120px" />
        <n-text depth="3" style="font-size: 12px">共 {{ filtered.length }} 条</n-text>
      </n-space>

      <n-empty v-if="!loading && !items.length" description="还没有自定义音色">
        <template #extra>
          <n-space :size="8">
            <n-button size="small" @click="router.push('/clone')">去复刻一个</n-button>
            <n-button size="small" @click="router.push('/design')">去设计一个</n-button>
          </n-space>
        </template>
      </n-empty>
      <n-data-table v-else :columns="columns" :data="filtered" :loading="loading" :bordered="false" size="small"
        :row-key="(v: CustomVoice) => v.voiceId" />

      <div v-if="previewUrl" style="margin-top: 14px">
        <n-text depth="3" style="font-size: 12px">试听</n-text>
        <audio :src="previewUrl" controls style="width: 100%; max-width: 520px; display: block; margin-top: 4px" />
      </div>
    </n-card>

    <!-- 别名 -->
    <n-modal v-model:show="aliasModal" preset="dialog" title="设置别名（仅本地显示）"
      positive-text="保存" negative-text="取消" @positive-click="saveAlias">
      <n-input v-model:value="aliasValue" placeholder="例如：品牌男声 / 探店女主播" :maxlength="30" style="margin-top: 8px" />
    </n-modal>

    <!-- 换样本 -->
    <n-modal v-model:show="updateModal" preset="dialog" title="重新上传复刻样本"
      :positive-text="updating ? '提交中…' : '提交'" negative-text="取消"
      :positive-button-props="{ loading: updating, disabled: !pendingAudio || updateBusy }"
      @positive-click="doUpdate">
      <n-space vertical :size="10" style="margin-top: 8px">
        <n-text depth="3" style="font-size: 12px">
          将替换 {{ updateTarget?.alias || updateTarget?.voiceId }} 的参考音频，提交后重新进入审核。
        </n-text>
        <n-spin v-if="updateBusy" :size="14" />
        <n-text v-if="updateFileName" style="font-size: 12px">已选择：{{ updateFileName }}</n-text>
        <input type="file" accept="audio/*" @change="onUpdateFile" />
      </n-space>
    </n-modal>
  </div>
</template>
