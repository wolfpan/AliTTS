import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { QuickTemplate } from '../data/templates';

const KEY = 'alitts.customTemplates';

interface StoredTemplate extends QuickTemplate {
  custom: true;
}

function read(): StoredTemplate[] {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export const useCustomTemplates = defineStore('customTemplates', () => {
  const items = ref<StoredTemplate[]>(read());
  const list = computed(() => items.value);

  function persist() {
    localStorage.setItem(KEY, JSON.stringify(items.value));
  }

  function add(tpl: QuickTemplate) {
    const item = { ...tpl, id: `custom-${Date.now()}`, custom: true } as StoredTemplate;
    items.value = [...items.value, item];
    persist();
    return item;
  }

  function remove(id: string) {
    items.value = items.value.filter((t) => t.id !== id);
    persist();
  }

  return { items, list, add, remove };
});
