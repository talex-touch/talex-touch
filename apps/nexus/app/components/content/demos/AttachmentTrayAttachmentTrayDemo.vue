<script setup lang="ts">
import type { AiAttachment, AiAttachmentFile } from '@tuffex-components/ai-elements'
import { computed, ref } from 'vue'

const { locale } = useI18n()

const copy = computed(() => (locale.value === 'zh'
  ? {
      hint: '点击图片打开内置预览器，用 ← / → 翻页；点击文件胶囊会派发 open 事件。',
      opened: '宿主将打开：',
      previewTitle: '预览',
      previousLabel: '上一张',
      nextLabel: '下一张',
      previousText: '上一张',
      nextText: '下一张',
      removeLabel: '移除附件',
      cancelLabel: '取消上传',
      closeLabel: '关闭',
    }
  : {
      hint: 'Click an image for the built-in viewer and page with ← / →; a file chip emits open.',
      opened: 'Host would open: ',
      previewTitle: 'Preview',
      previousLabel: 'Previous image',
      nextLabel: 'Next image',
      previousText: 'Prev',
      nextText: 'Next',
      removeLabel: 'Remove attachment',
      cancelLabel: 'Cancel upload',
      closeLabel: 'Close',
    }))

function seed(): AiAttachment[] {
  return [
    { kind: 'image', id: 'i1', url: 'https://picsum.photos/id/1015/400/300', name: 'canyon.jpg' },
    { kind: 'image', id: 'i2', url: 'https://picsum.photos/id/1025/400/300', name: 'pug.jpg' },
    { kind: 'image', id: 'i3', url: 'https://picsum.photos/id/1043/400/300', name: 'shore.jpg', uploading: true, progress: 0.6 },
    // A URL that will not resolve, to show the placeholder rather than a broken glyph.
    { kind: 'image', id: 'i4', url: 'https://example.com/missing.png', name: 'missing.png' },
    { kind: 'file', id: 'f1', name: 'report.pdf', size: 240_000 },
    { kind: 'file', id: 'f2', name: 'uploading.zip', size: 1_200_000, uploading: true, progress: 0.4 },
  ]
}

const attachments = ref<AiAttachment[]>(seed())
const opened = ref<string | null>(null)

// The component never mutates the list; removal is the host's job.
function onRemove(id: string): void {
  attachments.value = attachments.value.filter(item => item.id !== id)
}

function onCancel(id: string): void {
  attachments.value = attachments.value.filter(item => item.id !== id)
}

// Files only — images use the built-in viewer and emit nothing.
function onOpen(attachment: AiAttachmentFile): void {
  opened.value = attachment.name
}

// The demo window's own reset button calls this instead of remounting the demo.
function resetDemo(): void {
  attachments.value = seed()
  opened.value = null
}

defineExpose({ resetDemo })
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Left inside the article's prose on purpose: the tray pins its own image box. -->
    <TxAttachmentTray
      :attachments="attachments"
      removable
      :preview-title="copy.previewTitle"
      :previous-label="copy.previousLabel"
      :next-label="copy.nextLabel"
      :previous-text="copy.previousText"
      :next-text="copy.nextText"
      :close-label="copy.closeLabel"
      :remove-label="copy.removeLabel"
      :cancel-label="copy.cancelLabel"
      @remove="onRemove"
      @cancel="onCancel"
      @open="onOpen"
    />

    <div class="not-prose">
      <span class="text-[13px] text-[var(--tx-text-color-regular)]">
        <template v-if="opened">{{ copy.opened }}<span class="font-medium text-[var(--tx-text-color-primary)]">{{ opened }}</span></template>
        <template v-else>{{ copy.hint }}</template>
      </span>
    </div>
  </div>
</template>
