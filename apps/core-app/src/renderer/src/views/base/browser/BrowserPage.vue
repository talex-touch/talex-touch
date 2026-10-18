<script setup lang="ts">
import type {
  BrowserSavedPage,
  BrowserViewportRequest,
  BrowserWorkspaceState
} from '@talex-touch/utils/transport/sdk/domains/browser'
import { createBrowserSdk } from '@talex-touch/utils/transport/sdk/domains/browser'
import { useTuffTransport } from '@talex-touch/utils/transport'
import { TxButton, TxIconButton } from '@talex-touch/tuffex/button'
import {
  TxContextMenu,
  TxContextMenuDivider,
  TxContextMenuItem
} from '@talex-touch/tuffex/context-menu'
import { TxSkeleton } from '@talex-touch/tuffex/skeleton'
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  shallowRef,
  watch
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import MetaHintBadge from '~/components/shell/MetaHintBadge.vue'
import { useConversationEntry } from '~/modules/conversation/useConversationEntry'
import HomePage from '../home/HomePage.vue'
import type { BrowserTabMenuAction } from './tab-actions'
import { runBrowserTabAction } from './tab-actions'

const { t, locale } = useI18n()
const route = useRoute()
const { enterConversation } = useConversationEntry()
const sdk = createBrowserSdk(useTuffTransport())
const state = shallowRef<BrowserWorkspaceState | null>(null)
const error = ref('')
const connecting = ref(true)
const address = ref('')
const addressFocused = ref(false)
const addressInput = ref<HTMLInputElement | null>(null)
const viewport = ref<HTMLElement | null>(null)
const surfaceActive = ref(true)
const panel = ref<'history' | 'bookmarks' | null>(null)
const overlayOpen = ref(false)
const tabMenu = ref<InstanceType<typeof TxContextMenu> | null>(null)
const tabMenuOpen = ref(false)
const tabMenuTargetId = ref('')
const tabMenuIndex = computed(
  () => state.value?.tabs.findIndex((tab) => tab.id === tabMenuTargetId.value) ?? -1
)
const tabMenuTarget = computed(() => state.value?.tabs[tabMenuIndex.value])
const activeTab = computed(() =>
  state.value?.tabs.find((tab) => tab.id === state.value?.activeTabId)
)
const onRoute = computed(() => surfaceActive.value && route.path === '/browser')
const localPage = computed(() => Boolean(activeTab.value && !activeTab.value.url))
const bookmarked = computed(
  () => state.value?.bookmarks.some((page) => page.url === activeTab.value?.url) ?? false
)
const savedPages = computed(() =>
  panel.value === 'bookmarks' ? (state.value?.bookmarks ?? []) : (state.value?.recent ?? [])
)
const shortcuts = [
  { title: 'Google', url: 'https://www.google.com', icon: 'i-simple-icons-google' },
  { title: 'GitHub', url: 'https://github.com', icon: 'i-simple-icons-github' },
  { title: 'Figma', url: 'https://www.figma.com', icon: 'i-simple-icons-figma' },
  { title: 'Notion', url: 'https://www.notion.so', icon: 'i-simple-icons-notion' },
  { title: 'YouTube', url: 'https://www.youtube.com', icon: 'i-simple-icons-youtube' },
  { title: '知乎', url: 'https://www.zhihu.com', icon: 'i-simple-icons-zhihu' }
]
let retryAction: (() => Promise<BrowserWorkspaceState>) | null = null

// The push listener is installed before getState. Both command replies and the first read may
// arrive behind a newer push, so Main's revision is the sole ordering authority.
function applyState(next: BrowserWorkspaceState): void {
  if (state.value && next.revision <= state.value.revision) return
  state.value = next
  connecting.value = false
}

async function refreshState(): Promise<void> {
  connecting.value = true
  error.value = ''
  try {
    applyState(await sdk.getState())
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure)
  } finally {
    connecting.value = false
  }
}

