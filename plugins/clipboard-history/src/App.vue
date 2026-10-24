<script lang="ts" setup>
import { initTuff } from '@talex-touch/utils/plugin/preload'
import ClipboardManagerView from './views/ClipboardManagerView.vue'

initTuff(window)
</script>

<template>
  <ClipboardManagerView />
</template>
