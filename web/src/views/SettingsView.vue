<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import {
  NCard, NForm, NFormItem, NInput, NButton, NSpace, NTag, NSpin, NSelect, NRadioGroup,
  NRadioButton, NSwitch, NInputNumber, NText, NAlert, useMessage,
} from 'naive-ui';
import { useSettingsStore } from '../stores/settings';
import { useThemeStore, type ThemeMode } from '../stores/theme';

const message = useMessage();
const settingsStore = useSettingsStore();
const themeStore = useThemeStore();

const form = reactive({
  dashscopeKey: '',
  region: settingsStore.view.dashscope.region,
  domainMode: settingsStore.view.dashscope.domainMode,
  workspaceId: settingsStore.view.dashscope.workspaceId,
  theme: (settingsStore.view.preferences.theme as ThemeMode) || 'auto',
  defaultFormat: settingsStore.view.preferences.defaultFormat,
  chunkLimit: settingsStore.view.preferences.chunkLimit,
  lan: settingsStore.view.server.lan,
  port: settingsStore.view.server.port,
  accessToken: '',
});
const clearToken = ref(false);

const regionOptions = [
  { label: '华北2·北京（国内）', value: 'cn-beijing' },
  { label: '新加坡（国际）', value: 'ap-southeast-1' },
];
const formatOptions = [
  { label: 'MP3（体积小）', value: 'mp3' },
  { label: 'WAV（无损）', value: 'wav' },
];

const testing = ref(false);
const testResult = ref<null | { ok: boolean; message: string }>(null);

async function runTest() {
  // 若页面上新填了 Key，先保存再测
  if (form.dashscopeKey.trim()) await save({ quiet: true });
  testing.value = true;
  testResult.value = null;
  try {
    testResult.value = await settingsStore.test();
  } catch (e) {
    testResult.value = { ok: false, message: (e as Error).message };
  } finally {
    testing.value = false;
  }
}

const lanUrls = computed(() => settingsStore.view.server.lanUrls || []);
const pendingRestart = computed(() => Boolean(settingsStore.view.server.pendingRestart));
const tokenSet = computed(() => Boolean(settingsStore.view.server.accessTokenSet));

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    message.success('已复制');
  } catch {
    message.error('复制失败，请手动选择复制');
  }
}

async function save(opts?: { quiet?: boolean }) {
  const patch: Record<string, unknown> = {
    dashscope: {
      region: form.region,
      domainMode: form.domainMode,
      workspaceId: form.workspaceId,
    },
    preferences: {
      theme: form.theme,
      defaultFormat: form.defaultFormat,
      chunkLimit: form.chunkLimit,
    },
    server: { lan: form.lan, port: form.port },
  };
  if (form.dashscopeKey.trim()) (patch.dashscope as Record<string, unknown>).apiKey = form.dashscopeKey.trim();
  // 令牌：输入了新值→设置；点过"清除"→传空串清除；否则不动
  if (form.accessToken.trim()) (patch.server as Record<string, unknown>).accessToken = form.accessToken.trim();
  else if (clearToken.value) (patch.server as Record<string, unknown>).accessToken = '';

  try {
    const v = await settingsStore.save(patch);
    themeStore.setMode(form.theme, false);
    form.dashscopeKey = '';
    form.accessToken = '';
    clearToken.value = false;
    form.port = v.server.port;
    if (!opts?.quiet) {
      message.success('已保存');
      if (v.server.pendingRestart) message.warning('监听地址/端口已变化，重启服务（npm start）后生效');
    }
  } catch (e) {
    message.error(`保存失败：${(e as Error).message}`);
    throw e;
  }
}
</script>

