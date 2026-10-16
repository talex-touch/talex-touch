<script setup lang="ts">
import type { AiAttachmentFile, AiAttachmentImage } from '../../ai-elements/src/types'
import type { AttachmentTrayEmits, AttachmentTrayProps } from './types'
import { computed, ref } from 'vue'
import ImageGalleryViewer from '../../image-gallery/src/ImageGalleryViewer.vue'
import AttachmentThumb from './AttachmentThumb.vue'
import TxAttachmentChip from './TxAttachmentChip.vue'

defineOptions({ name: 'TxAttachmentTray' })

const props = withDefaults(defineProps<AttachmentTrayProps>(), {
  removable: false,
  previewTitle: 'Preview',
  previousLabel: 'Previous image',
  nextLabel: 'Next image',
  previousText: 'Prev',
  nextText: 'Next',
  closeLabel: 'Close',
  removeLabel: 'Remove attachment',
  cancelLabel: 'Cancel upload',
})

const emit = defineEmits<AttachmentTrayEmits>()

type ImageAttachment = AiAttachmentImage & { progress?: number, uploading?: boolean }
type FileAttachment = AiAttachmentFile & { progress?: number, uploading?: boolean }

const images = computed(() =>
  props.attachments.filter((item): item is ImageAttachment => item.kind === 'image'),
)
const files = computed(() =>
  props.attachments.filter((item): item is FileAttachment => item.kind === 'file'),
)

// -- Broken images become a placeholder instead of a browser broken-image glyph.
// Keyed by URL, so a host that swaps a failed URL for a new one gets a fresh load.
const failedUrls = ref(new Set<string>())

function markFailed(url: string): void {
  failedUrls.value = new Set(failedUrls.value).add(url)
}

// -- Preview: TxImageGallery's dialog, which keeps the index on a real image as the list
// changes and closes when no image is left.

const viewerOpen = ref(false)
const viewerIndex = ref(0)

function openViewer(index: number): void {
  viewerIndex.value = index
  viewerOpen.value = true
}
</script>

<template>
  <div class="tx-attachment-tray">
    <div v-if="images.length > 0" class="tx-attachment-tray__grid">
      <AttachmentThumb
        v-for="(image, index) in images"
        :key="image.id"
        :attachment="image"
        :removable="removable"
        :broken="failedUrls.has(image.url)"
        :open-label="`${previewTitle}: ${image.name ?? image.id}`"
        :remove-label="removeLabel"
        :cancel-label="cancelLabel"
        @open="openViewer(index)"
        @remove="emit('remove', $event)"
        @cancel="emit('cancel', $event)"
        @error="markFailed(image.url)"
      />
    </div>

    <div v-if="files.length > 0" class="tx-attachment-tray__files">
      <TxAttachmentChip
        v-for="file in files"
        :key="file.id"
        :attachment="file"
        :removable="removable"
        :remove-label="removeLabel"
        :cancel-label="cancelLabel"
        :size-formatter="sizeFormatter"
        @remove="emit('remove', $event)"
        @cancel="emit('cancel', $event)"
        @open="emit('open', $event)"
      />
    </div>

    <ImageGalleryViewer
      v-model:open="viewerOpen"
      v-model:index="viewerIndex"
      :items="images"
      :failed="failedUrls"
      :preview-title="previewTitle"
      :previous-label="previousLabel"
      :next-label="nextLabel"
      :previous-text="previousText"
      :next-text="nextText"
      :close-label="closeLabel"
      @error="markFailed"
    />
  </div>
</template>

<style lang="scss">
.tx-attachment-tray {
  display: grid;
  gap: 8px;
}

.tx-attachment-tray__grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tx-attachment-tray__files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
