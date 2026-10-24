export interface AuthUser {
  id: string
  email: string
  name?: string | null
  avatar?: string | null
  role?: string | null
  locale?: string | null
  emailVerified?: boolean
  bio?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

export interface AuthState {
  isLoaded: boolean
  isSignedIn: boolean
  user: AuthUser | null
  sessionId: string | null
  /**
   * The stored session has been checked in this run. Until then a signed-out state may still turn
   * signed in; once settled, signed out means there is no session. Absent where it is not known.
   */
  isSettled?: boolean
}

export interface LoginOptions {
  onSuccess?: (user: any) => void
  onError?: (error: any) => void
}

export interface LoginResult {
  success: boolean
  user?: any
  error?: any
}

export interface CurrentUser {
  id: string
  name: string
  email: string
  avatar?: string
  provider: string
}
