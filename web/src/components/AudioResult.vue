<script setup lang="ts">
import { computed } from 'vue';
import { NSpace, NButton, NText } from 'naive-ui';
import { downloadBlob, formatBytes } from '../audio/assemble';

const props = defineProps<{
  blob: Blob;
  filename: string;
  bytes: number;
  elapsedMs: number;
  model: string;
  voice: string;
  requestId?: string;
}>();

const objectUrl = computed(() => URL.createObjectURL(props.blob));

function onDownload() {
  downloadBlob(props.blob, props.filename);
}
</script>

<template>
  <div class="audio-result">
    <div class="player-row">
      <audio :src="objectUrl" controls class="player" />
      <n-button size="small" @click="onDownload">下载</n-button>
    </div>
    <n-space :size="12" align="center" style="margin-top: 6px">
      <n-text depth="3" style="font-size: 12px">
        {{ model }} · {{ voice }} · {{ formatBytes(bytes) }} · {{ (elapsedMs / 1000).toFixed(1) }}s
      </n-text>
      <n-text v-if="requestId" depth="3" style="font-size: 11px">req: {{ requestId.slice(0, 14) }}…</n-text>
    </n-space>
  </div>
</template>

<style scoped>
.audio-result { padding: 12px; border: 1px solid rgba(128,128,128,.18); border-radius: 8px; }
.player-row { display: flex; align-items: center; gap: 12px; }
.player { flex: 1; height: 36px; }
</style>
