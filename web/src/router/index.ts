import { createRouter, createWebHistory } from 'vue-router';
import { useSettingsStore } from '../stores/settings';
import { useThemeStore } from '../stores/theme';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/setup', name: 'setup', component: () => import('../views/SetupWizard.vue') },
    { path: '/', name: 'synthesis', component: () => import('../views/SynthesisView.vue') },
    { path: '/advanced', name: 'advanced', component: () => import('../views/AdvancedView.vue') },
    { path: '/clone', name: 'clone', component: () => import('../views/CloneView.vue') },
    { path: '/design', name: 'design', component: () => import('../views/DesignView.vue') },
    { path: '/library', name: 'library', component: () => import('../views/LibraryView.vue') },
    { path: '/history', name: 'history', component: () => import('../views/HistoryView.vue') },
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach(async (to) => {
  const settings = useSettingsStore();
  if (!settings.loaded) {
    await settings.refresh();
    useThemeStore().applyServerPref(settings.view.preferences.theme);
  }
  if (!settings.view.configured && to.name !== 'setup') return { name: 'setup' };
  if (settings.view.configured && to.name === 'setup') return { name: 'synthesis' };
  return true;
});

export { router };