async function command(action: () => Promise<BrowserWorkspaceState>): Promise<boolean> {
  error.value = ''
  try {
    applyState(await action())
    retryAction = null
    return true
  } catch (failure) {
    retryAction = action
    error.value = failure instanceof Error ? failure.message : String(failure)
    return false
  }
}

function retry(): void {
  lastViewport = ''
  if (retryAction) void command(retryAction)
  else void refreshState()
}

function runActive(action: 'back' | 'forward' | 'reload' | 'stop' | 'bookmark' | 'refresh'): void {
  const tab = activeTab.value
  if (!tab) return
  void command(() => {
    if (action === 'bookmark') return sdk.toggleBookmark(tab.id)
    if (action === 'refresh') return tab.loading ? sdk.stop(tab.id) : sdk.reload(tab.id)
    return sdk[action](tab.id)
  })
}

function openTabMenu(tabId: string, event: MouseEvent | KeyboardEvent): void {
  event.preventDefault()
  tabMenuTargetId.value = tabId
  if (event instanceof KeyboardEvent) {
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
    tabMenu.value?.openAt({ x: bounds.left, y: bounds.bottom })
  } else {
    tabMenu.value?.openAt(event)
  }
}

function selectTabMenuAction(action: BrowserTabMenuAction): void {
  if (!tabMenuOpen.value) return
  const tabId = tabMenuTargetId.value
  tabMenuOpen.value = false
  void command(() => runBrowserTabAction(sdk, action, tabId))
}

function focusAddress(): void {
  if (!onRoute.value) return
  addressInput.value?.focus()
  addressInput.value?.select()
}

function onAddressFocus(): void {
  addressFocused.value = true
  addressInput.value?.select()
}

async function navigate(input: string): Promise<void> {
  const tab = activeTab.value
  if (!tab || !input.trim()) return
  const accepted = await command(() => sdk.navigate(tab.id, input.trim()))
  if (!accepted) throw new Error(error.value)
}

function navigateAddress(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'Enter') {
    event.preventDefault()
    void navigate(address.value).catch(() => {})
    addressInput.value?.blur()
  } else if (event.key === 'Escape') {
    address.value = activeTab.value?.url ?? ''
    addressInput.value?.blur()
  }
}

function localIcon(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '')
    return (
      shortcuts.find((site) => new URL(site.url).hostname.replace(/^www\./, '') === hostname)
        ?.icon ?? 'i-ri-global-line'
    )
  } catch {
    return 'i-ri-global-line'
  }
}

function dateLabel(page: BrowserSavedPage): string {
  return new Date(page.visitedAt).toLocaleDateString(locale.value, {
    month: 'short',
    day: 'numeric'
  })
}

async function openSaved(page: BrowserSavedPage): Promise<void> {
  if (await command(() => sdk.createTab(page.url))) panel.value = null
}

// A guest view is above renderer DOM, regardless of z-index. DOM overlays therefore suspend it,
// and the reserved viewport is the only geometry ever handed to Main (never the entire window).
const overlaySelector =
  '[role="dialog"], [role="menu"], [role="listbox"], dialog[open], .tx-base-anchor.is-open, .dialog-mask'
const overlayMutationSelector =
  '[role="dialog"], [role="menu"], [role="listbox"], dialog, .tx-base-anchor, .dialog-mask'
function updateOverlays(): void {
  overlayOpen.value = Array.from(document.querySelectorAll<HTMLElement>(overlaySelector)).some(
    (element) => {
      if (element.closest('[inert], [aria-hidden="true"]')) return false
      const style = getComputedStyle(element)
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        element.getClientRects().length > 0
      )
    }
  )
}

let viewportFrame = 0
let viewportEpoch = 0
let viewportQueue: Promise<void> = Promise.resolve()
let lastViewport = ''
let resizeObserver: ResizeObserver | null = null
let overlayObserver: MutationObserver | null = null
let unsubscribe: (() => void) | undefined
let unsubscribeFocus: (() => void) | undefined
let disposed = false

