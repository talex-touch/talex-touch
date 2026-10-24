import type {
  AccountSessionState,
  FeatureFlag,
  Subscription,
  SubscriptionPlan,
  Team,
  UsageStats,
  UserProfile,
} from '../../account/types'
import type { StreamController } from '../../transport/types'
import type { PluginChannelClient } from './channel-client'
import { AccountEvents } from '../../transport/events'
import { createPluginTuffTransport } from '../../transport/sdk/plugin-transport'
import { ensureRendererChannel } from './channel'

/**
 * The account calls a plugin view can make. The credential, the device id, sync bookkeeping,
 * signing out and the list of signed-in devices stay with the host.
 *
 * Failures reject rather than read as signed out, so a plugin that cannot reach the host does not
 * mistake it for a sign-out.
 */
export interface PluginAccountSDK {
  /** The signed-in account's profile, or null when signed out. */
  getProfile: () => Promise<UserProfile | null>
  getSubscription: () => Promise<Subscription | null>
  getUsage: () => Promise<UsageStats | null>
  getFeatures: () => Promise<FeatureFlag[]>
  getTeams: () => Promise<Team[]>
  /** Opens the upgrade page in the browser. */
  openUpgradePage: (plan?: SubscriptionPlan) => Promise<void>
  openBillingPage: () => Promise<void>
  openAccountSettings: () => Promise<void>
  openProfileEditor: () => Promise<void>
  /**
   * Opens the sign-in page. Resolves true once the page is open, before anyone signs in; the
   * sign-in itself arrives through `onDidChange`.
   */
  requestLogin: () => Promise<boolean>
  /**
   * Calls `callback` with the current session, then after every change. Returns a function that
   * stops it.
   */
  onDidChange: (callback: (session: AccountSessionState) => void) => () => void
}

export function createPluginAccountSDK(channel: PluginChannelClient): PluginAccountSDK {
  const transport = createPluginTuffTransport(channel)

  return {
    getProfile: () => transport.send(AccountEvents.account.getProfile),
    getSubscription: () => transport.send(AccountEvents.account.getSubscription),
    getUsage: () => transport.send(AccountEvents.account.getUsage),
    getFeatures: () => transport.send(AccountEvents.account.getFeatures),
    getTeams: () => transport.send(AccountEvents.account.getTeams),
    openUpgradePage: plan => transport.send(AccountEvents.account.openUpgrade, { plan }),
    openBillingPage: () => transport.send(AccountEvents.account.openBilling),
    openAccountSettings: () => transport.send(AccountEvents.account.openSettings),
    openProfileEditor: () => transport.send(AccountEvents.account.openProfile),
    requestLogin: () => transport.send(AccountEvents.account.requestLogin),

    onDidChange(callback) {
      let controller: StreamController | null = null
      let stopped = false

      transport
        .stream(AccountEvents.session.changed, undefined, {
          onData(session) {
            if (!stopped)
              callback(session)
          },
          onError(error) {
            if (!stopped)
              console.warn('[Plugin SDK] Account session stream error', error)
          },
        })
        .then((started) => {
          if (stopped)
            started.cancel()
          else
            controller = started
        })
        .catch((error) => {
          if (!stopped)
            console.warn('[Plugin SDK] Failed to subscribe to account changes', error)
        })

      return () => {
        stopped = true
        controller?.cancel()
      }
    },
  }
}

export function usePluginAccount(): PluginAccountSDK {
  return createPluginAccountSDK(
    ensureRendererChannel(
      '[PluginAccountSDK] Channel not available. Make sure this is called in a plugin renderer context.',
    ),
  )
}
