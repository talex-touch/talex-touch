<script setup lang="ts">
import type { IPluginFeature, ITouchPlugin } from '@talex-touch/utils/plugin'
import { TxButton } from '@talex-touch/tuffex/button'
import { TxIcon } from '@talex-touch/tuffex/icon'
import { TxPopover } from '@talex-touch/tuffex/popover'
import { PluginStatus } from '@talex-touch/utils'
import { appSettingOriginData } from '@talex-touch/utils/common/storage/entity/app-settings'
import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { normalizeCoreBoxIcon } from '~/components/render/icon-color-mode'
import { pluginSDK } from '~/modules/sdk/plugin-sdk'
import { appSetting } from '~/modules/storage/app-storage'
import { usePluginStore } from '~/stores/plugin'
import { focusWhenShown } from '../home/focus-when-shown'
import {
  assertBrowserFeatureTriggered,
  browserPluginFeatures,
  isBrowserPluginRunnable,
  normalizeBrowserPluginPins,
  resolveBrowserPinnedPlugins
} from './plugin-toolbar'

const props = defineProps<{ active: boolean }>()
const emit = defineEmits<{ 'overlay-change': [open: boolean] }>()
const { t } = useI18n()
const router = useRouter()
const pluginStore = usePluginStore()
const alive = ref(true)
const active = computed(() => props.active && alive.value)
const open = ref(false)
const selectedName = ref<string | null>(null)
const pending = ref(false)
const error = ref('')
const panel = ref<HTMLElement | null>(null)
let returnFocus: HTMLElement | null = null
let focusRun = 0

const visiblePlugins = computed(() =>
  Array.from(pluginStore.plugins.values()).filter(
    (plugin) => appSetting.dev?.developerMode || !plugin.meta?.internal
  )
)
const storedPins = computed(() => appSetting.shell?.browserPluginPins)
const pinnedPlugins = computed(() =>
  resolveBrowserPinnedPlugins(visiblePlugins.value, storedPins.value)
)
const pinnedNames = computed(() => new Set(pinnedPlugins.value.map((plugin) => plugin.name)))
const shortcuts = computed(() => pinnedPlugins.value.slice(0, 3))
const selectedPlugin = computed(() =>
  visiblePlugins.value.find((plugin) => plugin.name === selectedName.value)
)
const features = computed(() =>
  selectedPlugin.value ? browserPluginFeatures(selectedPlugin.value) : []
)
const hasRunnablePlugins = computed(() => visiblePlugins.value.some(isBrowserPluginRunnable))

function pluginLabel(plugin: ITouchPlugin): string {
  return plugin.displayName || plugin.name
}

function pluginStatus(plugin: ITouchPlugin): string {
  if (isBrowserPluginRunnable(plugin)) return ''
  if (plugin.status === PluginStatus.DISABLED) return t('browser.toolbar.disabled')
  if (
    plugin.status === PluginStatus.LOADING ||
    plugin.status === PluginStatus.DEV_RECONNECTING ||
    plugin.loadState === 'loading'
  )
    return t('browser.toolbar.loading')
  return t('browser.toolbar.unavailable')
}

function focusFirst(): void {
  const run = ++focusRun
  focusWhenShown(
    () => panel.value?.querySelector<HTMLButtonElement>('button:not(:disabled)'),
    () => run === focusRun && active.value && open.value
  )
}

function showPlugins(event: MouseEvent, plugin?: ITouchPlugin): void {
  if (!active.value) return
  returnFocus = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  const name = plugin?.name ?? null
  if (open.value && selectedName.value === name) {
    open.value = false
    return
  }
  selectedName.value = name
  open.value = true
  focusFirst()
}

function selectPlugin(plugin: ITouchPlugin): void {
  selectedName.value = plugin.name
  error.value = ''
  focusFirst()
}

function showAllPlugins(): void {
  selectedName.value = null
  error.value = ''
  focusFirst()
}

