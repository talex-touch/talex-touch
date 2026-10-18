<script setup lang="ts">
import type {
  BrowserBookmarkCommand,
  BrowserConnectedProfile,
  ChromeBookmarkNode
} from '@talex-touch/utils/transport/sdk/domains/browser-connection'
import { TxButton } from '@talex-touch/tuffex/button'
import { TxInput } from '@talex-touch/tuffex/input'
import { TxModal } from '@talex-touch/tuffex/modal'
import { TxVirtualList } from '@talex-touch/tuffex/virtual-list'
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import {
  isOpenableBrowserUrl,
  normalizeBrowserUrlInput,
  useBrowserConnection
} from '~/modules/browser-connection/useBrowserConnection'

export type ChromeBookmarkDialogMode =
  | 'create-bookmark'
  | 'create-folder'
  | 'edit'
  | 'move'
  | 'save-page'

/**
 * The one form behind every Chrome bookmark write the Browser page offers: create a bookmark or
 * folder, rename/re-point, move, and "add the current Tuff page to a Chrome folder". It submits
 * one command to Main and closes only after Main persisted it; Chrome applies it from Main's queue.
 */
const props = defineProps<{
  modelValue: boolean
  mode: ChromeBookmarkDialogMode
  profile: BrowserConnectedProfile
  node?: ChromeBookmarkNode | null
  folderId?: string | null
  page?: { title: string; url: string } | null
}>()
const emit = defineEmits<{ 'update:modelValue': [open: boolean] }>()

const { t } = useI18n()
const { bookmark, busy, describeError } = useBrowserConnection()
const titleId = useId()
const urlId = useId()
const title = ref('')
const url = ref('')
const parentId = ref('')
const folderQuery = ref('')
const folderQueryId = useId()
const error = ref('')

const byId = computed(() => new Map(props.profile.bookmarks.map((node) => [node.id, node])))
const pending = computed(() => busy.has(`bookmark:${props.profile.id}`))
const showTitle = computed(() => props.mode !== 'move')
const showUrl = computed(
  () =>
    props.mode === 'create-bookmark' ||
    (props.mode === 'edit' && props.node?.url !== null && props.node?.url !== undefined)
)
const showFolder = computed(() => props.mode !== 'edit')
const HEADING_BY_MODE: Record<ChromeBookmarkDialogMode, string> = {
  'create-bookmark': 'chromeLibrary.dialog.createBookmark',
  'create-folder': 'chromeLibrary.dialog.createFolder',
  edit: 'chromeLibrary.dialog.edit',
  move: 'chromeLibrary.dialog.move',
  'save-page': 'chromeLibrary.dialog.savePage'
}
const heading = computed(() => t(HEADING_BY_MODE[props.mode]))

function folderPath(node: ChromeBookmarkNode): string {
  const names: string[] = []
  let current: ChromeBookmarkNode | undefined = node
  while (current && current.parentId !== null) {
    names.unshift(current.title || t('chromeLibrary.untitledFolder'))
    current = byId.value.get(current.parentId)
  }
  return names.join(' / ')
}

