<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  NSteps, NStep, NButton, NInput, NFormItem, NCard, NSpace, NAlert, NTag, NCollapse,
  NCollapseItem, NSelect, NRadioGroup, NRadioButton, NSpin, NText, useMessage,
} from 'naive-ui';
import { useSettingsStore } from '../stores/settings';
import { useThemeStore, type ThemeMode } from '../stores/theme';

const router = useRouter();
const message = useMessage();
const settingsStore = useSettingsStore();
const themeStore = useThemeStore();

const current = ref(1);

// ---- Step 2 输入 ----
const dashscopeKey = ref('');
const domainMode = ref('public');
const workspaceId = ref('');
const region = ref('cn-beijing');

const regionOptions = [
  { label: '华北2·北京（国内）', value: 'cn-beijing' },
  { label: '新加坡（国际）', value: 'ap-southeast-1' },
];

function goTest() {
  if (!dashscopeKey.value.trim()) {
    message.error('请先填写 DashScope API Key');
    return;
  }
  current.value = 3;
  runTests();
}

// ---- Step 3 连通测试 ----
const dsTest = ref<{ status: 'idle' | 'running' | 'ok' | 'fail'; message: string }>({ status: 'idle', message: '' });

async function runTests() {
  // 先保存密钥，测试由服务端发起（密钥不经过浏览器日志）
  try {
    await settingsStore.save({
      dashscope: { apiKey: dashscopeKey.value.trim(), region: region.value, domainMode: domainMode.value, workspaceId: workspaceId.value },
    });
  } catch (e) {
    message.error(`保存失败：${(e as Error).message}`);
    current.value = 2;
    return;
  }

  dsTest.value = { status: 'running', message: '测试中…' };
  const r1 = await settingsStore.test();
  dsTest.value = { status: r1.ok ? 'ok' : 'fail', message: r1.message };
}

function retryTests() {
  runTests();
}

// ---- Step 4 偏好 ----
const themeMode = ref<ThemeMode>('auto');
const defaultFormat = ref('mp3');
const formatOptions = [
  { label: 'MP3（体积小，通用）', value: 'mp3' },
  { label: 'WAV（无损，剪辑友好）', value: 'wav' },
];

async function finish() {
  themeStore.setMode(themeMode.value, false);
  try {
    await settingsStore.save({ preferences: { theme: themeMode.value, defaultFormat: defaultFormat.value } });
    await settingsStore.refresh();
    message.success('配置完成，开始使用！');
    router.replace('/');
  } catch (e) {
    message.error(`保存偏好失败：${(e as Error).message}`);
  }
}
</script>

