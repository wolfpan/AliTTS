import { defineStore } from 'pinia';
import { ref } from 'vue';

// 跨视图交接数据（如历史记录"载入参数"到高级模式）
export interface LoadToAdvanced {
  model: string;
  voice: string;
  text: string;
  params: Record<string, unknown>;
}

export const useUiState = defineStore('uiState', () => {
  const pendingAdvanced = ref<LoadToAdvanced | null>(null);

  function takePendingAdvanced(): LoadToAdvanced | null {
    const v = pendingAdvanced.value;
    pendingAdvanced.value = null;
    return v;
  }

  return { pendingAdvanced, takePendingAdvanced };
});
