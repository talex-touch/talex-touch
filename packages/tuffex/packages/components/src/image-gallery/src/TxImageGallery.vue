<script setup lang="ts">
import type { ImageGalleryEmits, ImageGalleryItem, ImageGalleryProps } from './types'
import { computed, ref, watch } from 'vue'
import ImageGalleryViewer from './ImageGalleryViewer.vue'

defineOptions({
  name: 'TxImageGallery',
})

const props = withDefaults(defineProps<ImageGalleryProps>(), {
  startIndex: 0,
  previousLabel: 'Previous image',
  nextLabel: 'Next image',
  previousText: 'Prev',
  nextText: 'Next',
  previewTitle: 'Preview',
  closeLabel: 'Close',
  itemLabelFormatter: (index: number) => `Image ${index + 1}`,
  openLabelFormatter: (label: string) => `Open ${label} preview`,
})

const emit = defineEmits<ImageGalleryEmits>()

const visible = ref(false)
const index = ref(0)

const list = computed(() => props.items ?? [])

function clampIndex(value: number): number {
  return Math.min(Math.max(0, value), Math.max(0, list.value.length - 1))
}

watch(
  () => props.startIndex,
  (v) => {
    index.value = clampIndex(v ?? 0)
  },
  { immediate: true },
)

function getItemLabel(item: ImageGalleryItem, i: number): string {
  return item.name || props.itemLabelFormatter(i)
}

function openAt(i: number, event: MouseEvent): void {
  if (list.value.length <= 0)
    return

  index.value = clampIndex(i)
  // The dialog returns focus to whatever had it when it opened; WebKit does not focus a
  // clicked button, so give it the thumbnail explicitly.
  ;(event.currentTarget as HTMLButtonElement | null)?.focus()
  visible.value = true
  const item = list.value[index.value]
  if (item)
    emit('open', { index: index.value, item })
}
</script>

<template>
  <div class="tx-image-gallery">
    <div class="tx-image-gallery__grid">
      <button
        v-for="(item, i) in list"
        :key="item.id"
        type="button"
        class="tx-image-gallery__thumb"
        :aria-label="openLabelFormatter(getItemLabel(item, i))"
        @click="openAt(i, $event)"
      >
        <img :src="item.url" :alt="item.name || ''" loading="lazy">
      </button>
    </div>

    <ImageGalleryViewer
      v-model:open="visible"
      v-model:index="index"
      :items="list"
      fullscreen
      :preview-title="previewTitle"
      :previous-label="previousLabel"
      :next-label="nextLabel"
      :previous-text="previousText"
      :next-text="nextText"
      :close-label="closeLabel"
      @close="emit('close')"
    />
  </div>
</template>

<style scoped lang="scss">
.tx-image-gallery__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
  gap: 10px;
}

.tx-image-gallery__thumb {
  border-radius: 14px;
  border: 1px solid var(--tx-border-color-lighter, #e5e7eb);
  background: var(--tx-fill-color-blank, #fff);
  padding: 0;
  overflow: hidden;
  cursor: pointer;
  aspect-ratio: 1;
}

.tx-image-gallery__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>
