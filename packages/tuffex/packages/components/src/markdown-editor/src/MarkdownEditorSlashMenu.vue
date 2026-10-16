<script setup lang="ts">
import type { BaseAnchorVirtualReference } from '../../base-anchor/src/types'
import type { MarkdownSlashState } from './use-markdown-slash'
import { computed, nextTick, ref, watch } from 'vue'
import { TxBaseAnchor } from '../../base-anchor'
import { TxIcon } from '../../icon'

// Internal: the slash command menu of the rich surface. The surface keeps
// focus; the editor drives `active` from the arrow keys.
defineOptions({ name: 'TxMarkdownEditorSlashMenu' })

const props = defineProps<{
  state: MarkdownSlashState | null
  label: string
  reference: BaseAnchorVirtualReference
  theme: 'light' | 'dark'
}>()

const emit = defineEmits<{
  pick: [index: number]
  hover: [index: number]
  close: []
}>()

const layerClass = computed(() => ['tx-markdown-editor-layer', `tx-markdown-editor-layer--${props.theme}`])
const anchor = ref<InstanceType<typeof TxBaseAnchor> | null>(null)
const list = ref<HTMLElement | null>(null)

watch(() => props.state?.active, async (active) => {
  if (active === undefined)
    return
  await nextTick()
  list.value?.children[active]?.scrollIntoView?.({ block: 'nearest' })
})

defineExpose({
  updatePosition: () => anchor.value?.updatePosition?.(),
  containsFloating: (target: Node) => !!anchor.value?.containsFloating(target),
})
</script>

<template>
  <TxBaseAnchor
    ref="anchor"
    :model-value="!!state"
    :class="layerClass"
    :data-theme="theme"
    :virtual-reference="reference"
    placement="bottom-start"
    :offset="6"
    :min-width="248"
    :max-width="280"
    :panel-padding="4"
    @update:model-value="(open: boolean) => !open && emit('close')"
  >
    <ul
      v-if="state"
      ref="list"
      class="tx-markdown-editor-slash"
      role="listbox"
      :aria-label="label"
      @mousedown.prevent
    >
      <li
        v-for="(item, position) in state.items"
        :key="item.id"
        class="tx-markdown-editor-slash__item"
        :class="{ 'is-active': position === state.active }"
        role="option"
        :aria-selected="position === state.active"
        @mousemove="position !== state.active && emit('hover', position)"
        @click="emit('pick', position)"
      >
        <span class="tx-markdown-editor-slash__icon" aria-hidden="true">
          <TxIcon v-if="item.icon" :name="item.icon" :size="15" />
          <template v-else>{{ item.glyph }}</template>
        </span>
        <span class="tx-markdown-editor-slash__label">{{ item.label }}</span>
        <span class="tx-markdown-editor-slash__hint" aria-hidden="true">{{ item.hint }}</span>
      </li>
    </ul>
  </TxBaseAnchor>
</template>

<style lang="scss">
.tx-markdown-editor-slash {
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 304px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  color: var(--tx-markdown-editor-text);
  font-size: 13px;
}

.tx-markdown-editor-slash__item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 34px;
  padding: 0 8px 0 5px;
  border-radius: 8px;
  cursor: pointer;

  &.is-active {
    background: color-mix(in srgb, var(--tx-markdown-editor-accent) 14%, transparent);
  }
}

.tx-markdown-editor-slash__icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--tx-markdown-editor-border);
  border-radius: 6px;
  background: var(--tx-markdown-editor-bg);
  color: var(--tx-markdown-editor-muted);
  font-size: 11px;
  font-weight: calc(var(--tx-font-weight-bold, 700) - 50);
  letter-spacing: -0.02em;
}

.tx-markdown-editor-slash__item.is-active .tx-markdown-editor-slash__icon {
  border-color: color-mix(in srgb, var(--tx-markdown-editor-accent) 40%, transparent);
  color: var(--tx-markdown-editor-accent);
}

.tx-markdown-editor-slash__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tx-markdown-editor-slash__hint {
  flex: none;
  color: var(--tx-markdown-editor-placeholder);
  font-family: var(--tx-font-family-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 11px;
}
</style>
