import type { SsoProvider } from '@maintainx/shared'
import { createHash, randomBytes } from 'node:crypto'
import { env } from '../../config/env.js'

/*
 * "Sign in with Google / Microsoft" (OpenID Connect, authorization code +
 * PKCE). The provider proves the email address; the user must already exist
 * in the app with that email. Keys come from the free Google Cloud console /
 * Microsoft Entra app registration.
 */

interface ProviderConfig {
  authorize: string
  token: string
  userinfo: string
  clientId: string
  clientSecret: string
  scope: string
}

function config(p: SsoProvider): ProviderConfig | null {
  if (p === 'google') {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null
    return {
      authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
      token: 'https://oauth2.googleapis.com/token',
      userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      scope: 'openid email profile',
    }
  }
  // Only the organisation's own directory: its admins vouch for the email.
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET || !env.MICROSOFT_TENANT_ID)
    return null
  const base = `https://login.microsoftonline.com/${encodeURIComponent(env.MICROSOFT_TENANT_ID)}/oauth2/v2.0`
  return {
    authorize: `${base}/authorize`,
    token: `${base}/token`,
    userinfo: 'https://graph.microsoft.com/oidc/userinfo',
    clientId: env.MICROSOFT_CLIENT_ID,
    clientSecret: env.MICROSOFT_CLIENT_SECRET,
    scope: 'openid email profile',
  }
}

export const enabledProviders = (): SsoProvider[] =>
  (['google', 'microsoft'] as const).filter((p) => config(p) !== null)

export const redirectUri = (p: SsoProvider) =>
  `${env.APP_URL.replace(/\/+$/, '')}/api/v1/auth/sso/${p}/callback`

const b64url = (b: Buffer) => b.toString('base64url')

/** Where to send the browser, plus the state + PKCE verifier to remember (cookie). */
export function startUrl(p: SsoProvider): { url: string; state: string; verifier: string } | null {
  const c = config(p)
  if (!c) return null
  const state = b64url(randomBytes(24))
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const url = new URL(c.authorize)
  url.search = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: redirectUri(p),
    response_type: 'code',
    scope: c.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString()
  return { url: url.toString(), state, verifier }
}

/** Exchanges the code and returns the verified email (or null). */
export async function verifiedEmail(
  p: SsoProvider,
  code: string,
  verifier: string,
): Promise<string | null> {
  const c = config(p)
  if (!c) return null
  const tokenRes = await fetch(c.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(p),
      client_id: c.clientId,
      client_secret: c.clientSecret,
      code_verifier: verifier,
    }),
  })
  if (!tokenRes.ok) return null
  const { access_token } = (await tokenRes.json()) as { access_token?: string }
  if (!access_token) return null
  const infoRes = await fetch(c.userinfo, {
    headers: { Authorization: `Bearer ${access_token}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!infoRes.ok) return null
  const info = (await infoRes.json()) as { email?: string; email_verified?: boolean | string }
  if (!info.email) return null
  // Google says whether the address was verified; Microsoft accounts are from your own tenant.
  if (p === 'google' && info.email_verified !== true && info.email_verified !== 'true') return null
  return info.email.toLowerCase()
}
