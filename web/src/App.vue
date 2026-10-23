<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  NConfigProvider, NMessageProvider, NDialogProvider, NGlobalStyle, NModal, NInput, zhCN, dateZhCN,
} from 'naive-ui';
import { useThemeStore } from './stores/theme';
import { getToken, setToken } from './api/client';
import AppHeader from './components/AppHeader.vue';

const theme = useThemeStore();
const route = useRoute();
// 向导页不显示顶栏，保持沉浸式引导
const showHeader = computed(() => route.name !== 'setup');

// ---- 访问令牌门：服务端开启令牌后，API 返回 401 或首次进入时弹窗索取 ----
const showTokenModal = ref(false);
const tokenInput = ref('');
function askToken() {
  tokenInput.value = '';
  showTokenModal.value = true;
}
function submitToken() {
  const t = tokenInput.value.trim();
  if (!t) return;
  setToken(t);
  showTokenModal.value = false;
  // 重载以让全部数据按新令牌重新拉取
  window.location.reload();
}
function onTokenRequired() { askToken(); }
onMounted(async () => {
  window.addEventListener('alitts:token-required', onTokenRequired);
  try {
    const r = await fetch('/api/health');
    const j = await r.json();
    if (j?.tokenRequired && !getToken()) askToken();
  } catch { /* 健康检查失败不阻塞界面 */ }
});
onUnmounted(() => window.removeEventListener('alitts:token-required', onTokenRequired));
</script>

<template>
  <n-config-provider :theme="theme.naiveTheme" :locale="zhCN" :date-locale="dateZhCN">
    <n-message-provider>
      <n-dialog-provider>
        <n-global-style />
        <div class="app-shell">
          <AppHeader v-if="showHeader" />
          <main class="app-main">
            <router-view />
          </main>
        </div>
        <n-modal v-model:show="showTokenModal" :mask-closable="false" preset="dialog" title="需要访问令牌"
          positive-text="确定" @positive-click="submitToken">
          <p style="margin: 0 0 8px">此服务已启用访问令牌保护，请输入管理员设置的访问令牌。</p>
          <n-input v-model:value="tokenInput" type="password" show-password-on="click" placeholder="访问令牌" @keyup.enter="submitToken" />
        </n-modal>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style>
html, body, #app { height: 100%; margin: 0; }
body {
  font-family: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
}
.app-shell { min-height: 100%; display: flex; flex-direction: column; }
.app-main { flex: 1; max-width: 1080px; width: 100%; margin: 0 auto; padding: 20px 20px 48px; box-sizing: border-box; }
</style>
