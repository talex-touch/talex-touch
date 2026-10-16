<script setup lang="ts">
import type { ImageGalleryItem } from '@tuffex-components/image-gallery'
import { computed } from 'vue'

defineProps<{ items: ImageGalleryItem[] }>()

const { locale } = useI18n()
const labels = computed(() => locale.value === 'zh'
  ? {
      preview: '预览',
      previous: '上一张',
      next: '下一张',
      previousText: '上一张',
      nextText: '下一张',
      close: '关闭',
      item: (index: number) => `第 ${index + 1} 张`,
      open: (label: string) => `预览：${label}`,
    }
  : {
      preview: 'Preview',
      previous: 'Previous image',
      next: 'Next image',
      previousText: 'Prev',
      nextText: 'Next',
      close: 'Close',
      item: (index: number) => `Image ${index + 1}`,
      open: (label: string) => `Open ${label} preview`,
    })
</script>

<template>
  <TxImageGallery
    :items="items"
    :preview-title="labels.preview"
    :previous-label="labels.previous"
    :next-label="labels.next"
    :previous-text="labels.previousText"
    :next-text="labels.nextText"
    :close-label="labels.close"
    :item-label-formatter="labels.item"
    :open-label-formatter="labels.open"
  />
</template>