function togglePin(plugin: ITouchPlugin): void {
  if (!active.value) return
  // Materialize defaults on the first edit. Unpinning the last shortcut persists [] rather than
  // reverting to first-use suggestions, and hidden developer-only pins keep their preference.
  const names =
    normalizeBrowserPluginPins(storedPins.value) ?? pinnedPlugins.value.map((item) => item.name)
  const next = names.includes(plugin.name)
    ? names.filter((name) => name !== plugin.name)
    : [...names, plugin.name]
  if (!appSetting.shell || typeof appSetting.shell !== 'object') {
    appSetting.shell = { ...appSettingOriginData.shell, browserPluginPins: next }
  } else {
    appSetting.shell.browserPluginPins = next
  }
}

async function managePlugin(plugin?: ITouchPlugin): Promise<void> {
  if (!active.value) return
  open.value = false
  try {
    await router.push(plugin ? `/plugin/${encodeURIComponent(plugin.name)}` : '/plugin')
  } catch (failure) {
    toast.error(t('browser.toolbar.manageFailed'), {
      description: failure instanceof Error ? failure.message : String(failure)
    })
  }
}

async function runFeature(feature: IPluginFeature): Promise<void> {
  const plugin = selectedPlugin.value
  if (!active.value || pending.value || !plugin || !isBrowserPluginRunnable(plugin)) return
  // Re-read the live list so removal/status updates cannot execute an old cached feature button.
  if (!browserPluginFeatures(plugin).some((item) => item.id === feature.id)) return
  pending.value = true
  error.value = ''
  try {
    const result = await pluginSDK.triggerFeature({ plugin: plugin.name, feature: feature.id })
    assertBrowserFeatureTriggered(result, t('browser.toolbar.triggerRejected'))
    open.value = false
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure)
    toast.error(t('browser.toolbar.triggerFailed'), { description: error.value })
  } finally {
    pending.value = false
  }
}

function panelKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    open.value = false
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key)) return
  const buttons = Array.from(
    panel.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []
  )
  if (!buttons.length) return
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  let next = index
  if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = buttons.length - 1
  else if (event.key === 'ArrowDown') next = (index + 1) % buttons.length
  else if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length
  else if (event.shiftKey && index === 0) next = buttons.length - 1
  else if (!event.shiftKey && index === buttons.length - 1) next = 0
  else return
  event.preventDefault()
  buttons[next]?.focus()
}

function closeAll(): void {
  open.value = false
  selectedName.value = null
  emit('overlay-change', false)
}

// Synchronous notification hides the native guest before a teleported panel can become visible.
watch(
  open,
  (value) => {
    emit('overlay-change', active.value && value)
    if (!value) {
      focusRun += 1
      if (active.value && panel.value?.contains(document.activeElement)) returnFocus?.focus()
      selectedName.value = null
    }
  },
  { flush: 'sync' }
)
watch(
  active,
  (value) => {
    if (!value) closeAll()
  },
  { immediate: true, flush: 'sync' }
)
watch(selectedPlugin, (plugin) => {
  if (selectedName.value && !plugin) showAllPlugins()
})
onActivated(() => {
  alive.value = true
})
onDeactivated(() => {
  alive.value = false
  closeAll()
})
onBeforeUnmount(() => {
  alive.value = false
  closeAll()
  returnFocus = null
})
</script>