/** Folders that may receive the child; a moved folder can never land inside itself. */
const folders = computed(() => {
  const excluded = new Set<string>()
  if (props.mode === 'move' && props.node) {
    const children = new Map<string, string[]>()
    for (const node of props.profile.bookmarks) {
      if (node.parentId === null || node.url !== null) continue
      const list = children.get(node.parentId) ?? []
      list.push(node.id)
      children.set(node.parentId, list)
    }
    const stack = [props.node.id]
    while (stack.length) {
      const id = stack.pop()!
      excluded.add(id)
      stack.push(...(children.get(id) ?? []))
    }
  }
  return props.profile.bookmarks
    .filter((node) => node.url === null && node.canAddChildren && !excluded.has(node.id))
    .map((node) => ({ id: node.id, label: folderPath(node) }))
    .sort((a, b) => a.label.localeCompare(b.label))
})
/** A library can hold tens of thousands of folders: filter by path, then render only what shows. */
const FOLDER_ROW_HEIGHT = 36
const visibleFolders = computed(() => {
  const query = folderQuery.value.trim().toLocaleLowerCase()
  return query
    ? folders.value.filter((folder) => folder.label.toLocaleLowerCase().includes(query))
    : folders.value
})
const selectedFolderLabel = computed(
  () => folders.value.find((folder) => folder.id === parentId.value)?.label ?? ''
)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    error.value = ''
    folderQuery.value = ''
    title.value = props.mode === 'save-page' ? (props.page?.title ?? '') : (props.node?.title ?? '')
    url.value = props.node?.url ?? ''
    // The caller's folder first (the one being browsed, or a moved node's current parent), then
    // Chrome's Bookmarks Bar, then whatever folder accepts children.
    const preferred = props.mode === 'move' ? props.node?.parentId : (props.folderId ?? undefined)
    const bar = props.profile.bookmarks.find((node) => node.folderType === 'bookmarks-bar')?.id
    parentId.value =
      [preferred, bar].find((id) => folders.value.some((folder) => folder.id === id)) ??
      folders.value[0]?.id ??
      ''
  },
  { immediate: true }
)

function close(): void {
  emit('update:modelValue', false)
}

function buildCommand(): BrowserBookmarkCommand | string {
  const name = title.value.trim()
  if (showTitle.value && !name && props.mode !== 'save-page')
    return t('chromeLibrary.dialog.titleRequired')
  if (showFolder.value && !parentId.value) return t('chromeLibrary.dialog.folderRequired')
  if (props.mode === 'create-folder')
    return { kind: 'create', parentId: parentId.value, title: name }
  if (props.mode === 'save-page') {
    const pageUrl = props.page?.url
    if (!isOpenableBrowserUrl(pageUrl)) return t('chromeLibrary.dialog.pageUnsupported')
    return { kind: 'create', parentId: parentId.value, title: name || pageUrl, url: pageUrl }
  }
  if (props.mode === 'create-bookmark') {
    const target = normalizeBrowserUrlInput(url.value)
    if (!target) return t('chromeLibrary.dialog.urlInvalid')
    return { kind: 'create', parentId: parentId.value, title: name || target, url: target }
  }
  const node = props.node
  if (!node) return t('chromeLibrary.dialog.missing')
  if (props.mode === 'move') return { kind: 'move', id: node.id, parentId: parentId.value }
  // An unchanged address is left out, so an existing chrome:// or javascript: bookmark can still
  // be renamed without that address ever passing through a URL write.
  if (node.url === null || url.value.trim() === node.url)
    return { kind: 'update', id: node.id, title: name }
  const target = normalizeBrowserUrlInput(url.value)
  if (!target) return t('chromeLibrary.dialog.urlInvalid')
  return { kind: 'update', id: node.id, title: name, url: target }
}

async function submit(): Promise<void> {
  if (pending.value) return
  const command = buildCommand()
  if (typeof command === 'string') {
    error.value = command
    return
  }
  error.value = ''
  const failure = await bookmark(props.profile.id, command)
  if (failure) {
    error.value = describeError(failure)
    return
  }
  toast.success(t('chromeLibrary.dialog.queued', { profile: props.profile.label }))
  close()
}
</script>

