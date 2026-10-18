<script setup lang="ts">
import type { BrowserConnectedProfile } from '@talex-touch/utils/transport/sdk/domains/browser-connection'
import { TxButton } from '@talex-touch/tuffex/button'
import { TxSkeleton } from '@talex-touch/tuffex/skeleton'
import { TxStatusBadge } from '@talex-touch/tuffex/status-badge'
import { useTuffTransport } from '@talex-touch/utils/transport'
import { ClipboardEvents } from '@talex-touch/utils/transport/events'
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import {
  browserProfileStatus,
  useBrowserConnection
} from '~/modules/browser-connection/useBrowserConnection'

/**
 * Chrome connection management behind the shell avatar: installing the connector, pairing a
 * profile with a one-use code, and per-profile select / pause / refresh / revoke plus conflict
 * resolution. Every control waits for Main's resulting state; nothing here shows success first.
 */
const props = defineProps<{ active: boolean }>()
defineEmits<{ back: [] }>()

const { t, locale } = useI18n()
const transport = useTuffTransport()
const { sdk, state, loading, loadError, busy, load, run, describeError } = useBrowserConnection()
const headingId = useId()
const error = ref('')
const confirmRevokeId = ref<string | null>(null)
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | null = null

const installation = computed(() => state.value?.installation)
const pairing = computed(() => state.value?.pairing ?? null)
const pairingRemaining = computed(() =>
  pairing.value ? Math.max(0, Math.ceil((pairing.value.expiresAt - now.value) / 1000)) : 0
)
const pairingCountdown = computed(() => {
  const seconds = pairingRemaining.value
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
})

async function execute(key: string, action: Parameters<typeof run>[1]): Promise<boolean> {
  error.value = ''
  const failure = await run(key, action)
  if (failure) error.value = describeError(failure)
  return !failure
}

function formatTime(value: number | null): string {
  return value === null
    ? ''
    : new Date(value).toLocaleString(locale.value, { dateStyle: 'short', timeStyle: 'short' })
}

async function copyPairingCode(): Promise<void> {
  const code = pairing.value?.code
  if (!code) return
  try {
    await transport.send(ClipboardEvents.write, { type: 'text', value: code })
    toast.success(t('browserConnection.pairing.copied'))
  } catch {
    toast.error(t('browserConnection.pairing.copyFailed'))
  }
}

async function revoke(profile: BrowserConnectedProfile): Promise<void> {
  if (await execute(`disconnect:${profile.id}`, () => sdk.disconnect(profile.id)))
    confirmRevokeId.value = null
}

// The countdown only ticks while a code is on screen in a visible panel.
watch(
  () => Boolean(props.active && pairing.value),
  (ticking) => {
    if (clock) clearInterval(clock)
    clock = null
    now.value = Date.now()
    if (ticking) clock = setInterval(() => (now.value = Date.now()), 1000)
  },
  { immediate: true }
)
watch(
  () => props.active,
  (active) => {
    if (!active) confirmRevokeId.value = null
  }
)
onBeforeUnmount(() => {
  if (clock) clearInterval(clock)
})
</script>

