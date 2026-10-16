<script setup lang="ts">
import type { AiAttachment } from '@tuffex-components/ai-elements'
import { computed, ref } from 'vue'
import { tileImage } from './tile-image'

const { locale } = useI18n()
const zh = computed(() => locale.value === 'zh')
const labels = computed(() => zh.value
  ? { preview: '预览', previous: '上一张', next: '下一张', previousText: '上一张', nextText: '下一张', close: '关闭', remove: '移除附件' }
  : { preview: 'Preview', previous: 'Previous image', next: 'Next image', previousText: 'Prev', nextText: 'Next', close: 'Close', remove: 'Remove attachment' })

const RIDGE = tileImage('#1e3a8a', '#60a5fa', '#e0f2fe', 4)
const VALLEY = tileImage('#064e3b', '#4ade80', '#fef9c3', 4)

// Removing is the host's job, so the specimen keeps its own list; the cell's
// reset remounts it with everything back.
const kept = ref(['ridge', 'valley', 'notes'])

const attachments = computed(() => {
  const all: AiAttachment[] = [
    { kind: 'image', id: 'ridge', url: RIDGE, name: zh.value ? '山脊晨光.png' : 'dawn-ridge.png', width: 640, height: 480 },
    { kind: 'image', id: 'valley', url: VALLEY, name: zh.value ? '松谷.png' : 'pine-valley.png', width: 640, height: 480 },
    { kind: 'file', id: 'notes', name: zh.value ? '旅行手记.pdf' : 'trip-notes.pdf', size: 248_000, mime: 'application/pdf' },
  ]
  return all.filter(item => kept.value.includes(item.id))
})

function remove(id: string): void {
  kept.value = kept.value.filter(item => item !== id)
}
</script>

<template>
  <TxAttachmentTray
    :attachments="attachments"
    removable
    :preview-title="labels.preview"
    :previous-label="labels.previous"
    :next-label="labels.next"
    :previous-text="labels.previousText"
    :next-text="labels.nextText"
    :close-label="labels.close"
    :remove-label="labels.remove"
    @remove="remove"
  />
</template>