function enqueueViewport(request: BrowserViewportRequest): void {
  const epoch = ++viewportEpoch
  viewportQueue = viewportQueue.then(async () => {
    // A queued show must not survive a newer hide, route switch, resize or overlay opening.
    if (request.visible && epoch !== viewportEpoch) return
    const key = JSON.stringify(request)
    if (lastViewport === key) return
    try {
      await sdk.setViewport(request)
      lastViewport = key
    } catch (failure) {
      if (!disposed && onRoute.value)
        error.value = failure instanceof Error ? failure.message : String(failure)
    }
  })
}

function hideViewport(): void {
  if (viewportFrame) cancelAnimationFrame(viewportFrame)
  viewportFrame = 0
  enqueueViewport({ visible: false, bounds: { x: 0, y: 0, width: 0, height: 0 } })
}

function measureViewport(): void {
  viewportFrame = 0
  if (
    !onRoute.value ||
    document.hidden ||
    !activeTab.value?.url ||
    activeTab.value.error ||
    error.value ||
    panel.value ||
    overlayOpen.value ||
    tabMenuOpen.value ||
    !viewport.value
  ) {
    hideViewport()
    return
  }
  const bounds = viewport.value.getBoundingClientRect()
  const x = Math.max(0, Math.ceil(bounds.left))
  const y = Math.max(0, Math.ceil(bounds.top))
  const width = Math.max(0, Math.floor(Math.min(bounds.right, window.innerWidth)) - x)
  const height = Math.max(0, Math.floor(Math.min(bounds.bottom, window.innerHeight)) - y)
  enqueueViewport({ visible: width > 0 && height > 0, bounds: { x, y, width, height } })
}

function scheduleViewport(): void {
  if (
    !onRoute.value ||
    document.hidden ||
    overlayOpen.value ||
    tabMenuOpen.value ||
    panel.value ||
    !activeTab.value?.url ||
    activeTab.value.error ||
    error.value
  ) {
    hideViewport()
    return
  }
  if (!viewportFrame) viewportFrame = requestAnimationFrame(measureViewport)
}

function onKeydown(event: KeyboardEvent): void {
  if (
    !onRoute.value ||
    event.isComposing ||
    event.keyCode === 229 ||
    overlayOpen.value ||
    tabMenuOpen.value
  )
    return
  const modifier = event.metaKey || event.ctrlKey
  if (modifier && !event.shiftKey && event.key.toLowerCase() === 'l') {
    event.preventDefault()
    addressInput.value?.focus()
    addressInput.value?.select()
  } else if (modifier && !event.shiftKey && event.key.toLowerCase() === 't') {
    event.preventDefault()
    void command(() => sdk.createTab())
  } else if (modifier && !event.shiftKey && event.key.toLowerCase() === 'w' && activeTab.value) {
    event.preventDefault()
    void command(() => sdk.closeTab(activeTab.value!.id))
  } else if (modifier && event.key.toLowerCase() === 'r' && activeTab.value?.url) {
    event.preventDefault()
    void command(() => sdk.reload(activeTab.value!.id))
  } else if (event.key === 'Escape' && panel.value) {
    event.preventDefault()
    panel.value = null
  }
}

function tabKeydown(event: KeyboardEvent, index: number): void {
  const tabs = state.value?.tabs ?? []
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    const tab = tabs[index]
    if (tab) openTabMenu(tab.id, event)
    return
  }
  let target = index
  if (event.key === 'ArrowRight') target = (index + 1) % tabs.length
  else if (event.key === 'ArrowLeft') target = (index - 1 + tabs.length) % tabs.length
  else if (event.key === 'Home') target = 0
  else if (event.key === 'End') target = tabs.length - 1
  else return
  event.preventDefault()
  const tab = tabs[target]
  if (!tab) return
  void command(() => sdk.activateTab(tab.id)).then(() => {
    document.getElementById(`browser-tab-${tab.id}`)?.focus()
  })
}