<template>
  <div
    class="BrowserPluginToolbar max-w-[136px] flex-none"
    style="-webkit-app-region: no-drag"
    :aria-label="t('browser.toolbar.label')"
    data-testid="browser-plugin-toolbar"
  >
    <TxPopover
      v-model="open"
      trigger="manual"
      placement="bottom-end"
      :disabled="!active"
      :width="320"
      :max-width="360"
      :max-height="480"
      :keep-alive-content="false"
      :animation="{ type: 'none', duration: 0, closeDuration: 0 }"
      panel-background="refraction"
      :panel-radius="12"
      :panel-padding="10"
    >
      <template #reference>
        <div class="flex items-center gap-0.5">
          <TxButton
            v-for="plugin in shortcuts"
            :key="plugin.name"
            variant="ghost"
            size="md"
            circle
            :class="{ 'opacity-55': !isBrowserPluginRunnable(plugin) }"
            :data-plugin-name="plugin.name"
            :disabled="!active"
            :aria-label="t('browser.toolbar.openPlugin', { name: pluginLabel(plugin) })"
            :title="[pluginLabel(plugin), pluginStatus(plugin)].filter(Boolean).join(' · ')"
            aria-haspopup="dialog"
            :aria-expanded="open && selectedName === plugin.name"
            @click="showPlugins($event, plugin)"
          >
            <TxIcon
              :icon="normalizeCoreBoxIcon(plugin.icon)"
              :size="18"
              :alt="pluginLabel(plugin)"
            />
          </TxButton>
          <TxButton
            variant="ghost"
            size="md"
            circle
            icon="i-ri-puzzle-line"
            :disabled="!active"
            :aria-label="t('browser.toolbar.label')"
            :title="t('browser.toolbar.label')"
            aria-haspopup="dialog"
            :aria-expanded="open && !selectedName"
            data-testid="browser-plugin-menu"
            @click="showPlugins($event)"
          />
        </div>
      </template>

      <div
        ref="panel"
        role="dialog"
        :aria-label="selectedPlugin ? pluginLabel(selectedPlugin) : t('browser.toolbar.label')"
        class="min-w-0 text-[var(--tx-text-color-primary)]"
        @keydown="panelKeydown"
      >
        <div class="flex items-center gap-1.5 pb-2">
          <TxButton
            v-if="selectedPlugin"
            variant="ghost"
            size="sm"
            icon="i-ri-arrow-left-line"
            :aria-label="t('browser.toolbar.back')"
            @click="showAllPlugins"
          />
          <strong class="min-w-0 flex-1 truncate text-[13px] font-semibold">{{
            selectedPlugin ? pluginLabel(selectedPlugin) : t('browser.toolbar.label')
          }}</strong>
          <TxButton
            variant="ghost"
            size="sm"
            icon="i-ri-close-line"
            :aria-label="t('browser.toolbar.close')"
            @click="open = false"
          />
        </div>

        <p
          v-if="error"
          class="mx-1.5 mb-2.5 mt-1 break-words text-xs text-[var(--tx-color-danger)]"
          role="alert"
        >
          {{ error }}
        </p>

        <template v-if="selectedPlugin">
          <p
            v-if="!isBrowserPluginRunnable(selectedPlugin)"
            class="mx-1.5 mb-3 mt-1 text-xs leading-normal text-[var(--tx-text-color-secondary)]"
            role="status"
          >
            {{ t('browser.toolbar.pluginUnavailable', { status: pluginStatus(selectedPlugin) }) }}
          </p>
          <p
            v-else-if="!features.length"
            class="mx-1.5 mb-3 mt-1 text-xs leading-normal text-[var(--tx-text-color-secondary)]"
          >
            {{ t('browser.toolbar.noFeatures') }}
          </p>
          <div v-if="features.length" class="flex max-h-[300px] flex-col gap-1 overflow-y-auto">
            <TxButton
              v-for="feature in features"
              :key="feature.id"
              variant="ghost"
              size="sm"
              block
              :disabled="!active || pending || !isBrowserPluginRunnable(selectedPlugin)"
              :title="feature.desc || feature.name"
              :data-feature-id="feature.id"
              @click="runFeature(feature)"
            >
              <span class="flex min-w-0 flex-1 items-center gap-2 text-left">
                <TxIcon
                  class="flex-none"
                  :icon="normalizeCoreBoxIcon(feature.icon || selectedPlugin.icon)"
                  :size="18"
                />
                <span class="min-w-0 flex-1 truncate">{{ feature.name || feature.id }}</span>
                <TxIcon
                  v-if="pending"
                  class="flex-none"
                  :icon="{ type: 'class', value: 'i-ri-loader-4-line', status: 'loading' }"
                  :size="14"
                />
              </span>
            </TxButton>
          </div>
          <div
            class="mt-2 flex flex-wrap justify-between gap-1 border-t border-[var(--tx-border-color-light)] pt-2"
          >
            <TxButton
              variant="ghost"
              size="sm"
              :icon="pinnedNames.has(selectedPlugin.name) ? 'i-ri-unpin-line' : 'i-ri-pushpin-line'"
              :aria-pressed="pinnedNames.has(selectedPlugin.name)"
              @click="togglePin(selectedPlugin)"
            >
              {{
                t(
                  pinnedNames.has(selectedPlugin.name)
                    ? 'browser.toolbar.unpin'
                    : 'browser.toolbar.pin'
                )
              }}
            </TxButton>
            <TxButton
              variant="ghost"
              size="sm"
              icon="i-ri-settings-3-line"
              @click="managePlugin(selectedPlugin)"
            >
              {{ t('browser.toolbar.managePlugin') }}
            </TxButton>
          </div>
        </template>
        <template v-else>
          <p
            v-if="!visiblePlugins.length"
            class="mx-1.5 mb-3 mt-1 text-xs leading-normal text-[var(--tx-text-color-secondary)]"
          >
            {{ t('browser.toolbar.empty') }}
          </p>
          <p
            v-else-if="!hasRunnablePlugins"
            class="mx-1.5 mb-3 mt-1 text-xs leading-normal text-[var(--tx-text-color-secondary)]"
          >
            {{ t('browser.toolbar.noneEnabled') }}
          </p>
          <div
            v-if="visiblePlugins.length"
            class="flex max-h-[300px] flex-col gap-1 overflow-y-auto"
          >
            <div
              v-for="plugin in visiblePlugins"
              :key="plugin.name"
              class="flex items-center gap-1"
            >
              <TxButton
                variant="ghost"
                size="md"
                class="min-w-0 flex-1"
                :data-plugin-name="plugin.name"
                :title="t('browser.toolbar.openPlugin', { name: pluginLabel(plugin) })"
                @click="selectPlugin(plugin)"
              >
                <span class="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <TxIcon
                    class="flex-none"
                    :icon="normalizeCoreBoxIcon(plugin.icon)"
                    :size="20"
                    :alt="pluginLabel(plugin)"
                  />
                  <span class="flex min-w-0 flex-1 items-center gap-2">
                    <span class="min-w-0 flex-1 truncate">{{ pluginLabel(plugin) }}</span>
                    <small
                      v-if="pluginStatus(plugin)"
                      class="flex-none text-xs text-[var(--tx-text-color-secondary)]"
                      >{{ pluginStatus(plugin) }}</small
                    >
                  </span>
                </span>
              </TxButton>
              <TxButton
                variant="ghost"
                size="sm"
                :icon="pinnedNames.has(plugin.name) ? 'i-ri-pushpin-fill' : 'i-ri-pushpin-line'"
                :aria-label="
                  t(
                    pinnedNames.has(plugin.name)
                      ? 'browser.toolbar.unpinNamed'
                      : 'browser.toolbar.pinNamed',
                    { name: pluginLabel(plugin) }
                  )
                "
                :title="
                  t(pinnedNames.has(plugin.name) ? 'browser.toolbar.unpin' : 'browser.toolbar.pin')
                "
                :aria-pressed="pinnedNames.has(plugin.name)"
                @click="togglePin(plugin)"
              />
            </div>
          </div>
          <div
            class="mt-2 flex flex-wrap justify-between gap-1 border-t border-[var(--tx-border-color-light)] pt-2"
          >
            <TxButton
              variant="ghost"
              size="sm"
              icon="i-ri-settings-3-line"
              block
              @click="managePlugin()"
            >
              {{ t('browser.toolbar.manage') }}
            </TxButton>
          </div>
        </template>
      </div>
    </TxPopover>
  </div>
</template>
