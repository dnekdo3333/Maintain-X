import type { AuthUser, Permission } from '@maintainx/shared'

/** Who is making the request, resolved once per request by the authenticate middleware. */
export interface AuthContext {
  userId: string
  organizationId: string
  user: AuthUser
  isSuperAdmin: boolean
  permissions: ReadonlySet<Permission>
  /** Restaurants in scope. Ignored for Super Admin (all restaurants). */
  restaurantIds: ReadonlySet<string>
  /** Set when the request came in with an API key instead of a signed-in session. */
  apiKeyId?: string
}

export function buildAuthContext(user: AuthUser): AuthContext {
  return {
    userId: user.id,
    organizationId: user.organizationId,
    user,
    isSuperAdmin: user.isSuperAdmin,
    permissions: new Set(user.permissions),
    restaurantIds: new Set(user.restaurants.map((r) => r.id)),
  }
}
