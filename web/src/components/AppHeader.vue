<script setup lang="ts">
import { computed, h } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NDropdown, NMenu, NButton, NSpace, NTag, useThemeVars, type MenuOption } from 'naive-ui';
import { useThemeStore, type ThemeMode } from '../stores/theme';

const route = useRoute();
const router = useRouter();
const theme = useThemeStore();
// 吸顶头部使用主题背景色，避免透明导致滚动内容"穿模"透出
const themeVars = useThemeVars();
const headerStyle = computed(() => ({ backgroundColor: themeVars.value.bodyColor }));

const activeKey = computed(() => (route.name as string) || 'synthesis');

const menuOptions: MenuOption[] = [
  { label: '语音合成', key: 'synthesis' },
  { label: '高级模式', key: 'advanced' },
  { label: '声音复刻', key: 'clone' },
  { label: '声音设计', key: 'design' },
  { label: '声音库', key: 'library' },
  { label: '历史', key: 'history' },
  { label: '设置', key: 'settings' },
];

function onMenu(key: string) {
  const map: Record<string, string> = {
    synthesis: '/',
    advanced: '/advanced',
    clone: '/clone',
    design: '/design',
    library: '/library',
    history: '/history',
    settings: '/settings',
  };
  if (map[key]) router.push(map[key]);
}

const themeOptions = [
  { label: '浅色', key: 'light' },
  { label: '深色', key: 'dark' },
  { label: '跟随系统', key: 'auto' },
];

function renderLabel(label: string, disabled: boolean) {
  return () => h('span', { style: disabled ? 'opacity:.45' : '' }, label);
}
// 给禁用项加"后续版本"提示
const menuWithHints = menuOptions.map((o) => ({
  ...o,
  label: renderLabel(String(o.label ?? ''), Boolean(o.disabled)),
}));

const themeLabel = computed(() =>
  theme.mode === 'auto' ? '主题·跟随系统' : theme.mode === 'dark' ? '主题·深色' : '主题·浅色',
);

function onTheme(key: string | number) {
  theme.setMode(key as ThemeMode);
}
</script>

<template>
  <header class="app-header" :style="headerStyle">
    <div class="brand" @click="router.push('/')">
      <span class="logo">🔊</span>
      <span class="title">AliTTS <span class="sub">语音工作台</span></span>
    </div>
    <n-menu mode="horizontal" :value="activeKey" :options="menuWithHints" @update:value="onMenu" />
    <n-space align="center" :size="8" class="right">
      <n-tag v-if="false" size="small" />
      <n-dropdown trigger="click" :options="themeOptions" @select="onTheme">
        <n-button quaternary size="small">{{ themeLabel }}</n-button>
      </n-dropdown>
    </n-space>
  </header>
</template>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 20px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.22);
  position: sticky;
  top: 0;
  z-index: 10;
}
.brand { display: flex; align-items: center; gap: 8px; cursor: pointer; white-space: nowrap; }
.logo { font-size: 20px; }
.title { font-weight: 700; font-size: 16px; }
.sub { font-weight: 400; font-size: 12px; opacity: .6; }
.right { margin-left: auto; }
</style>
