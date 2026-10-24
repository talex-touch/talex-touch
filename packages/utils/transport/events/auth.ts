import type { AuthState, AuthUser } from "../../auth";
import type {
  AccountInfo,
  AccountSessionState,
  DeviceSession,
  FeatureFlag,
  Subscription,
  SubscriptionPlan,
  UsageStats,
  UserProfile,
  Team,
} from "../../account/types";
import { defineEvent } from "../event/builder";

export interface AuthLoginRequest {
  mode?: "sign-in" | "sign-up";
}

export interface AuthInitiatedResponse {
  /**
   * False when no page was opened: the login already in flight turned out to be approved, and
   * the app signed in with it instead.
   */
  initiated: boolean;
  authorizeUrl?: string;
  userCode?: string;
  expiresAt?: string;
  browserOpenFailed?: boolean;
}

/**
 * - `signed-in`: the browser approved the login and the app is now signed in.
 * - `waiting`: the browser has not approved it yet, or the server could not be asked.
 * - `idle`: no login is in flight, or it ended without signing in.
 */
export type AuthPendingLoginStatus = "signed-in" | "waiting" | "idle";

export interface AuthPendingLoginResponse {
  status: AuthPendingLoginStatus;
}

export interface AuthSuccessResponse {
  success: boolean;
}

export interface AuthProfileUpdateRequest {
  displayName?: string;
  bio?: string;
}

export interface AuthAvatarUpdateRequest {
  dataUrl: string;
}

export interface AuthManualTokenRequest {
  token: string;
  appToken?: string;
  refreshToken?: string;
  ttlSeconds?: number;
}

export interface NexusRequestPayload {
  url?: string;
  path?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  context?: string;
}

export interface NexusUploadFilePayload {
  field: string;
  name: string;
  type?: string;
  data: ArrayBuffer | Uint8Array | number[];
}

export interface NexusUploadPayload {
  url?: string;
  path?: string;
  method?: string;
  headers?: Record<string, string>;
  fields?: Record<string, string>;
  files?: NexusUploadFilePayload[];
  context?: string;
}

export interface NexusResponsePayload {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  url: string;
  body: string;
}

export interface AccountRecordSyncActivityRequest {
  kind?: string;
}

export const AuthEvents = {
  session: {
    getState: defineEvent("auth")
      .module("session")
      .event("get-state")
      .define<void, AuthState>(),
    login: defineEvent("auth")
      .module("session")
      .event("login")
      .define<AuthLoginRequest, AuthInitiatedResponse>(),
    /** Asks the server now, instead of at the next poll, whether the browser approved the login. */
    checkPendingLogin: defineEvent("auth")
      .module("session")
      .event("check-pending-login")
      .define<void, AuthPendingLoginResponse>(),
    /** Abandons the browser login in flight: polling stops and its code is aborted on the server. */
    cancelLogin: defineEvent("auth")
      .module("session")
      .event("cancel-login")
      .define<void, AuthSuccessResponse>(),
    logout: defineEvent("auth")
      .module("session")
      .event("logout")
      .define<void, AuthSuccessResponse>(),
    stateChanged: defineEvent("auth")
      .module("session")
      .event("state-changed")
      .define<AuthState, void>(),
  },
  profile: {
    update: defineEvent("auth")
      .module("profile")
      .event("update")
      .define<AuthProfileUpdateRequest, AuthUser | null>(),
    updateAvatar: defineEvent("auth")
      .module("profile")
      .event("update-avatar")
      .define<AuthAvatarUpdateRequest, AuthUser | null>(),
  },
  device: {
    attest: defineEvent("auth")
      .module("device")
      .event("attest")
      .define<void, AuthSuccessResponse>(),
    getFingerprintHash: defineEvent("auth")
      .module("device")
      .event("get-fingerprint-hash")
      .define<void, string | null>(),
  },
  nexus: {
    request: defineEvent("auth")
      .module("nexus")
      .event("request")
      .define<NexusRequestPayload, NexusResponsePayload | null>(),
    upload: defineEvent("auth")
      .module("nexus")
      .event("upload")
      .define<NexusUploadPayload, NexusResponsePayload | null>(),
  },
  token: {
    manual: defineEvent("auth")
      .module("token")
      .event("manual")
      .define<AuthManualTokenRequest, AuthSuccessResponse>(),
  },
  stepUp: {
    request: defineEvent("auth")
      .module("step-up")
      .event("request")
      .define<void, AuthInitiatedResponse>(),
    getToken: defineEvent("auth")
      .module("step-up")
      .event("get-token")
      .define<void, string | null>(),
    clearToken: defineEvent("auth")
      .module("step-up")
      .event("clear-token")
      .define<void, AuthSuccessResponse>(),
  },
} as const;

export const AccountEvents = {
  auth: {
    getToken: defineEvent("account")
      .module("auth")
      .event("get-token")
      .define<void, string | null>(),
  },
  device: {
    getId: defineEvent("account")
      .module("device")
      .event("get-id")
      .define<void, string | null>(),
  },
  sync: {
    getEnabled: defineEvent("account")
      .module("sync")
      .event("get-enabled")
      .define<void, boolean>(),
    recordActivity: defineEvent("account")
      .module("sync")
      .event("record-activity")
      .define<AccountRecordSyncActivityRequest, boolean>(),
  },
  account: {
    getProfile: defineEvent("account")
      .module("profile")
      .event("get")
      .define<void, UserProfile | null>(),
    getSubscription: defineEvent("account")
      .module("subscription")
      .event("get")
      .define<void, Subscription | null>(),
    getUsage: defineEvent("account")
      .module("usage")
      .event("get")
      .define<void, UsageStats | null>(),
    getFeatures: defineEvent("account")
      .module("features")
      .event("get")
      .define<void, FeatureFlag[]>(),
    getTeams: defineEvent("account")
      .module("teams")
      .event("get")
      .define<void, Team[]>(),
    getSessions: defineEvent("account")
      .module("sessions")
      .event("get")
      .define<void, DeviceSession[]>(),
    getInfo: defineEvent("account")
      .module("info")
      .event("get")
      .define<void, AccountInfo | null>(),
    openUpgrade: defineEvent("account")
      .module("upgrade")
      .event("open")
      .define<{ plan?: SubscriptionPlan } | void, void>(),
    openBilling: defineEvent("account")
      .module("billing")
      .event("open")
      .define<void, void>(),
    openSettings: defineEvent("account")
      .module("settings")
      .event("open")
      .define<void, void>(),
    openProfile: defineEvent("account")
      .module("profile")
      .event("open")
      .define<void, void>(),
    requestLogin: defineEvent("account")
      .module("session")
      .event("request-login")
      .define<void, boolean>(),
    logout: defineEvent("account")
      .module("session")
      .event("logout")
      .define<void, void>(),
  },
  session: {
    /**
     * The session as plugins see it: sent when the stream starts, then after every change.
     */
    changed: defineEvent("account")
      .module("session")
      .event("changed")
      .define<void, AsyncIterable<AccountSessionState>>({
        stream: { enabled: true },
      }),
  },
} as const;
