import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { darkTheme } from 'naive-ui';
import type { GlobalTheme } from 'naive-ui';

export type ThemeMode = 'light' | 'dark' | 'auto';

const STORAGE_KEY = 'alitts.theme';

export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>((localStorage.getItem(STORAGE_KEY) as ThemeMode) || 'auto');
  const systemDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches);

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    systemDark.value = e.matches;
  });

  const isDark = computed(() => (mode.value === 'auto' ? systemDark.value : mode.value === 'dark'));
  const naiveTheme = computed<GlobalTheme | null>(() => (isDark.value ? darkTheme : null));

  function setMode(m: ThemeMode, syncServer = true) {
    mode.value = m;
    localStorage.setItem(STORAGE_KEY, m);
    if (syncServer) {
      // 持久化到服务端偏好（失败静默，本地已生效）
      fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { theme: m } }),
      }).catch(() => {});
    }
  }

  // 服务端偏好只在本会话首次应用，避免覆盖用户本地选择
  function applyServerPref(m: unknown) {
    if (m === 'light' || m === 'dark' || m === 'auto') {
      if (!localStorage.getItem(STORAGE_KEY)) setMode(m, false);
    }
  }

  // mode 变化时同步 html class，便于全局样式感知
  watch(isDark, (v) => {
    document.documentElement.classList.toggle('dark', v);
  }, { immediate: true });

  return { mode, isDark, naiveTheme, setMode, applyServerPref };
});