<template>
  <section class="min-w-0" :aria-labelledby="headingId">
    <div class="flex items-center gap-1.5 pb-2">
      <TxButton
        variant="ghost"
        size="sm"
        icon="i-ri-arrow-left-line"
        :aria-label="t('browserConnection.back')"
        @click="$emit('back')"
      />
      <h3 :id="headingId" class="m-0 min-w-0 flex-1 truncate text-[13px] font-semibold">
        {{ t('browserConnection.title') }}
      </h3>
    </div>

    <p
      v-if="error"
      role="alert"
      class="mx-1.5 mb-2 mt-0 break-words text-xs text-[var(--tx-color-danger)]"
    >
      {{ error }}
    </p>

    <div
      v-if="!state && loading"
      class="flex flex-col gap-2 px-1.5"
      :aria-label="t('browserConnection.loading')"
      aria-busy="true"
    >
      <TxSkeleton width="70%" :height="14" :radius="6" />
      <TxSkeleton width="100%" :height="44" :radius="10" />
      <TxSkeleton width="100%" :height="64" :radius="10" />
    </div>
    <div v-else-if="!state" role="alert" class="flex flex-col items-start gap-2 px-1.5">
      <p class="m-0 text-xs leading-normal text-[var(--tx-text-color-secondary)]">
        {{ t('browserConnection.loadFailed') }}
        {{ describeError(loadError) }}
      </p>
      <TxButton variant="flat" size="sm" icon="i-ri-refresh-line" @click="load">
        {{ t('browserConnection.retry') }}
      </TxButton>
    </div>

    <div v-else class="flex max-h-[400px] flex-col gap-3 overflow-y-auto px-1.5">
      <section class="flex flex-col gap-2">
        <h4 class="m-0 text-xs font-medium text-[var(--tx-text-color-secondary)]">
          {{ t('browserConnection.connector.title') }}
        </h4>
        <p
          v-if="!installation?.supported"
          role="status"
          class="m-0 text-xs leading-normal text-[var(--tx-text-color-secondary)]"
        >
          {{ t('browserConnection.connector.unsupported') }}
        </p>
        <template v-else-if="!installation.installed">
          <p class="m-0 text-xs leading-normal text-[var(--tx-text-color-secondary)]">
            {{ t('browserConnection.connector.installHint') }}
          </p>
          <TxButton
            variant="flat"
            size="sm"
            icon="i-ri-download-2-line"
            :loading="busy.has('install')"
            :disabled="busy.has('install')"
            @click="execute('install', () => sdk.install())"
          >
            {{ t('browserConnection.connector.install') }}
          </TxButton>
        </template>
        <template v-else>
          <TxStatusBadge
            :text="t('browserConnection.connector.installed')"
            status="success"
            size="sm"
          />
          <p
            v-if="installation.extensionDirectory"
            class="m-0 truncate font-mono text-[11px] text-[var(--tx-text-color-secondary)]"
            :title="installation.extensionDirectory"
          >
            {{ installation.extensionDirectory }}
          </p>
          <ol
            class="m-0 flex flex-col gap-1 pl-4 text-xs leading-normal text-[var(--tx-text-color-secondary)]"
          >
            <li>{{ t('browserConnection.connector.stepOpen') }}</li>
            <li>{{ t('browserConnection.connector.stepDeveloper') }}</li>
            <li>{{ t('browserConnection.connector.stepLoad') }}</li>
          </ol>
          <div class="flex flex-wrap gap-1">
            <TxButton
              variant="ghost"
              size="sm"
              icon="i-ri-folder-open-line"
              :disabled="!installation.extensionDirectory || busy.has('reveal')"
              @click="execute('reveal', () => sdk.revealExtension())"
            >
              {{ t('browserConnection.connector.reveal') }}
            </TxButton>
            <TxButton
              variant="ghost"
              size="sm"
              icon="i-ri-tools-line"
              :loading="busy.has('install')"
              :disabled="busy.has('install')"
              @click="execute('install', () => sdk.install())"
            >
              {{ t('browserConnection.connector.repair') }}
            </TxButton>
          </div>
        </template>
      </section>

      <section
        v-if="installation?.supported"
        class="flex flex-col gap-2 border-t border-[var(--tx-border-color-light)] pt-3"
      >
        <h4 class="m-0 text-xs font-medium text-[var(--tx-text-color-secondary)]">
          {{ t('browserConnection.pairing.title') }}
        </h4>
        <template v-if="pairing && pairingRemaining > 0">
          <output
            class="select-all font-mono text-2xl font-semibold tracking-[0.3em]"
            :aria-label="t('browserConnection.pairing.codeLabel', { code: pairing.code })"
            >{{ pairing.code }}</output
          >
          <p class="m-0 text-xs leading-normal text-[var(--tx-text-color-secondary)]">
            {{ t('browserConnection.pairing.instructions') }}
          </p>
          <p class="m-0 text-xs text-[var(--tx-text-color-secondary)]" role="timer">
            {{ t('browserConnection.pairing.expiresIn', { time: pairingCountdown }) }}
          </p>
          <div class="flex flex-wrap gap-1">
            <TxButton variant="ghost" size="sm" icon="i-ri-file-copy-line" @click="copyPairingCode">
              {{ t('browserConnection.pairing.copy') }}
            </TxButton>
            <TxButton
              variant="ghost"
              size="sm"
              icon="i-ri-close-circle-line"
              :disabled="busy.has('pairing')"
              @click="execute('pairing', () => sdk.cancelPairing())"
            >
              {{ t('browserConnection.pairing.cancel') }}
            </TxButton>
          </div>
        </template>
        <template v-else>
          <p class="m-0 text-xs leading-normal text-[var(--tx-text-color-secondary)]">
            {{
              t(
                pairing
                  ? 'browserConnection.pairing.expired'
                  : installation.installed
                    ? 'browserConnection.pairing.hint'
                    : 'browserConnection.pairing.installFirst'
              )
            }}
          </p>
          <TxButton
            variant="flat"
            size="sm"
            icon="i-ri-link"
            :loading="busy.has('pairing')"
            :disabled="!installation.installed || busy.has('pairing')"
            @click="execute('pairing', () => sdk.beginPairing())"
          >
            {{ t(pairing ? 'browserConnection.pairing.renew' : 'browserConnection.pairing.begin') }}
          </TxButton>
        </template>
      </section>

      <section class="flex flex-col gap-2 border-t border-[var(--tx-border-color-light)] pt-3">
        <h4 class="m-0 text-xs font-medium text-[var(--tx-text-color-secondary)]">
          {{ t('browserConnection.profiles.title') }}
        </h4>
        <p
          v-if="!state.profiles.length"
          class="m-0 text-xs leading-normal text-[var(--tx-text-color-secondary)]"
        >
          {{ t('browserConnection.profiles.empty') }}
        </p>
        <article
          v-for="profile in state.profiles"
          :key="profile.id"
          class="flex flex-col gap-2 rounded-xl border border-[var(--tx-border-color-light)] p-2.5"
          :aria-label="profile.label"
        >
          <div class="flex items-center gap-2">
            <span class="i-ri-chrome-line inline-flex h-4 w-4 flex-none" aria-hidden="true" />
            <strong class="min-w-0 flex-1 truncate text-[13px] font-medium">{{
              profile.label
            }}</strong>
            <TxStatusBadge
              :text="t(browserProfileStatus(profile).label)"
              :status="browserProfileStatus(profile).tone"
              size="sm"
            />
          </div>
          <p class="m-0 text-[11px] leading-normal text-[var(--tx-text-color-secondary)]">
            {{
              profile.lastSeenAt === null
                ? t('browserConnection.profiles.neverSeen')
                : t('browserConnection.profiles.lastSeen', { time: formatTime(profile.lastSeenAt) })
            }}
            ·
            {{
              profile.lastSyncedAt === null
                ? t('browserConnection.profiles.neverSynced')
                : t('browserConnection.profiles.lastSynced', {
                    time: formatTime(profile.lastSyncedAt)
                  })
            }}
          </p>
          <p
            v-if="profile.pendingCount"
            role="status"
            class="m-0 text-xs text-[var(--tx-color-warning)]"
          >
            {{ t('browserConnection.profiles.pending', { count: profile.pendingCount }) }}
          </p>
          <p
            v-if="profile.error"
            role="alert"
            class="m-0 break-words text-xs text-[var(--tx-color-danger)]"
          >
            {{ describeError(profile.error) }}
          </p>

          <ul v-if="profile.conflicts.length" class="m-0 flex list-none flex-col gap-2 p-0">
            <li
              v-for="conflict in profile.conflicts"
              :key="conflict.operationId"
              class="flex flex-col gap-1.5 rounded-lg bg-[var(--tx-fill-color-light)] p-2"
            >
              <span class="text-xs font-medium">{{
                t('browserConnection.conflicts.item', { title: conflict.title })
              }}</span>
              <span class="break-words text-[11px] text-[var(--tx-text-color-secondary)]">{{
                describeError(conflict.reason)
              }}</span>
              <div class="flex flex-wrap gap-1">
                <TxButton
                  variant="ghost"
                  size="sm"
                  :disabled="busy.has(`conflict:${conflict.operationId}`)"
                  @click="
                    execute(`conflict:${conflict.operationId}`, () =>
                      sdk.resolveConflict(profile.id, conflict.operationId, 'useChrome')
                    )
                  "
                >
                  {{ t('browserConnection.conflicts.useChrome') }}
                </TxButton>
                <TxButton
                  variant="ghost"
                  size="sm"
                  :disabled="busy.has(`conflict:${conflict.operationId}`)"
                  @click="
                    execute(`conflict:${conflict.operationId}`, () =>
                      sdk.resolveConflict(profile.id, conflict.operationId, 'retryTuff')
                    )
                  "
                >
                  {{ t('browserConnection.conflicts.retryTuff') }}
                </TxButton>
              </div>
            </li>
          </ul>

          <div
            v-if="confirmRevokeId === profile.id"
            role="group"
            :aria-label="t('browserConnection.profiles.revokeTitle', { name: profile.label })"
            class="flex flex-col gap-2 rounded-lg bg-[var(--tx-fill-color-light)] p-2"
          >
            <p class="m-0 text-xs leading-normal">
              {{ t('browserConnection.profiles.revokeConfirm', { name: profile.label }) }}
            </p>
            <div class="flex flex-wrap gap-1">
              <TxButton
                variant="danger"
                size="sm"
                :loading="busy.has(`disconnect:${profile.id}`)"
                :disabled="busy.has(`disconnect:${profile.id}`)"
                @click="revoke(profile)"
              >
                {{ t('browserConnection.profiles.revokeAction') }}
              </TxButton>
              <TxButton variant="ghost" size="sm" @click="confirmRevokeId = null">
                {{ t('browserConnection.profiles.keep') }}
              </TxButton>
            </div>
          </div>
          <div v-else class="flex flex-wrap gap-1">
            <TxButton
              variant="ghost"
              size="sm"
              :icon="
                state.activeProfileId === profile.id
                  ? 'i-ri-checkbox-circle-fill'
                  : 'i-ri-checkbox-blank-circle-line'
              "
              :aria-pressed="state.activeProfileId === profile.id"
              :disabled="busy.has('select')"
              @click="
                execute('select', () =>
                  sdk.selectProfile(state?.activeProfileId === profile.id ? null : profile.id)
                )
              "
            >
              {{
                t(
                  state.activeProfileId === profile.id
                    ? 'browserConnection.profiles.deselect'
                    : 'browserConnection.profiles.select'
                )
              }}
            </TxButton>
            <TxButton
              variant="ghost"
              size="sm"
              :icon="profile.status === 'paused' ? 'i-ri-play-line' : 'i-ri-pause-line'"
              :disabled="busy.has(`pause:${profile.id}`)"
              @click="
                execute(`pause:${profile.id}`, () =>
                  sdk.setPaused(profile.id, profile.status !== 'paused')
                )
              "
            >
              {{
                t(
                  profile.status === 'paused'
                    ? 'browserConnection.profiles.resume'
                    : 'browserConnection.profiles.pause'
                )
              }}
            </TxButton>
            <TxButton
              variant="ghost"
              size="sm"
              icon="i-ri-refresh-line"
              :title="
                profile.status === 'connected'
                  ? undefined
                  : t('browserConnection.profiles.refreshOffline')
              "
              :disabled="profile.status !== 'connected' || busy.has(`refresh:${profile.id}`)"
              @click="execute(`refresh:${profile.id}`, () => sdk.refresh(profile.id))"
            >
              {{ t('browserConnection.profiles.refresh') }}
            </TxButton>
            <TxButton
              variant="ghost"
              size="sm"
              icon="i-ri-link-unlink"
              @click="confirmRevokeId = profile.id"
            >
              {{ t('browserConnection.profiles.revoke') }}
            </TxButton>
          </div>
        </article>
      </section>
    </div>
  </section>
</template>
