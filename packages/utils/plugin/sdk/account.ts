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
 * Every call needs the `account.read` permission. Without it, calls reject with
 * `ACCOUNT_PERMISSION_DENIED`, and `onDidChange` never calls back.
 *
 * Failures reject rather than read as signed out, so a plugin that cannot reach the host does not
 * mistake it for a sign-out.
 */
export interface PluginAccountSDK {
  /** The signed-in account's profile, or null when signed out. */
  getProfile: () => Promise<UserProfile | null>
  getSubscription: () => Promise<Subscription | null>
  getUsage: () => Promise<UsageStats | null>
  /**
   * The plan's features: `aiRequests` and `aiTokens` carry their limit in `value` (-1 for
   * unlimited); `customModels`, `prioritySupport` and `apiAccess` are on or off.
   */
  getFeatures: () => Promise<FeatureFlag[]>
  /** The organization the account belongs to, if any. The personal team is not listed. */
  getTeams: () => Promise<Team[]>
  /** Opens the pricing page in the browser, on `plan` when one is given. */
  openUpgradePage: (plan?: SubscriptionPlan) => Promise<void>
  openBillingPage: () => Promise<void>
  openAccountSettings: () => Promise<void>
  openProfileEditor: () => Promise<void>
  /**
   * Asks the user to sign in. When the app is already signed in, or a sign-in is already under
   * way, nothing new is opened and that sign-in is joined; otherwise the sign-in page opens in the
   * browser. Resolves true in all of those cases, before anyone has signed in, and false when the
   * page could not be opened. The sign-in itself arrives through `onDidChange`.
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
