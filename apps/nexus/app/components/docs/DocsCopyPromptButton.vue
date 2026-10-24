<script setup lang="ts">
const {
  state: copyState,
  label: copyPromptLabel,
  icon: copyPromptIcon,
  announcement: copyPromptAnnouncement,
  hint: copyPromptHint,
  copy: copyPrompt,
  prefetch: prefetchPrompt,
} = useDocsMarkdownCopy()
</script>

<template>
  <!-- Copies the page's Markdown source, the same file `<page>.md` serves. -->
  <button
    type="button"
    class="docs-aside-prompt"
    :class="`is-${copyState}`"
    :title="copyPromptHint"
    @pointerenter="prefetchPrompt"
    @focus="prefetchPrompt"
    @click="copyPrompt"
  >
    <span class="docs-aside-prompt__spark i-carbon-ai-status" aria-hidden="true" />
    <span class="docs-aside-prompt__label">{{ copyPromptLabel }}</span>
    <span class="docs-aside-prompt__state" :class="copyPromptIcon" aria-hidden="true" />
  </button>
  <span class="sr-only" role="status">{{ copyPromptAnnouncement }}</span>
</template>

<style scoped>
/*
 * The one accent in the rail: a hairline gradient border rendered with two
 * backgrounds (padding-box over border-box) so it stays crisp at 1px.
 */
.docs-aside-prompt {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 9px;
  border: 1px solid transparent;
  padding: 11px 13px;
  border-radius: 10px;
  color: var(--tx-text-color-primary, #303133);
  background:
    linear-gradient(var(--tx-bg-color-overlay, #fff), var(--tx-bg-color-overlay, #fff)) padding-box,
    linear-gradient(135deg, #6e8bff, #b07cff 50%, #ff9fc0) border-box;
  cursor: pointer;
  font: inherit;
  transition:
    box-shadow var(--tx-transition-duration-fast, 0.2s) var(--tx-transition-function, ease-in-out),
    transform var(--tx-transition-duration-fast, 0.2s) var(--tx-transition-function, ease-in-out);
}

.docs-aside-prompt:hover,
.docs-aside-prompt:focus-visible {
  box-shadow: 0 4px 16px color-mix(in srgb, #b07cff 22%, transparent);
  transform: translateY(-1px);
  outline: none;
}

.docs-aside-prompt__spark {
  font-size: 16px;
  color: var(--tx-text-color-primary, #303133);
}

.docs-aside-prompt__label {
  flex: 1;
  text-align: left;
  font-size: 13.5px;
  font-weight: 500;
}

.docs-aside-prompt__state {
  color: var(--tx-text-color-placeholder, #a8abb2);
  font-size: 15px;
}

.docs-aside-prompt.is-copied .docs-aside-prompt__state {
  color: var(--tx-color-success, #67c23a);
}

.docs-aside-prompt.is-failed .docs-aside-prompt__state {
  color: var(--tx-color-danger, #f56c6c);
}
</style>
