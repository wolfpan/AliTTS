<script setup lang="ts">
import { computed } from 'vue';
import {
  NCard, NForm, NFormItem, NSlider, NSelect, NInputNumber, NButton, NSpace, NSwitch,
  NCollapse, NCollapseItem, NText, NTag, NTooltip,
} from 'naive-ui';
import { SAMPLE_RATES, OPUS_SAMPLE_RATES, LANGUAGE_HINTS, LANGUAGE_TYPE_OPTIONS, type ModelMeta } from '../data/models';

export interface AdvParams {
  rate: number;
  pitch: number;
  volume: number;
  format: 'mp3' | 'wav' | 'pcm' | 'opus';
  sampleRate: number;
  bitRate: number;
  seed: number;
  languageHint: string;
  languageType: string;
  wordTimestamp: boolean;
  segmentSilenceMs: number;
  hp: Array<{ word: string; pinyin: string }>;
  hr: Array<{ from: string; to: string }>;
}

const props = defineProps<{ model: ModelMeta; params: AdvParams }>();
const p = computed(() => props.params);
const m = computed(() => props.model);

const formatOptions = [
  { label: 'MP3（通用）', value: 'mp3' },
  { label: 'WAV（无损）', value: 'wav' },
  { label: 'PCM（裸流）', value: 'pcm' },
  { label: 'Opus（小体积）', value: 'opus' },
];

const sampleRateOptions = computed(() => {
  const list = p.value.format === 'opus' ? OPUS_SAMPLE_RATES : SAMPLE_RATES;
  return list.map((r) => ({ label: `${r} Hz`, value: r }));
});

const langOptions = [
  { label: '自动 / 不指定', value: '' },
  ...LANGUAGE_HINTS.map((l) => ({ label: l, value: l })),
];

const silenceOptions = [
  { label: '0（无间隔）', value: 0 },
  { label: '100ms', value: 100 },
  { label: '200ms', value: 200 },
  { label: '500ms', value: 500 },
];

function randomSeed() {
  p.value.seed = Math.floor(Math.random() * 65536);
}

function addHp() {
  if (p.value.hp.length < 8) p.value.hp.push({ word: '', pinyin: '' });
}
function addHr() {
  if (p.value.hr.length < 8) p.value.hr.push({ from: '', to: '' });
}
</script>

<template>
  <n-card title="参数" size="small">
    <n-form label-placement="top" size="small">
      <template v-if="m.supportsProsody">
        <n-form-item :label="`语速 ${p.rate.toFixed(2)}`">
          <n-slider v-model:value="p.rate" :min="0.5" :max="2" :step="0.05" />
        </n-form-item>
        <n-form-item :label="`音调 ${p.pitch.toFixed(2)}`">
          <n-slider v-model:value="p.pitch" :min="0.5" :max="2" :step="0.05" />
        </n-form-item>
        <n-form-item :label="`音量 ${p.volume}`">
          <n-slider v-model:value="p.volume" :min="0" :max="100" :step="1" />
        </n-form-item>
      </template>
      <n-text v-else depth="3" style="font-size: 12px; display: block; margin-bottom: 12px">
        该模型不支持语速/音调/音量参数
      </n-text>

      <template v-if="m.outputFixed">
        <n-form-item label="输出格式">
          <n-tag size="small">WAV · {{ m.outputFixed.sampleRate }} Hz（固定）</n-tag>
        </n-form-item>
      </template>
      <template v-else>
        <n-form-item label="输出格式">
          <n-select v-model:value="p.format" :options="formatOptions" />
        </n-form-item>
        <n-form-item label="采样率">
          <n-select v-model:value="p.sampleRate" :options="sampleRateOptions" />
        </n-form-item>
        <n-form-item v-if="p.format === 'opus'" :label="`码率 ${p.bitRate} kbps`">
          <n-input-number v-model:value="p.bitRate" :min="6" :max="510" :step="8" style="width: 100%" />
        </n-form-item>
        <n-form-item v-if="p.format === 'wav' || p.format === 'pcm'">
          <n-space align="center" :size="8">
            <n-text style="font-size: 12px">段间静音</n-text>
            <n-select v-model:value="p.segmentSilenceMs" :options="silenceOptions" size="small" style="width: 130px" />
            <n-text depth="3" style="font-size: 11px">仅长文本自动分段时生效</n-text>
          </n-space>
        </n-form-item>
      </template>

      <n-form-item v-if="m.supportsSeed" label="随机种子（相同种子可复现）">
        <n-space :size="6" style="width: 100%">
          <n-input-number v-model:value="p.seed" :min="0" :max="65535" style="flex: 1" />
          <n-button size="small" @click="randomSeed">🎲 随机</n-button>
        </n-space>
      </n-form-item>

      <n-form-item v-if="m.supportsLanguageHints" label="语言倾向 language_hints">
        <n-select v-model:value="p.languageHint" :options="langOptions" />
      </n-form-item>

      <n-form-item v-if="m.supportsLanguageType" label="语言 language_type">
        <n-select v-model:value="p.languageType" :options="LANGUAGE_TYPE_OPTIONS" />
      </n-form-item>

      <n-form-item v-if="m.supportsTimestamps">
        <n-space align="center" :size="8">
          <n-switch v-model:value="p.wordTimestamp" size="small" />
          <n-tooltip>
            <template #trigger>
              <n-text style="font-size: 12px; border-bottom: 1px dashed">词级时间戳</n-text>
            </template>
            合成后返回每个词的起止时间，存入历史记录（部分音色不支持）
          </n-tooltip>
        </n-space>
      </n-form-item>

      <n-collapse v-if="m.supportsHotfix" style="margin-top: 4px">
        <n-collapse-item title="纠音 hot_fix（拼音标注 / 文本替换）" name="hotfix">
          <div class="hf-block">
            <div class="hf-title">拼音标注 pronunciation
              <n-button text size="tiny" type="primary" @click="addHp">+ 添加</n-button>
            </div>
            <div v-for="(row, i) in p.hp" :key="'p' + i" class="hf-row">
              <n-input v-model:value="row.word" size="small" placeholder="词语，如 天气" />
              <n-input v-model:value="row.pinyin" size="small" placeholder="拼音，如 tian1 qi4" />
              <n-button text size="tiny" type="error" @click="p.hp.splice(i, 1)">删</n-button>
            </div>
            <div class="hf-title" style="margin-top: 10px">文本替换 replace
              <n-button text size="tiny" type="primary" @click="addHr">+ 添加</n-button>
            </div>
            <div v-for="(row, i) in p.hr" :key="'r' + i" class="hf-row">
              <n-input v-model:value="row.from" size="small" placeholder="原文，如 今天" />
              <n-input v-model:value="row.to" size="small" placeholder="替换为，如 金天" />
              <n-button text size="tiny" type="error" @click="p.hr.splice(i, 1)">删</n-button>
            </div>
          </div>
        </n-collapse-item>
      </n-collapse>
    </n-form>
  </n-card>
</template>

<style scoped>
.hf-block { font-size: 12px; }
.hf-title { display: flex; justify-content: space-between; align-items: center; opacity: .8; margin-bottom: 6px; }
.hf-row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
</style>
