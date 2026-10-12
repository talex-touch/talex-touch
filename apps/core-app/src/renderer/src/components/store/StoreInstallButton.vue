<script setup lang="ts" name="StoreInstallButton">
/**
 * StoreInstallButton - Reusable plugin installation button component
 *
 * Displays different states based on installation progress and whether
 * the plugin is already installed locally.
 *
 * @example
 * ```vue
 * <StoreInstallButton
 *   :plugin-name="plugin.name"
 *   :is-installed="isInstalled"
 *   :install-task="installTask"
 *   @install="handleInstall"
 * />
 * ```
 */
import type { PluginInstallProgressEvent } from '@talex-touch/utils/plugin'
import { TxButton } from '@talex-touch/tuffex/button'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

interface Props {
  /** Name of the plugin (used for display/tracking) */
  pluginName?: string
  /** Whether the plugin is already installed locally */
  isInstalled?: boolean
  /** Whether a newer version is available */
  hasUpgrade?: boolean
  /** Currently installed version */
  installedVersion?: string
  /** Store version available */
  storeVersion?: string
  /** Current installation task progress (if any) */
  installTask?: PluginInstallProgressEvent | null
  /** Whether to show in mini mode (smaller button) */
  mini?: boolean
  /** Whether the catalog manifest SDK can run on this host version */
  isCompatible?: boolean
  /** Whether this privileged plugin can only be updated with the client. */
  isBundledManaged?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  pluginName: '',
  isInstalled: false,
  hasUpgrade: false,
  installedVersion: '',
  storeVersion: '',
  installTask: null,
  mini: true,
  isCompatible: true,
  isBundledManaged: false
})

const emit = defineEmits<{
  /** Emitted when user clicks install button */
  (e: 'install'): void
}>()

const { t } = useI18n()

/** Set of stages that indicate active installation */
const ACTIVE_STAGES = new Set<PluginInstallProgressEvent['stage']>([
  'queued',
  'downloading',
  'verifying',
  'awaiting-confirmation',
  'installing'
])

/** Current installation stage from task */
const installStage = computed<PluginInstallProgressEvent['stage'] | null>(() => {
  return props.installTask?.stage ?? null
})

/** Whether installation is currently in progress */
const isActiveStage = computed(() =>
  installStage.value ? ACTIVE_STAGES.has(installStage.value) : false
)

/** Download progress percentage (0-100) */
const progressValue = computed(() => {
  if (typeof props.installTask?.progress === 'number') {
    return Math.max(0, Math.min(100, Math.round(props.installTask.progress)))
  }
  return null
})

/** Progress value rendered by TxButton's full-width background layer */
const buttonProgress = computed(() => {
  if (
    (installStage.value === 'downloading' || installStage.value === 'verifying') &&
    progressValue.value !== null
  ) {
    return progressValue.value
  }
  return undefined
})

/** Result state rendered by TxButton after the task leaves the active stages */
const buttonStatus = computed<'' | 'success' | 'warning' | 'error'>(() => {
  switch (installStage.value) {
    case 'completed':
      return 'success'
    case 'failed':
      return 'error'
    case 'cancelled':
      return 'warning'
    default:
      return ''
  }
})

/** Whether to show spinning loader */
const showSpinner = computed(() => installStage.value === 'installing')

/** Button icon based on current state */
const buttonIcon = computed(() => {
  if (props.isBundledManaged) return 'i-ri-shield-check-line'
  if (!props.isCompatible && !installStage.value) {
    return 'i-ri-error-warning-line'
  }
  // Has upgrade available - show upload/upgrade icon
  if (props.isInstalled && props.hasUpgrade && !installStage.value) {
    return 'i-ri-arrow-up-circle-line'
  }

  // Already installed and up to date - show double checkmark
  if (props.isInstalled && !installStage.value) {
    return 'i-ri-check-double-line'
  }

  switch (installStage.value) {
    case 'queued':
      return 'i-ri-time-line'
    case 'verifying':
      return 'i-ri-shield-check-line'
    case 'awaiting-confirmation':
      return 'i-ri-shield-keyhole-line'
    default:
      return 'i-ri-download-line'
  }
})

/** Button label text based on current state */
const buttonLabel = computed(() => {
  if (props.isBundledManaged) return t('store.clientManaged')
  if (!props.isCompatible && !installStage.value) {
    return t('store.incompatible')
  }
  // Has upgrade available
  if (props.isInstalled && props.hasUpgrade && !installStage.value) {
    return t('store.upgrade')
  }

  // Already installed and up to date
  if (props.isInstalled && !installStage.value) {
    return t('store.installed')
  }

  switch (installStage.value) {
    case 'queued':
      return t('store.installation.status.queued')
    case 'downloading':
      return t('store.installation.status.downloading')
    case 'verifying':
      return t('store.installation.status.verifying')
    case 'awaiting-confirmation':
      return t('store.installation.status.awaitingConfirm')
    case 'installing':
      return t('store.installation.status.installing')
    case 'completed':
      return t('store.installation.status.completed')
    case 'failed':
      return t('store.installation.status.failed')
    case 'cancelled':
      return t('store.installation.status.cancelled')
    default:
      return t('store.install')
  }
})

/** Whether install button should be disabled */
const isDisabled = computed(() => {
  if (props.isBundledManaged) return true
  if (!props.isCompatible) return true
  // Disabled during active installation
  if (isActiveStage.value) return true
  // Disabled if installed AND no upgrade available
  if (props.isInstalled && !props.hasUpgrade) return true
  return false
})

/**
 * Handles install button click
 */
function handleClick(event: MouseEvent): void {
  event.stopPropagation()
  if (!isDisabled.value) {
    emit('install')
  }
}
</script>

<template>
  <TxButton
    variant="flat"
    :type="
      !isBundledManaged && isCompatible && (!isInstalled || hasUpgrade) ? 'primary' : undefined
    "
    :size="mini ? 'sm' : undefined"
    :title="
      isBundledManaged
        ? t('store.clientManagedHint')
        : !isCompatible
          ? t('store.incompatible')
          : undefined
    "
    :disabled="isDisabled"
    :loading="showSpinner"
    :progress="buttonProgress"
    :status="buttonStatus"
    :icon="buttonStatus ? undefined : buttonIcon"
    :class="{
      'upgrade-available':
        !isBundledManaged && isCompatible && hasUpgrade && isInstalled && !isActiveStage
    }"
    @click="handleClick"
  >
    <span>{{ buttonLabel }}</span>
  </TxButton>
</template>
