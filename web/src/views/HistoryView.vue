<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  NCard, NDataTable, NButton, NSpace, NText, NDrawer, NDrawerContent, NTag, NEmpty, useDialog, useMessage,
  type DataTableColumns,
} from 'naive-ui';
import { apiGet, apiSend, audioUrl } from '../api/client';
import { formatBytes } from '../audio/assemble';
import { useUiState } from '../stores/uiState';

interface Word { text: string; begin_time?: number; end_time?: number }
interface HistoryItem {
  id: string; ts: string; provider: string; model: string; voice: string; templateId?: string;
  text: string; params: Record<string, unknown>; file: string; bytes: number; chars: number;
  elapsedMs: number; requestId: string;
  wordTimeline?: Array<{ key: string; words: Word[] }>;
}

const router = useRouter();
const dialog = useDialog();
const message = useMessage();
const uiState = useUiState();

const items = ref<HistoryItem[]>([]);
const total = ref(0);
const loading = ref(false);
const opened = ref<HistoryItem | null>(null);

async function refresh() {
  loading.value = true;
  try {
    const r = await apiGet<{ items: HistoryItem[]; total: number }>('/api/tts/history?limit=200');
    items.value = r.items;
    total.value = r.total;
  } catch (e) {
    message.error(`加载历史失败：${(e as Error).message}`);
  } finally {
    loading.value = false;
  }
}
onMounted(refresh);

const columns: DataTableColumns<HistoryItem> = [
  {
    title: '时间', key: 'ts', width: 150,
    render: (row) => new Date(row.ts).toLocaleString('zh-CN', { hour12: false }),
  },
  {
    title: '模型 / 音色', key: 'model', width: 240,
    render: (row) => h('div', [
      h('div', { style: 'font-size:12px' }, row.model),
      h('div', { style: 'font-size:11px;opacity:.55;font-family:monospace' }, row.voice),
    ]),
  },
  {
    title: '文本', key: 'text',
    render: (row) => h('span', { title: row.text, style: 'font-size:12px' },
      row.text.length > 36 ? row.text.slice(0, 36) + '…' : row.text),
  },
  { title: '字数', key: 'chars', width: 64 },
  {
    title: '大小', key: 'bytes', width: 90,
    render: (row) => formatBytes(row.bytes),
  },
  {
    title: '耗时', key: 'elapsedMs', width: 84,
    render: (row) => `${(row.elapsedMs / 1000).toFixed(1)}s`,
  },
  {
    title: '操作', key: 'actions', width: 90,
    render: (row) => h(NButton, {
      size: 'tiny', onClick: (e: MouseEvent) => { e.stopPropagation(); opened.value = row; },
    }, { default: () => '详情' }),
  },
];

function rowProps(row: HistoryItem) {
  return { style: 'cursor:pointer', onClick: () => { opened.value = row; } };
}

const openedWords = computed<Word[]>(() => {
  if (!opened.value?.wordTimeline) return [];
  return opened.value.wordTimeline.flatMap((g) => g.words);
});

function loadToAdvanced() {
  if (!opened.value) return;
  const r = opened.value;
  uiState.pendingAdvanced = {
    model: r.model, voice: r.voice, text: r.text, params: r.params || {},
  };
  router.push('/advanced');
}

function download() {
  if (!opened.value) return;
  const a = document.createElement('a');
  a.href = audioUrl(opened.value.file);
  a.download = opened.value.file;
  a.click();
}

function removeOne() {
  if (!opened.value) return;
  dialog.warning({
    title: '删除记录',
    content: '删除后音频文件也会一并移除，确定？',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await apiSend(`/api/tts/history/${opened.value!.id}`, 'DELETE');
      opened.value = null;
      message.success('已删除');
      refresh();
    },
  });
}

