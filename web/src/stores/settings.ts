import { defineStore } from 'pinia';
import { ref } from 'vue';
import { apiGet, apiSend } from '../api/client';

export interface PublicSettings {
  configured: boolean;
  dashscope: {
    hasKey: boolean;
    maskedKey: string;
    region: string;
    domainMode: string;
    workspaceId: string;
  };
  preferences: {
    defaultFormat: string;
    defaultSampleRate: number;
    theme: string;
    chunkLimit: number;
  };
  server: {
    port: number;
    lan: boolean;
    accessTokenSet: boolean;
    effectiveHost?: string | null;
    effectivePort?: number | null;
    pendingRestart?: boolean;
    lanUrls?: string[];
  };
}

export const EMPTY_SETTINGS: PublicSettings = {
  configured: false,
  dashscope: { hasKey: false, maskedKey: '', region: 'cn-beijing', domainMode: 'public', workspaceId: '' },
  preferences: { defaultFormat: 'mp3', defaultSampleRate: 24000, theme: 'auto', chunkLimit: 600 },
  server: { port: 3210, lan: false, accessTokenSet: false, effectiveHost: null, effectivePort: null, pendingRestart: false, lanUrls: [] },
};

export const useSettingsStore = defineStore('settings', () => {
  const view = ref<PublicSettings>({ ...EMPTY_SETTINGS });
  const loaded = ref(false);

  async function refresh() {
    const j = await apiGet<PublicSettings>('/api/settings');
    view.value = { ...EMPTY_SETTINGS, ...j, server: { ...EMPTY_SETTINGS.server, ...(j.server || {}) } };
    loaded.value = true;
  }

  async function save(patch: Record<string, unknown>): Promise<PublicSettings> {
    const j = await apiSend<PublicSettings>('/api/settings', 'PUT', patch);
    view.value = { ...EMPTY_SETTINGS, ...j, server: { ...EMPTY_SETTINGS.server, ...(j.server || {}) } };
    return view.value;
  }

  async function test(): Promise<{ ok: boolean; message: string; requestId?: string }> {
    return apiSend<{ ok: boolean; message: string; requestId?: string }>('/api/settings/test', 'POST', {});
  }

  return { view, loaded, refresh, save, test };
});
