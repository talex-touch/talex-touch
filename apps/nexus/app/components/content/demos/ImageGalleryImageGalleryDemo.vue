<script setup lang="ts">
import { computed } from 'vue'

const { locale } = useI18n()

// One landscape and one portrait source: the lightbox contains both inside the
// viewport, so the reader can see neither axis is cropped.
const sources = [
  { id: 'one', url: 'https://picsum.photos/seed/talex-gallery-one/640/420' },
  { id: 'two', url: 'https://picsum.photos/seed/talex-gallery-two/640/420' },
  { id: 'three', url: 'https://picsum.photos/seed/talex-gallery-three/480/760' },
]

const copy = computed(() => (locale.value === 'zh'
  ? {
      names: { one: '工作区概览', two: '发布图表', three: '插件详情' } as Record<string, string>,
      previewTitle: '预览',
      previousLabel: '上一张',
      nextLabel: '下一张',
      previousText: '上一张',
      nextText: '下一张',
      closeLabel: '关闭',
      itemLabel: (index: number) => `第 ${index + 1} 张`,
      openLabel: (label: string) => `预览：${label}`,
    }
  : {
      names: { one: 'Workspace overview', two: 'Release graph', three: 'Plugin detail' } as Record<string, string>,
      previewTitle: 'Preview',
      previousLabel: 'Previous image',
      nextLabel: 'Next image',
      previousText: 'Prev',
      nextText: 'Next',
      closeLabel: 'Close',
      itemLabel: (index: number) => `Image ${index + 1}`,
      openLabel: (label: string) => `Open ${label} preview`,
    }))

const items = computed(() => sources.map(item => ({ ...item, name: copy.value.names[item.id] })))
</script>

<template>
  <div class="image-gallery-demo">
    <TxImageGallery
      :items="items"
      :start-index="1"
      :preview-title="copy.previewTitle"
      :previous-label="copy.previousLabel"
      :next-label="copy.nextLabel"
      :previous-text="copy.previousText"
      :next-text="copy.nextText"
      :close-label="copy.closeLabel"
      :item-label-formatter="copy.itemLabel"
      :open-label-formatter="copy.openLabel"
    />
  </div>
</template>

<style scoped>
.image-gallery-demo {
  width: min(460px, 100%);
}
</style>