<template>
  <div class="settings">
    <n-card title="API 密钥" size="small">
      <n-form label-placement="top">
        <n-form-item label="DashScope API Key（阿里百炼）">
          <n-space vertical style="width: 100%" :size="6">
            <n-space style="width: 100%" :size="8">
              <n-input
                v-model:value="form.dashscopeKey"
                type="password"
                show-password-on="click"
                :placeholder="settingsStore.view.dashscope.hasKey
                  ? `已配置（${settingsStore.view.dashscope.maskedKey}），留空表示不修改`
                  : 'sk-xxxxxxxxxxxxxxxx'"
                style="max-width: 420px"
                autocomplete="off"
              />
              <n-button :loading="testing" @click="runTest()">测试连接</n-button>
            </n-space>
            <n-spin v-if="testing" :size="14" />
            <n-tag v-else-if="testResult" :type="testResult.ok ? 'success' : 'error'">
              {{ testResult.ok ? '✓' : '✗' }} {{ testResult.message }}
            </n-tag>
          </n-space>
        </n-form-item>
      </n-form>
    </n-card>

    <n-card title="DashScope 接入" size="small" style="margin-top: 14px">
      <n-form label-placement="top">
        <n-form-item label="地域">
          <n-select v-model:value="form.region" :options="regionOptions" style="max-width: 320px" />
        </n-form-item>
        <n-form-item label="域名模式">
          <n-space vertical :size="6">
            <n-radio-group v-model:value="form.domainMode">
              <n-radio-button value="public">公共域名（默认）</n-radio-button>
              <n-radio-button value="workspace">业务空间专属域名</n-radio-button>
            </n-radio-group>
            <n-input
              v-if="form.domainMode === 'workspace'"
              v-model:value="form.workspaceId"
              placeholder="业务空间 Workspace ID，例如 llm-xxxxxxxxxxxx"
              style="max-width: 320px"
            />
          </n-space>
        </n-form-item>
      </n-form>
    </n-card>

    <n-card title="偏好" size="small" style="margin-top: 14px">
      <n-form label-placement="top">
        <n-form-item label="界面主题">
          <n-radio-group v-model:value="form.theme">
            <n-radio-button value="light">浅色</n-radio-button>
            <n-radio-button value="dark">深色</n-radio-button>
            <n-radio-button value="auto">跟随系统</n-radio-button>
          </n-radio-group>
        </n-form-item>
        <n-form-item label="默认音频格式">
          <n-select v-model:value="form.defaultFormat" :options="formatOptions" style="max-width: 320px" />
        </n-form-item>
        <n-form-item label="长文本分段长度（字符，超过自动分段拼接）">
          <n-input-number v-model:value="form.chunkLimit" :min="200" :max="2000" :step="100" style="max-width: 200px" />
        </n-form-item>
      </n-form>
    </n-card>

    <n-card title="服务（仅本机/内网部署）" size="small" style="margin-top: 14px">
      <n-alert v-if="pendingRestart" type="warning" :bordered="false" style="margin-bottom: 12px">
        监听设置已修改但服务未重启，当前实际监听 {{ settingsStore.view.server.effectiveHost }}:{{ settingsStore.view.server.effectivePort }}。重启服务（npm start）后生效。
      </n-alert>
      <n-form label-placement="top">
        <n-form-item label="允许局域网设备访问">
          <div class="col">
            <div class="row">
              <n-switch v-model:value="form.lan" />
              <n-text depth="3" style="font-size: 12px">
                开启后监听 0.0.0.0:{{ form.port }}；默认仅本机 127.0.0.1。修改后需重启生效
              </n-text>
            </div>
            <n-text depth="3" style="font-size: 12px">首次开启时 Windows 防火墙可能弹窗询问，请选择"允许访问"</n-text>
            <template v-if="form.lan && lanUrls.length">
              <n-text depth="3" style="font-size: 12px">局域网设备可通过以下地址访问：</n-text>
              <div class="row" style="flex-wrap: wrap">
                <n-tag v-for="u in lanUrls" :key="u" size="small" style="cursor: pointer" @click="copyText(u)">
                  {{ u }}
                </n-tag>
              </div>
            </template>
            <n-text v-else-if="!form.lan" depth="3" style="font-size: 12px">
              当前仅本机可访问：http://127.0.0.1:{{ form.port }}
            </n-text>
          </div>
        </n-form-item>

        <n-form-item label="端口">
          <div class="col">
            <n-input-number v-model:value="form.port" :min="1024" :max="65535" style="max-width: 200px" />
            <n-text depth="3" style="font-size: 12px">修改后需重启生效；被占用时服务会启动失败，请换一个</n-text>
          </div>
        </n-form-item>

        <n-form-item label="访问令牌（局域网共享时建议设置）">
          <div class="col">
            <div class="row">
              <n-input
                v-model:value="form.accessToken"
                type="password"
                show-password-on="click"
                :placeholder="tokenSet ? '已设置，留空表示不修改' : '未设置（任何能访问到本服务的设备都可使用）'"
                style="max-width: 320px"
                autocomplete="off"
              />
              <n-button v-if="tokenSet && !clearToken" size="small" quaternary type="error" @click="clearToken = true">清除令牌</n-button>
              <n-tag v-if="clearToken" type="warning" size="small">保存后将清除令牌</n-tag>
            </div>
            <n-text depth="3" style="font-size: 12px">
              设置后所有 API 请求都需要令牌：浏览器访问会弹窗输入一次并记住；音频直链以 ?token= 参数携带
            </n-text>
          </div>
        </n-form-item>
      </n-form>
    </n-card>

    <n-space justify="end" style="margin-top: 16px">
      <n-button type="primary" @click="save()">保存设置</n-button>
    </n-space>
  </div>
</template>

<style scoped>
.row { display: flex; align-items: center; gap: 10px; }
.col { display: flex; flex-direction: column; gap: 6px; }
</style>
