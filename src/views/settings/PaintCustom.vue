<template>
  <div class="PaintCustom-Container">
    <tv-tabs v-model="activeNodes">
      <tv-tab-item-group :name="$t('settings.appearance.paint-custom.controller')">
        <tv-tab-item icon="finder" name="MacOS">
          <MacOSController :close-window="fakeFunc" :minimize-window="fakeFunc" />
        </tv-tab-item>
        <tv-tab-item icon="windows" name="Windows">
          <WindowsController :close-window="fakeFunc" :minimize-window="fakeFunc" />
        </tv-tab-item>
      </tv-tab-item-group>
      <tv-tab-item-group :name="$t('settings.appearance.paint-custom.aside.name')">
        <tv-tab-item icon="leaf" :name="$t('settings.appearance.paint-custom.aside.leaf')">GOOD,TOUCH</tv-tab-item>
        <tv-tab-item icon="plant" :name="$t('settings.appearance.paint-custom.aside.plant')" disabled>GOOD,TOUCH</tv-tab-item>
        <tv-tab-item icon="blaze" :name="$t('settings.appearance.paint-custom.aside.blaze')" disabled></tv-tab-item>
      </tv-tab-item-group>
      <tv-tab-item-group :name="$t('settings.appearance.paint-custom.icon.name')">
        <tv-tab-item icon="exchange" :name="$t('settings.appearance.paint-custom.icon.exchange')" disabled>THIS,HUGE</tv-tab-item>
        <tv-tab-item icon="remixicon" :name="$t('settings.appearance.paint-custom.icon.remixicon')">THIS,HUGE</tv-tab-item>
      </tv-tab-item-group>
      <tv-tab-item icon="more" :name="$t('settings.appearance.paint-custom.more')">MORE, SETTING</tv-tab-item>
    </tv-tabs>
  </div>
</template>

<script>
export default {
  name: "PaintCustom"
}
</script>

<script setup>
import TvTabs from '@comp/tabs/vertical/TvTabs.vue'
import TvTabItem from '@comp/tabs/vertical/TvTabItem.vue'
import TvTabItemGroup from '@comp/tabs/vertical/TvTabItemGroup.vue'
import { reactive, ref, unref, watch } from 'vue'
import MacOSController from '@comp/customize/controller/MacOSController.vue'
import WindowsController from '@comp/customize/controller/WindowsController.vue'
import { $t } from '@modules/lang'

const activeNodes = ref(window.$storage.paintCustom)

watch(() => activeNodes.value, () => {
  Object.assign(window.$storage.paintCustom, activeNodes.value)
})

function fakeFunc() {}

</script>

<style lang="scss" scoped>
.PaintCustom-Container {
  position: relative;

  width: 100%;
  height: 100%;
}
</style>