<script name="App" lang="ts" setup>
import AppLayout from '~/views/layout/AppLayout.vue'
import {
  applicationUpgrade,
  clipBoardResolver,
  dropperResolver,
  urlHooker,
  usePlugin,
  usePlugins
} from '~/modules/hooks/application-hooks'
import { useCoreBox } from '~/modules/hooks/core-box'
import { touchChannel } from '~/modules/channel/channel-core'
import Beginner from '~/views/base/begin/Beginner.vue'
import { appSetting } from '~/modules/channel/storage/index'
import CoreBox from '~/views/box/CoreBox.vue'

const packageJson = window.$nodeApi.getPackageJSON()

const [, pluginsScope] = usePlugins()
const pluginScope = usePlugin()

onBeforeUnmount(() => {
  pluginScope()
  ;(pluginsScope as any).stop()
})

const _init = ref(false)
const beginner = ref(false)

function init() {
  touchChannel.send('app-ready').then((res: any) => {
    window.$startupInfo = res

    document.body.classList.add(window.$startupInfo.platform)

    applicationUpgrade()
    clipBoardResolver()
    dropperResolver()
    urlHooker()
    // screenCapture()

    _init.value = true

    if (!appSetting?.beginner?.init) beginner.value = true
  })
}

const _coreBox = ref(false)

onMounted(() => {
  try {
    setTimeout(init, 1000)
  } catch (e) {
    console.error('FATAL ERROR OCCURRED')
    console.error(e)
  }

  _coreBox.value = document.body.classList.contains('core-box')

  if (_coreBox.value) {
    useCoreBox()

    console.log(
      '%c CoreBox MODE ',
      'background: #42b983; color: #fff;padding: 2px 4px; border-radius: 4px;font-weight: bold;'
    )
  }
})

// const ipcHandle = (): void => window.electron.ipcRenderer.send('ping')
</script>

<template>
  <AppLayout v-if="_init">
    <template #title>
      TalexTouch
      <span class="tag version fake-background">{{ packageJson.version }}</span>
    </template>
  </AppLayout>

  <CoreBox v-if="_coreBox" />
  <Beginner v-else-if="beginner" />
</template>
