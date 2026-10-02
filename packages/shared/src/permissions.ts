/**
 * Permission model: `resource:action`.
 *
 * - RESOURCE_ACTIONS says which actions are meaningful per resource.
 * - ALL_PERMISSIONS is the seed source for the `permissions` table.
 * - DEFAULT_ROLE_PERMISSIONS seeds the three system roles.
 * - WORKER_PERMISSION_FLOOR is the fixed set workers always have and never exceed
 *   through the WORKER role (admins may still grant more via a custom role).
 *
 * The backend is the authority; the frontend only uses these to hide controls.
 */

export const ACTIONS = ['view', 'create', 'edit', 'delete', 'assign', 'approve', 'export'] as const
export type Action = (typeof ACTIONS)[number]

export const RESOURCES = [
  'dashboard',
  'restaurants',
  'locations',
  'users',
  'roles',
  'teams',
  'assets',
  'qr',
  'requests',
  'work_orders',
  'maintenance',
  'procedures',
  'inspections',
  'inventory',
  'parts',
  'vendors',
  'purchase_orders',
  'documents',
  'messages',
  'notifications',
  'reports',
  'audit_logs',
  'settings',
] as const
export type Resource = (typeof RESOURCES)[number]

const CRUD = ['view', 'create', 'edit', 'delete'] as const satisfies readonly Action[]

export const RESOURCE_ACTIONS: Record<Resource, readonly Action[]> = {
  dashboard: ['view'],
  restaurants: [...CRUD, 'export'],
  locations: [...CRUD, 'export'],
  users: [...CRUD, 'assign', 'export'],
  roles: [...CRUD, 'assign', 'export'],
  teams: [...CRUD, 'assign', 'export'],
  assets: [...CRUD, 'export'],
  qr: ['view', 'create', 'export'],
  requests: [...CRUD, 'assign', 'approve', 'export'],
  work_orders: [...CRUD, 'assign', 'approve', 'export'],
  maintenance: [...CRUD, 'assign', 'export'],
  procedures: [...CRUD, 'export'],
  inspections: [...CRUD, 'export'],
  inventory: [...CRUD, 'export'],
  parts: [...CRUD, 'export'],
  vendors: [...CRUD, 'export'],
  purchase_orders: [...CRUD, 'approve', 'export'],
  documents: [...CRUD],
  messages: ['view', 'create'],
  notifications: ['view', 'edit'],
  reports: ['view', 'export'],
  audit_logs: ['view', 'export'],
  settings: ['view', 'edit'],
}

export type Permission = `${Resource}:${Action}`

export function permissionKey(resource: Resource, action: Action): Permission {
  return `${resource}:${action}`
}

export function parsePermission(key: string): { resource: Resource; action: Action } | null {
  const [resource, action] = key.split(':')
  if (!resource || !action) return null
  if (!(RESOURCES as readonly string[]).includes(resource)) return null
  if (!(ACTIONS as readonly string[]).includes(action)) return null
  const r = resource as Resource
  const a = action as Action
  if (!RESOURCE_ACTIONS[r].includes(a)) return null
  return { resource: r, action: a }
}

export const ALL_PERMISSIONS: readonly Permission[] = RESOURCES.flatMap((resource) =>
  RESOURCE_ACTIONS[resource].map((action) => permissionKey(resource, action)),
)

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// System roles
// ---------------------------------------------------------------------------

export const SYSTEM_ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  WORKER: 'WORKER',
} as const
export type SystemRole = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES]

function perms(resource: Resource, actions: readonly Action[]): Permission[] {
  return actions.map((a) => permissionKey(resource, a))
}

/**
 * Workers: see and work their own tasks, run checklists, report problems,
 * look up assets in their restaurants. Never any administration.
 */
export const WORKER_PERMISSION_FLOOR: readonly Permission[] = [
  ...perms('dashboard', ['view']),
  ...perms('restaurants', ['view']),
  ...perms('locations', ['view']),
  ...perms('assets', ['view']),
  ...perms('qr', ['view']),
  ...perms('requests', ['view', 'create']),
  ...perms('work_orders', ['view', 'edit']),
  ...perms('maintenance', ['view']),
  ...perms('procedures', ['view']),
  ...perms('inspections', ['view', 'create', 'edit']),
  ...perms('inventory', ['view']),
  ...perms('parts', ['view']),
  ...perms('documents', ['view', 'create']),
  ...perms('messages', ['view', 'create']),
  ...perms('notifications', ['view', 'edit']),
]

/**
 * Admin default: full operational control inside their restaurants.
 * Super Admin can widen or narrow this through the permission matrix.
 * Organization-level configuration (roles, settings, audit) stays with Super Admin.
 */
export const ADMIN_DEFAULT_PERMISSIONS: readonly Permission[] = [
  ...perms('dashboard', ['view']),
  ...perms('restaurants', ['view', 'edit', 'export']),
  ...perms('locations', [...CRUD, 'export']),
  ...perms('users', ['view', 'create', 'edit', 'assign']),
  ...perms('teams', [...CRUD, 'assign']),
  ...perms('assets', [...CRUD, 'export']),
  ...perms('qr', ['view', 'create', 'export']),
  ...perms('requests', [...CRUD, 'assign', 'approve', 'export']),
  ...perms('work_orders', [...CRUD, 'assign', 'approve', 'export']),
  ...perms('maintenance', [...CRUD, 'assign', 'export']),
  ...perms('procedures', [...CRUD, 'export']),
  ...perms('inspections', [...CRUD, 'export']),
  ...perms('inventory', [...CRUD, 'export']),
  ...perms('parts', [...CRUD, 'export']),
  ...perms('vendors', [...CRUD, 'export']),
  ...perms('purchase_orders', [...CRUD, 'approve', 'export']),
  ...perms('documents', [...CRUD]),
  ...perms('messages', ['view', 'create']),
  ...perms('notifications', ['view', 'edit']),
  ...perms('reports', ['view', 'export']),
]

export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRole, readonly Permission[]> = {
  SUPER_ADMIN: ALL_PERMISSIONS,
  ADMIN: ADMIN_DEFAULT_PERMISSIONS,
  WORKER: WORKER_PERMISSION_FLOOR,
}

/** Only Super Admin may hold these, regardless of custom roles. */
export const SUPER_ADMIN_ONLY_RESOURCES: readonly Resource[] = ['roles', 'settings']