<template>
  <div class="setup">
    <div class="setup-inner">
      <div class="setup-hero">
        <div class="logo">🔊</div>
        <h1>AliTTS 语音工作台</h1>
        <n-text depth="3">百炼 DashScope · 本机/内网部署</n-text>
      </div>

      <n-steps :current="current" size="small" style="margin: 20px 0 28px">
        <n-step title="欢迎" />
        <n-step title="API 密钥" />
        <n-step title="连通测试" />
        <n-step title="偏好设置" />
      </n-steps>

      <!-- Step 1 欢迎 -->
      <n-card v-if="current === 1">
        <p style="margin-top: 0">首次使用需要配置 API 密钥。密钥只保存在本机服务端（<n-text code>data/settings.json</n-text>），不会发送到任何第三方。</p>
        <ul style="line-height: 2">
          <li>🎧 <b>语音合成</b>：快捷模板 + 高级全参数（语速/音调/情感指令/SSML）</li>
          <li>🎙️ <b>声音复刻</b>：10–20 秒样本复刻专属音色（M3 交付）</li>
          <li>🎨 <b>声音设计</b>：文字描述生成全新音色（M3 交付）</li>
          <li>🔒 <b>内网共享</b>：可开局域网访问 + 访问令牌保护</li>
        </ul>
        <template #footer>
          <n-space justify="end">
            <n-button type="primary" @click="current = 2">开始配置</n-button>
          </n-space>
        </template>
      </n-card>

      <!-- Step 2 密钥 -->
      <n-card v-else-if="current === 2" title="API 密钥">
        <n-form-item label="阿里百炼 DashScope API Key（必填）" required>
          <n-input
            v-model:value="dashscopeKey"
            type="password"
            show-password-on="click"
            placeholder="sk-xxxxxxxxxxxxxxxx"
            autocomplete="off"
          />
        </n-form-item>
        <n-text depth="3" style="font-size: 12px; display: block; margin-bottom: 16px">
          获取方式：百炼控制台 → API-KEY 管理（DashScope）。语音合成服务需先在百炼开通。
        </n-text>

        <n-collapse>
          <n-collapse-item title="高级：地域与业务空间域名（一般无需修改）" name="adv">
            <n-form-item label="地域">
              <n-select v-model:value="region" :options="regionOptions" style="max-width: 320px" />
            </n-form-item>
            <n-form-item label="域名模式">
              <n-radio-group v-model:value="domainMode">
                <n-radio-button value="public">公共域名（默认）</n-radio-button>
                <n-radio-button value="workspace">业务空间专属域名</n-radio-button>
              </n-radio-group>
            </n-form-item>
            <n-form-item v-if="domainMode === 'workspace'" label="业务空间 Workspace ID">
              <n-input v-model:value="workspaceId" placeholder="例如 llm-xxxxxxxxxxxx" style="max-width: 320px" />
            </n-form-item>
          </n-collapse-item>
        </n-collapse>

        <template #footer>
          <n-space justify="space-between">
            <n-button quaternary @click="current = 1">上一步</n-button>
            <n-button type="primary" @click="goTest">保存并测试</n-button>
          </n-space>
        </template>
      </n-card>

      <!-- Step 3 测试 -->
      <n-card v-else-if="current === 3" title="连通性测试">
        <n-space vertical :size="16">
          <div class="test-row">
            <span style="width: 150px">DashScope（主通道）</span>
            <n-spin v-if="dsTest.status === 'running'" :size="16" />
            <n-tag v-else-if="dsTest.status === 'ok'" type="success">✓ {{ dsTest.message }}</n-tag>
            <n-tag v-else-if="dsTest.status === 'fail'" type="error">✗ {{ dsTest.message }}</n-tag>
            <n-tag v-else type="default">未测试</n-tag>
          </div>
          <n-alert v-if="dsTest.status === 'fail'" type="warning" :show-icon="true">
            连通测试未通过：{{ dsTest.message }}。可返回检查 Key，或先继续使用（部分功能可能不可用）。
          </n-alert>
        </n-space>
        <template #footer>
          <n-space justify="space-between">
            <n-button quaternary @click="current = 2">上一步修改</n-button>
            <div class="wiz-btns">
              <n-button v-if="dsTest.status === 'fail'" @click="retryTests">重新测试</n-button>
              <n-button type="primary" :disabled="dsTest.status === 'running'" @click="current = 4">
                {{ dsTest.status === 'ok' ? '下一步' : '仍然继续' }}
              </n-button>
            </div>
          </n-space>
        </template>
      </n-card>

      <!-- Step 4 偏好 -->
      <n-card v-else-if="current === 4" title="偏好设置">
        <n-form-item label="界面主题">
          <n-radio-group v-model:value="themeMode">
            <n-radio-button value="light">浅色</n-radio-button>
            <n-radio-button value="dark">深色</n-radio-button>
            <n-radio-button value="auto">跟随系统</n-radio-button>
          </n-radio-group>
        </n-form-item>
        <n-form-item label="默认音频格式">
          <n-select v-model:value="defaultFormat" :options="formatOptions" style="max-width: 320px" />
        </n-form-item>
        <n-text depth="3" style="font-size: 12px">这些偏好随时可以在「设置」页修改。</n-text>
        <template #footer>
          <n-space justify="space-between">
            <n-button quaternary @click="current = 3">上一步</n-button>
            <n-button type="primary" @click="finish">完成，进入工作台</n-button>
          </n-space>
        </template>
      </n-card>
    </div>
  </div>
</template>

<style scoped>
.setup { min-height: 100vh; display: flex; align-items: flex-start; justify-content: center; padding: 48px 16px; box-sizing: border-box; }
.setup-inner { width: 100%; max-width: 640px; }
.setup-hero { text-align: center; margin-bottom: 8px; }
.setup-hero .logo { font-size: 40px; }
.setup-hero h1 { margin: 8px 0 4px; font-size: 22px; }
.test-row { display: flex; align-items: center; gap: 12px; }
.wiz-btns { display: flex; align-items: center; gap: 12px; }
</style>
