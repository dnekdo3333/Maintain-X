import type {
  ApiResponse,
  AuthSession,
  AuthUser,
  ChangePasswordInput,
  Locale,
  LoginInput,
} from '@maintainx/shared'
import { ApiError, http, setAccessToken, setRefreshHandler } from './http'

/*
 * Session lifecycle for the web app. Components use the AuthProvider/useAuth;
 * this module owns the token and talks to /auth endpoints.
 */

export type SessionEvent =
  | { type: 'signedIn'; session: AuthSession }
  | { type: 'refreshed'; session: AuthSession }
  | { type: 'signedOut'; reason: 'logout' | 'expired' }

type Listener = (event: SessionEvent) => void
const listeners = new Set<Listener>()

export function subscribeSession(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(event: SessionEvent): void {
  for (const l of listeners) l(event)
}

function isSession(value: unknown): value is AuthSession {
  const s = value as Partial<AuthSession> | null
  return !!s && typeof s.accessToken === 'string' && typeof s.user === 'object' && s.user !== null
}

function adopt(session: AuthSession, type: 'signedIn' | 'refreshed'): AuthSession {
  setAccessToken(session.accessToken)
  emit({ type, session })
  return session
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Result of trying to continue a session:
 *  - session   → signed in (token installed)
 *  - null      → no valid session (signed out)
 *  - throws ApiError NETWORK_ERROR/5xx → couldn't tell; keep the user where they are
 */
async function doRefresh(): Promise<AuthSession | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await http.post<ApiResponse<AuthSession>>('/auth/refresh', undefined, {
        anonymous: true,
      })
      if (!isSession(res.data)) throw new ApiError(500, 'INTERNAL_ERROR', 'Malformed session')
      return res.data
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Another tab may have just rotated the cookie; give it a moment and try once more.
        if (attempt === 0 && err.code === 'TOKEN_INVALID') {
          await wait(400)
          continue
        }
        return null
      }
      throw err
    }
  }
  return null
}

let inFlight: Promise<AuthSession | null> | null = null

/** Single-flight refresh: concurrent callers share one network request. */
export function refreshSession(): Promise<AuthSession | null> {
  inFlight ??= (async () => {
    try {
      const session = await doRefresh()
      if (session) return adopt(session, 'refreshed')
      setAccessToken(null)
      return null
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

// Install the handler the HTTP client uses when an access token expires mid-session.
setRefreshHandler(async () => {
  try {
    if (await refreshSession()) return true
  } catch {
    // Network trouble: let the original request fail with its own error; stay signed in.
    return false
  }
  emit({ type: 'signedOut', reason: 'expired' })
  return false
})

export async function login(input: LoginInput): Promise<AuthSession> {
  const res = await http.post<ApiResponse<AuthSession>>('/auth/login', input, { anonymous: true })
  return adopt(res.data, 'signedIn')
}

export async function logout(): Promise<void> {
  try {
    await http.post('/auth/logout', undefined, { anonymous: true })
  } catch {
    // Signing out locally must always work, even offline.
  }
  setAccessToken(null)
  emit({ type: 'signedOut', reason: 'logout' })
}

export async function logoutEverywhere(): Promise<void> {
  await http.post('/auth/logout-all')
  setAccessToken(null)
  emit({ type: 'signedOut', reason: 'logout' })
}

export async function changePassword(input: ChangePasswordInput): Promise<AuthSession> {
  const res = await http.post<ApiResponse<AuthSession>>('/auth/change-password', input)
  return adopt(res.data, 'refreshed')
}

export async function updatePreferences(preferredLocale: Locale): Promise<AuthUser> {
  const res = await http.patch<ApiResponse<AuthUser>>('/auth/me/preferences', { preferredLocale })
  return res.data
}