<template>
  <TxModal
    :model-value="modelValue"
    :title="heading"
    :close-label="t('common.close')"
    width="440px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <form class="flex flex-col gap-3" novalidate @submit.prevent="submit">
      <p class="m-0 text-xs leading-normal text-[var(--tx-text-color-secondary)]">
        {{ t('chromeLibrary.dialog.target', { profile: profile.label }) }}
      </p>
      <p
        v-if="mode === 'save-page' && page"
        class="m-0 truncate text-xs text-[var(--tx-text-color-secondary)]"
        :title="page.url"
      >
        {{ page.url }}
      </p>
      <div v-if="showTitle" class="flex flex-col gap-1">
        <label :for="titleId" class="text-xs font-medium">{{
          t(
            mode === 'create-folder'
              ? 'chromeLibrary.dialog.folderName'
              : 'chromeLibrary.dialog.title'
          )
        }}</label>
        <TxInput :id="titleId" v-model="title" :disabled="pending" />
      </div>
      <div v-if="showUrl" class="flex flex-col gap-1">
        <label :for="urlId" class="text-xs font-medium">{{ t('chromeLibrary.dialog.url') }}</label>
        <TxInput
          :id="urlId"
          v-model="url"
          :placeholder="t('chromeLibrary.dialog.urlPlaceholder')"
          :disabled="pending"
          spellcheck="false"
          autocomplete="off"
        />
        <p
          v-if="mode === 'edit' && node?.url && !isOpenableBrowserUrl(node.url)"
          class="m-0 text-[11px] leading-normal text-[var(--tx-text-color-secondary)]"
        >
          {{ t('chromeLibrary.dialog.specialUrlKept') }}
        </p>
      </div>
      <div v-if="showFolder" class="flex flex-col gap-1">
        <label :for="folderQueryId" class="text-xs font-medium">{{
          t('chromeLibrary.dialog.folder')
        }}</label>
        <p
          v-if="!folders.length"
          role="status"
          class="m-0 text-xs text-[var(--tx-text-color-secondary)]"
        >
          {{ t('chromeLibrary.dialog.noFolders') }}
        </p>
        <template v-else>
          <TxInput
            :id="folderQueryId"
            v-model="folderQuery"
            :placeholder="t('chromeLibrary.dialog.folderSearch')"
            :disabled="pending"
            spellcheck="false"
            autocomplete="off"
          />
          <p class="m-0 truncate text-xs text-[var(--tx-text-color-secondary)]" role="status">
            {{
              selectedFolderLabel
                ? t('chromeLibrary.dialog.selectedFolder', { folder: selectedFolderLabel })
                : t('chromeLibrary.dialog.folderRequired')
            }}
          </p>
          <p
            v-if="!visibleFolders.length"
            class="m-0 text-xs text-[var(--tx-text-color-secondary)]"
          >
            {{ t('chromeLibrary.dialog.folderNoMatch') }}
          </p>
          <TxVirtualList
            v-else
            :items="visibleFolders"
            :item-height="FOLDER_ROW_HEIGHT"
            :height="Math.min(visibleFolders.length * FOLDER_ROW_HEIGHT, 216)"
            item-key="id"
            role="group"
            :aria-label="t('chromeLibrary.dialog.folder')"
          >
            <template #item="{ item: folder }">
              <TxButton
                variant="ghost"
                size="sm"
                block
                :icon="folder.id === parentId ? 'i-ri-checkbox-circle-fill' : 'i-ri-folder-3-line'"
                :aria-pressed="folder.id === parentId"
                :disabled="pending"
                :title="folder.label"
                @click="parentId = folder.id"
              >
                <span class="min-w-0 flex-1 truncate text-left">{{ folder.label }}</span>
              </TxButton>
            </template>
          </TxVirtualList>
        </template>
      </div>
      <p v-if="error" role="alert" class="m-0 break-words text-xs text-[var(--tx-color-danger)]">
        {{ error }}
      </p>
      <div class="flex justify-end gap-2">
        <TxButton variant="ghost" :disabled="pending" @click="close">
          {{ t('common.cancel') }}
        </TxButton>
        <TxButton
          variant="primary"
          native-type="submit"
          :loading="pending"
          :disabled="pending || (showFolder && !folders.length)"
        >
          {{ t('chromeLibrary.dialog.save') }}
        </TxButton>
      </div>
    </form>
  </TxModal>
</template>
