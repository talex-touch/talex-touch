<script setup lang="ts">
import type { MarkdownStats } from './markdown-stats'
import type { MarkdownEditorLabels, MarkdownEditorPeer, MarkdownEditorUser } from './types'
import { computed } from 'vue'

// Internal: the status bar: counts, the uploads in flight, and who else is editing.
defineOptions({ name: 'TxMarkdownEditorStatus' })

const props = defineProps<{
  labels: MarkdownEditorLabels
  stats: MarkdownStats
  upload: { active: number, failed: number, progress: number }
  user: MarkdownEditorUser
  peers: Array<MarkdownEditorPeer & { color: string }>
}>()

const counts = computed(() => [
  props.labels.words.replace('{count}', String(props.stats.words)),
  props.labels.characters.replace('{count}', String(props.stats.characters)),
])

const uploadStatus = computed(() => {
  const { active, failed, progress } = props.upload
  if (active)
    return { text: `${props.labels.uploading} ${progress}%`, failed: false }
  if (failed)
    return { text: props.labels.uploadFailed, failed: true }
  return null
})

const shownPeers = computed(() => props.peers.slice(0, 4))
const peersTitle = computed(() => [props.user.name, ...props.peers.map(peer => peer.name)].join(', '))
const peersLabel = computed(() => props.labels.peers.replace('{count}', String(props.peers.length + 1)))

function initial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?'
}
</script>

<template>
  <div class="tx-markdown-editor__status">
    <span v-for="count in counts" :key="count">{{ count }}</span>
    <span
      v-if="uploadStatus"
      class="tx-markdown-editor__status-upload"
      :class="{ 'is-failed': uploadStatus.failed }"
      role="status"
    >{{ uploadStatus.text }}</span>
    <span v-if="peers.length" class="tx-markdown-editor__peers" :title="peersTitle">
      <span class="tx-markdown-editor__avatars" aria-hidden="true">
        <span
          v-for="peer in shownPeers"
          :key="peer.id"
          class="tx-markdown-editor__avatar"
          :style="{ '--tx-markdown-editor-peer': peer.color }"
        >
          <img v-if="peer.avatar" :src="peer.avatar" alt="">
          <template v-else>{{ initial(peer.name) }}</template>
        </span>
      </span>
      {{ peersLabel }}
    </span>
  </div>
</template>

<style lang="scss">
.tx-markdown-editor__status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  min-height: 30px;
  padding: 4px 12px;
  border-top: 1px solid var(--tx-markdown-editor-border);
  background: var(--tx-markdown-editor-toolbar-bg);
  color: var(--tx-markdown-editor-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.tx-markdown-editor__status-upload {
  color: var(--tx-markdown-editor-accent);
  font-weight: var(--tx-font-weight-medium, 500);

  &.is-failed {
    color: var(--tx-markdown-editor-danger);
  }
}

.tx-markdown-editor__peers {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.tx-markdown-editor__avatars {
  display: inline-flex;
  padding-left: 4px;
}

.tx-markdown-editor__avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-left: -4px;
  overflow: hidden;
  border-radius: 50%;
  background: var(--tx-markdown-editor-peer);
  box-shadow: 0 0 0 2px var(--tx-markdown-editor-toolbar-bg);
  color: var(--tx-color-white, #ffffff);
  font-size: 10px;
  font-weight: var(--tx-font-weight-semibold, 600);

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}
</style>
