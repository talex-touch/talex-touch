<script setup lang="ts" name="SettingBetaFeatures">
import { useI18n } from 'vue-i18n'
import TuffBetaTag from '~/components/tuff/tags/TuffBetaTag.vue'
import TuffBlockSwitch from '~/components/tuff/TuffBlockSwitch.vue'
import TuffGroupBlock from '~/components/tuff/TuffGroupBlock.vue'
import { appSetting } from '~/modules/storage/app-storage'
import { isBetaFeatureEnabled } from '../../../../../shared/beta-features'

const { t } = useI18n()

function updateBrowserWorkspace(enabled: boolean): void {
  appSetting.betaFeatures ??= {
    screenshot: false,
    voiceDictation: false,
    voiceQuickEdit: false,
    omniPanel: false,
    browserWorkspace: false
  }
  appSetting.betaFeatures.browserWorkspace = enabled
}
</script>

<template>
  <TuffGroupBlock
    :name="t('settings.betaFeatures.title')"
    :description="t('settings.betaFeatures.desc')"
    :collapsible="false"
  >
    <TuffBlockSwitch
      data-testid="beta-feature-browser-workspace"
      :model-value="isBetaFeatureEnabled(appSetting, 'browserWorkspace')"
      :title="t('settings.betaFeatures.browserWorkspace.title')"
      :description="t('settings.betaFeatures.browserWorkspace.desc')"
      @update:model-value="updateBrowserWorkspace"
    >
      <template #tags>
        <TuffBetaTag />
      </template>
    </TuffBlockSwitch>
  </TuffGroupBlock>
</template>
