import {
  RESOURCE_ACTIONS,
  SUPER_ADMIN_ONLY_RESOURCES,
  WORKER_PERMISSION_FLOOR,
  permissionKey,
  type Action,
  type Permission,
  type Resource,
  type RoleKind,
} from '@maintainx/shared'

/** Resources grouped the way people think about the product, not alphabetically. */
export const PERMISSION_GROUPS: ReadonlyArray<{ key: string; resources: readonly Resource[] }> = [
  {
    key: 'operations',
    resources: ['dashboard', 'requests', 'work_orders', 'messages', 'notifications'],
  },
  {
    key: 'assets',
    resources: ['assets', 'qr', 'maintenance', 'procedures', 'inspections', 'documents'],
  },
  { key: 'stock', resources: ['inventory', 'parts', 'vendors', 'purchase_orders'] },
  { key: 'organization', resources: ['restaurants', 'locations', 'users', 'teams'] },
  { key: 'insights', resources: ['reports', 'audit_logs'] },
  { key: 'system', resources: ['roles', 'settings'] },
]

/** Which permissions a role of this kind may hold at all (mirrors the server rules). */
export function allowedPermissions(kind: RoleKind): ReadonlySet<Permission> {
  if (kind === 'WORKER') return new Set(WORKER_PERMISSION_FLOOR)
  const out = new Set<Permission>()
  for (const [resource, actions] of Object.entries(RESOURCE_ACTIONS) as Array<
    [Resource, readonly Action[]]
  >) {
    if (SUPER_ADMIN_ONLY_RESOURCES.includes(resource)) continue
    for (const a of actions) out.add(permissionKey(resource, a))
  }
  return out
}