watch(
  () => [activeTab.value?.id, activeTab.value?.url],
  ([id], [previousId]) => {
    if (!addressFocused.value || id !== previousId) address.value = activeTab.value?.url ?? ''
    scheduleViewport()
    if (id !== previousId)
      void nextTick(() => {
        document
          .getElementById(`browser-tab-${id}`)
          ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      })
  }
)
watch(
  [onRoute, panel, overlayOpen, tabMenuOpen, error, () => activeTab.value?.error],
  scheduleViewport,
  {
    flush: 'sync'
  }
)
watch(tabMenuOpen, (open) => {
  if (open) return
  void nextTick(() => {
    if (!onRoute.value) return
    const tabId = tabMenuTarget.value?.id ?? activeTab.value?.id
    document.getElementById(`browser-tab-${tabId}`)?.focus()
  })
})
onMounted(() => {
  unsubscribe = sdk.onChanged(applyState)
  unsubscribeFocus = sdk.onFocusAddress(focusAddress)
  void refreshState()
  resizeObserver = new ResizeObserver(scheduleViewport)
  if (viewport.value) resizeObserver.observe(viewport.value)
  overlayObserver = new MutationObserver((mutations) => {
    if (!onRoute.value) return
    if (
      mutations.some((mutation) => {
        const target = mutation.target instanceof Element ? mutation.target : null
        if (target?.matches(overlayMutationSelector) || target?.closest(overlayMutationSelector))
          return true
        return Array.from(mutation.addedNodes)
          .concat(Array.from(mutation.removedNodes))
          .some(
            (node) =>
              node instanceof Element &&
              (node.matches(overlayMutationSelector) || node.querySelector(overlayMutationSelector))
          )
      })
    )
      updateOverlays()
  })
  overlayObserver.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'open', 'aria-hidden', 'inert']
  })
  updateOverlays()
  window.addEventListener('resize', scheduleViewport)
  window.addEventListener('scroll', scheduleViewport, true)
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('visibilitychange', scheduleViewport)
})
onActivated(() => {
  surfaceActive.value = true
  lastViewport = ''
  updateOverlays()
  void nextTick(scheduleViewport)
})
onDeactivated(() => {
  surfaceActive.value = false
  tabMenuOpen.value = false
  hideViewport()
})
onBeforeUnmount(() => {
  disposed = true
  surfaceActive.value = false
  hideViewport()
  unsubscribe?.()
  unsubscribeFocus?.()
  resizeObserver?.disconnect()
  overlayObserver?.disconnect()
  window.removeEventListener('resize', scheduleViewport)
  window.removeEventListener('scroll', scheduleViewport, true)
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('visibilitychange', scheduleViewport)
})
</script>