function clearAll() {
  dialog.error({
    title: '清空全部历史',
    content: `将删除全部 ${total.value} 条记录及音频文件，不可恢复。`,
    positiveText: '全部清空',
    negativeText: '取消',
    onPositiveClick: async () => {
      await apiSend('/api/tts/history', 'DELETE');
      message.success('已清空');
      refresh();
    },
  });
}
</script>

<template>
  <div class="history">
    <n-card size="small">
      <template #header>
        <n-space align="center" :size="10">
          <span>历史记录</span>
          <n-tag size="small" :bordered="false">{{ total }} 条</n-tag>
        </n-space>
      </template>
      <template #header-extra>
        <n-space :size="8">
          <n-button size="small" :loading="loading" @click="refresh">刷新</n-button>
          <n-button size="small" type="error" quaternary :disabled="!total" @click="clearAll">清空全部</n-button>
        </n-space>
      </template>

      <n-empty v-if="!loading && !items.length" description="还没有生成记录，去合成一段语音吧" />
      <n-data-table
        v-else
        :columns="columns"
        :data="items"
        :loading="loading"
        :row-props="rowProps"
        :bordered="false"
        size="small"
      />
    </n-card>

    <n-drawer :show="!!opened" :width="620" placement="right" @update:show="(v) => { if (!v) opened = null }">
      <n-drawer-content v-if="opened" title="记录详情" closable>
        <n-space vertical :size="12">
          <n-space :size="6" style="flex-wrap: wrap">
            <n-tag size="small" :bordered="false" type="info">{{ opened.model }}</n-tag>
            <n-tag size="small" :bordered="false">{{ opened.voice }}</n-tag>
            <n-tag size="small" :bordered="false">{{ new Date(opened.ts).toLocaleString('zh-CN', { hour12: false }) }}</n-tag>
          </n-space>

          <audio :src="audioUrl(opened.file)" controls style="width: 100%" />

          <div>
            <n-text depth="3" style="font-size: 12px">文本（{{ opened.chars }} 字）</n-text>
            <div class="detail-text">{{ opened.text }}</div>
          </div>

          <div v-if="openedWords.length">
            <n-text depth="3" style="font-size: 12px">词级时间戳（{{ openedWords.length }} 个）</n-text>
            <div class="words">
              <span v-for="(w, i) in openedWords" :key="i" class="word" :title="`${w.begin_time ?? '-'} → ${w.end_time ?? '-'} ms`">
                {{ w.text }}<em>{{ w.begin_time ?? '' }}</em>
              </span>
            </div>
          </div>

          <div>
            <n-text depth="3" style="font-size: 12px">参数快照</n-text>
            <pre class="params-pre">{{ JSON.stringify(opened.params, null, 2) }}</pre>
          </div>

          <n-text v-if="opened.requestId" depth="3" style="font-size: 11px">requestId: {{ opened.requestId }}</n-text>

          <n-space :size="8">
            <n-button type="primary" size="small" @click="loadToAdvanced">载入参数到高级模式</n-button>
            <n-button size="small" @click="download">下载</n-button>
            <n-button size="small" type="error" quaternary @click="removeOne">删除</n-button>
          </n-space>
        </n-space>
      </n-drawer-content>
    </n-drawer>
  </div>
</template>

<style scoped>
.detail-text {
  margin-top: 6px; padding: 10px; border-radius: 6px; background: rgba(128,128,128,.08);
  font-size: 13px; line-height: 1.7; white-space: pre-wrap; max-height: 180px; overflow: auto;
}
.words { margin-top: 6px; max-height: 140px; overflow: auto; line-height: 2; font-size: 12px; }
.word { display: inline-block; margin-right: 6px; padding: 0 4px; border-radius: 4px; background: rgba(128,128,128,.1); }
.word em { font-style: normal; opacity: .45; font-size: 10px; margin-left: 2px; }
.params-pre {
  margin: 6px 0 0; padding: 10px; border-radius: 6px; background: rgba(128,128,128,.08);
  font-size: 11px; line-height: 1.5; overflow: auto; max-height: 220px;
}
</style>
