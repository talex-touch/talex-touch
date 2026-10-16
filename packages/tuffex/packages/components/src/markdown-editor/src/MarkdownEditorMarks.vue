<script setup lang="ts">
import type { OverlayBox } from './editor-overlay'
import { boxStyle } from './use-markdown-overlay'

// Internal: the overlay's boxes over a rendered view, highlights under its
// text and peers' carets over it. The layers' z-index stacks them around the
// text, wherever they sit in the page.
defineOptions({ name: 'TxMarkdownEditorMarks' })

defineProps<{
  under: OverlayBox[]
  carets: OverlayBox[]
}>()
</script>

<template>
  <div v-if="under.length" class="tx-markdown-editor__underlay" aria-hidden="true">
    <span
      v-for="box in under"
      :key="box.key"
      class="tx-markdown-editor__mark"
      :class="[`is-${box.kind}`, { 'is-active': box.active }]"
      :style="boxStyle(box)"
    />
  </div>
  <div v-if="carets.length" class="tx-markdown-editor__overlay" aria-hidden="true">
    <span
      v-for="box in carets"
      :key="box.key"
      class="tx-markdown-editor__peer-caret"
      :class="{ 'is-labelled': box.labelled }"
      :data-name="box.label"
      :style="boxStyle(box)"
    />
  </div>
</template>