<template>
  <section
    class="flex h-full min-h-0 min-w-0 flex-col text-[var(--tx-text-color-primary)]"
    :aria-label="t('browser.label')"
    style="-webkit-app-region: no-drag; background: var(--tx-bg-color)"
  >
    <div
      class="flex h-11 flex-none items-center gap-1 px-2 pt-1"
      style="background: var(--tx-fill-color-light); -webkit-app-region: drag"
    >
      <div
        class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        role="tablist"
        :aria-label="t('browser.tabs')"
        style="-webkit-app-region: no-drag"
      >
        <div
          v-for="(tab, index) in state?.tabs ?? []"
          :key="tab.id"
          class="flex min-w-32 max-w-56 items-center rounded-t-lg"
          :style="{ background: tab.id === state?.activeTabId ? 'var(--tx-bg-color)' : undefined }"
          @contextmenu="openTabMenu(tab.id, $event)"
        >
          <button
            :id="`browser-tab-${tab.id}`"
            type="button"
            role="tab"
            :aria-selected="tab.id === state?.activeTabId"
            :tabindex="tab.id === state?.activeTabId ? 0 : -1"
            aria-controls="browser-viewport"
            aria-haspopup="menu"
            :aria-expanded="tabMenuOpen && tabMenuTargetId === tab.id"
            class="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-t-lg px-3 text-sm outline-offset-[-3px]"
            :title="tab.url || t('browser.newTab')"
            @click="command(() => sdk.activateTab(tab.id))"
            @keydown="tabKeydown($event, index)"
          >
            <span
              class="inline-flex h-4 w-4 flex-none"
              :class="tab.loading ? 'i-ri-loader-4-line' : localIcon(tab.url)"
              aria-hidden="true"
            />
            <span class="truncate">{{ tab.url ? tab.title || tab.url : t('browser.newTab') }}</span>
          </button>
          <TxIconButton
            icon="i-ri-close-line"
            size="xs"
            :label="t('browser.closeTab', { title: tab.title || t('browser.newTab') })"
            @click="command(() => sdk.closeTab(tab.id))"
          />
        </div>
        <TxSkeleton v-if="connecting && !state" :width="150" :height="30" :radius="8" />
        <TxIconButton
          icon="i-ri-add-line"
          size="sm"
          :label="t('browser.addTab')"
          :disabled="!state"
          class="flex-none"
          @click="command(() => sdk.createTab())"
        />
      </div>
      <TxButton
        icon="i-ri-add-line"
        variant="ghost"
        size="sm"
        class="flex-none"
        style="-webkit-app-region: no-drag"
        @click="enterConversation(null)"
      >
        {{ t('shell.newChat') }}
        <MetaHintBadge command="new-chat" />
      </TxButton>
    </div>

    <div
      class="flex h-14 flex-none items-center gap-1 border-b border-[var(--tx-border-color-light)] px-3"
    >
      <TxIconButton
        icon="i-ri-arrow-left-line"
        :label="t('browser.back')"
        :disabled="!activeTab?.canGoBack"
        @click="runActive('back')"
      />
      <TxIconButton
        icon="i-ri-arrow-right-line"
        :label="t('browser.forward')"
        :disabled="!activeTab?.canGoForward"
        @click="runActive('forward')"
      />
      <TxIconButton
        :icon="activeTab?.loading ? 'i-ri-close-line' : 'i-ri-refresh-line'"
        :label="t(activeTab?.loading ? 'browser.stop' : 'browser.reload')"
        :disabled="!activeTab?.url"
        @click="runActive('refresh')"
      />
      <label
        class="mx-2 flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl bg-[var(--tx-fill-color-light)] px-3 focus-within:ring-2 focus-within:ring-[var(--tx-color-primary)]"
      >
        <span class="i-ri-global-line inline-flex h-4 w-4 flex-none" aria-hidden="true" />
        <input
          ref="addressInput"
          v-model="address"
          :aria-label="t('browser.address')"
          :placeholder="t('browser.addressPlaceholder')"
          :disabled="!activeTab"
          spellcheck="false"
          autocomplete="off"
          class="h-full w-full min-w-0 border-0 bg-transparent text-sm text-[var(--tx-text-color-primary)] outline-none placeholder:text-[var(--tx-text-color-regular)]"
          @focus="onAddressFocus"
          @blur="addressFocused = false"
          @keydown="navigateAddress"
        />
      </label>
      <TxIconButton
        :icon="bookmarked ? 'i-ri-star-fill' : 'i-ri-star-line'"
        :label="t(bookmarked ? 'browser.removeBookmark' : 'browser.addBookmark')"
        :pressed="bookmarked"
        :disabled="!activeTab?.url"
        @click="runActive('bookmark')"
      />
      <TxIconButton
        icon="i-ri-layout-right-line"
        :label="t('browser.library')"
        :pressed="Boolean(panel)"
        @click="panel = panel ? null : 'history'"
      />
    </div>

    <div
      v-if="error"
      role="alert"
      class="flex flex-none items-center gap-3 bg-[var(--tx-color-danger-light-9)] px-5 py-3 text-sm"
    >
      <span class="min-w-0 flex-1 break-words">{{ t('browser.actionFailed') }} {{ error }}</span>
      <TxButton size="sm" variant="ghost" @click="retry">{{ t('browser.retry') }}</TxButton>
    </div>

    <div
      id="browser-viewport"
      ref="viewport"
      role="tabpanel"
      :aria-labelledby="activeTab ? `browser-tab-${activeTab.id}` : undefined"
      :aria-busy="connecting || activeTab?.loading || undefined"
      class="relative min-h-0 min-w-0 flex-1 overflow-hidden"
    >
      <div
        v-if="connecting && !state"
        class="mx-auto flex h-full max-w-3xl flex-col items-center justify-center gap-7 px-8"
        :aria-label="t('browser.loading')"
      >
        <TxSkeleton :width="58" :height="58" :radius="29" />
        <TxSkeleton :width="280" :height="32" :radius="8" />
        <TxSkeleton width="100%" :height="130" :radius="16" />
      </div>
      <HomePage
        v-if="state"
        v-show="localPage && !panel"
        browser-landing
        :browser-active="onRoute && localPage && !panel"
        :browser-navigate="navigate"
        style="--home-chat-lane-width: min(920px, calc(100% - 64px))"
      >
        <template #browser-footer>
          <div
            class="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2"
            :aria-label="t('browser.shortcuts')"
          >
            <TxButton
              v-for="site in shortcuts"
              :key="site.url"
              variant="ghost"
              size="sm"
              :icon="site.icon"
              @click="navigate(site.url).catch(() => {})"
              >{{ site.title }}</TxButton
            >
          </div>
          <section class="mt-7 w-full" :aria-label="t('browser.recent')">
            <div class="mb-2 flex items-center justify-between">
              <h2 class="m-0 text-sm font-medium">{{ t('browser.recent') }}</h2>
              <TxButton
                v-if="state.recent.length"
                variant="ghost"
                size="sm"
                @click="panel = 'history'"
                >{{ t('browser.showAll') }}</TxButton
              >
            </div>
            <div
              class="grid grid-cols-1 gap-1 border-y border-[var(--tx-border-color-light)] py-2 md:grid-cols-2"
            >
              <p
                v-if="!state.recent.length"
                class="col-span-full m-0 py-3 text-xs text-[var(--tx-text-color-regular)]"
              >
                {{ t('browser.recentEmpty') }}
              </p>
              <button
                v-for="page in state.recent.slice(0, 4)"
                :key="page.url"
                type="button"
                class="flex min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-[var(--tx-fill-color-light)] focus-visible:outline-2 focus-visible:outline-[var(--tx-color-primary)]"
                :title="page.url"
                @click="openSaved(page)"
              >
                <span
                  class="inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-[var(--tx-fill-color-light)]"
                  ><span
                    class="inline-flex h-5 w-5"
                    :class="localIcon(page.url)"
                    aria-hidden="true"
                /></span>
                <span class="min-w-0 flex-1"
                  ><span class="block truncate text-sm">{{ page.title || page.url }}</span
                  ><span class="block text-xs text-[var(--tx-text-color-regular)]">{{
                    dateLabel(page)
                  }}</span></span
                >
              </button>
            </div>
          </section>
        </template>
      </HomePage>
      <section
        v-if="panel"
        class="absolute inset-0 overflow-y-auto bg-[var(--tx-bg-color)] px-6 py-5"
        :aria-label="t(panel === 'history' ? 'browser.history' : 'browser.bookmarks')"
      >
        <div class="mx-auto max-w-3xl">
          <div class="mb-5 flex items-center justify-between gap-3">
            <div class="flex gap-2">
              <TxButton
                :variant="panel === 'history' ? 'flat' : 'ghost'"
                :aria-pressed="panel === 'history'"
                icon="i-ri-history-line"
                @click="panel = 'history'"
                >{{ t('browser.history') }}</TxButton
              >
              <TxButton
                :variant="panel === 'bookmarks' ? 'flat' : 'ghost'"
                :aria-pressed="panel === 'bookmarks'"
                icon="i-ri-star-line"
                @click="panel = 'bookmarks'"
                >{{ t('browser.bookmarks') }}</TxButton
              >
            </div>
            <TxIconButton
              icon="i-ri-close-line"
              :label="t('browser.closeLibrary')"
              @click="panel = null"
            />
          </div>
          <p
            v-if="!savedPages.length"
            class="py-8 text-center text-sm text-[var(--tx-text-color-regular)]"
          >
            {{ t(panel === 'bookmarks' ? 'browser.bookmarksEmpty' : 'browser.recentEmpty') }}
          </p>
          <button
            v-for="page in savedPages"
            :key="page.url"
            type="button"
            class="mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-[var(--tx-fill-color-light)] focus-visible:outline-2 focus-visible:outline-[var(--tx-color-primary)]"
            @click="openSaved(page)"
          >
            <span
              class="inline-flex h-5 w-5 flex-none"
              :class="localIcon(page.url)"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1"
              ><span class="block truncate text-sm">{{ page.title || page.url }}</span
              ><span class="block truncate text-xs text-[var(--tx-text-color-regular)]">{{
                page.url
              }}</span></span
            >
            <span class="flex-none text-xs text-[var(--tx-text-color-regular)]">{{
              dateLabel(page)
            }}</span>
          </button>
        </div>
      </section>
      <div
        v-else-if="activeTab?.error"
        role="alert"
        class="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[var(--tx-bg-color)] px-8 text-center"
      >
        <span class="i-ri-error-warning-line inline-flex h-8 w-8" aria-hidden="true" />
        <h1 class="m-0 text-xl font-semibold">{{ t('browser.pageFailed') }}</h1>
        <p class="m-0 max-w-lg break-words text-sm text-[var(--tx-text-color-regular)]">
          {{ activeTab.error }}
        </p>
        <TxButton icon="i-ri-refresh-line" @click="runActive('reload')">{{
          t('browser.retry')
        }}</TxButton>
      </div>
      <div
        v-else-if="activeTab?.loading && !localPage"
        role="status"
        class="pointer-events-none absolute inset-x-0 top-0"
      >
        <span class="sr-only">{{ t('browser.loading') }}</span>
        <TxSkeleton width="100%" :height="3" :radius="0" />
      </div>
    </div>
    <TxContextMenu
      ref="tabMenu"
      v-model="tabMenuOpen"
      trigger="manual"
      :activation-feedback="false"
    >
      <template #menu>
        <TxContextMenuItem :disabled="!tabMenuTarget?.url" @select="selectTabMenuAction('reload')">
          {{ t('browser.tabMenu.reload') }}
        </TxContextMenuItem>
        <TxContextMenuItem :disabled="!tabMenuTarget" @select="selectTabMenuAction('duplicate')">
          {{ t('browser.tabMenu.duplicate') }}
        </TxContextMenuItem>
        <TxContextMenuDivider />
        <TxContextMenuItem :disabled="!tabMenuTarget" @select="selectTabMenuAction('close')">
          {{ t('browser.tabMenu.close') }}
        </TxContextMenuItem>
        <TxContextMenuItem
          :disabled="!tabMenuTarget || (state?.tabs.length ?? 0) < 2"
          @select="selectTabMenuAction('close-others')"
        >
          {{ t('browser.tabMenu.closeOthers') }}
        </TxContextMenuItem>
        <TxContextMenuItem
          :disabled="tabMenuIndex <= 0"
          @select="selectTabMenuAction('close-left')"
        >
          {{ t('browser.tabMenu.closeLeft') }}
        </TxContextMenuItem>
        <TxContextMenuItem
          :disabled="!tabMenuTarget || tabMenuIndex >= (state?.tabs.length ?? 0) - 1"
          @select="selectTabMenuAction('close-right')"
        >
          {{ t('browser.tabMenu.closeRight') }}
        </TxContextMenuItem>
      </template>
    </TxContextMenu>
  </section>
</template>
