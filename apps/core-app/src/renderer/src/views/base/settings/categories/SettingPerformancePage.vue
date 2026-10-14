<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import SettingsPage from '~/components/settings/SettingsPage.vue'
import SettingPerformance from '../performance/SettingPerformance.vue'

defineOptions({ name: 'SettingPerformancePage' })
const { t } = useI18n()
</script>

<template>
  <SettingsPage :title="t('settingsNav.category.performance')">
    <SettingPerformance />
  </SettingsPage>
</template>
