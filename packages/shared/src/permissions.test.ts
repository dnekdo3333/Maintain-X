import { describe, expect, it } from 'vitest'
import {
  ADMIN_DEFAULT_PERMISSIONS,
  ALL_PERMISSIONS,
  RESOURCES,
  RESOURCE_ACTIONS,
  SUPER_ADMIN_ONLY_RESOURCES,
  WORKER_PERMISSION_FLOOR,
  isPermission,
  parsePermission,
} from './permissions.js'
import {
  PURCHASE_ORDER_TRANSITIONS,
  WORK_ORDER_TRANSITIONS,
  canTransitionWorkOrder,
} from './transitions.js'
import { PURCHASE_ORDER_STATUS, WORK_ORDER_STATUS } from './enums.js'

describe('permissions', () => {
  it('every resource declares at least view', () => {
    for (const r of RESOURCES) expect(RESOURCE_ACTIONS[r]).toContain('view')
  })

  it('ALL_PERMISSIONS has no duplicates', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length)
  })

  it('role defaults only contain valid permissions', () => {
    for (const p of [...ADMIN_DEFAULT_PERMISSIONS, ...WORKER_PERMISSION_FLOOR]) {
      expect(isPermission(p), p).toBe(true)
    }
  })

  it('workers never receive admin-only resources', () => {
    for (const p of WORKER_PERMISSION_FLOOR) {
      const parsed = parsePermission(p)
      expect(parsed).not.toBeNull()
      expect(['users', 'roles', 'settings', 'audit_logs']).not.toContain(parsed!.resource)
    }
  })

  it('admin default excludes super-admin-only resources', () => {
    for (const p of ADMIN_DEFAULT_PERMISSIONS) {
      expect(SUPER_ADMIN_ONLY_RESOURCES).not.toContain(parsePermission(p)!.resource)
    }
  })

  it('parsePermission rejects unknown or non-applicable keys', () => {
    expect(parsePermission('work_orders:view')).toEqual({ resource: 'work_orders', action: 'view' })
    expect(parsePermission('work_orders:fly')).toBeNull()
    expect(parsePermission('reports:create')).toBeNull()
    expect(parsePermission('nope')).toBeNull()
  })
})

describe('transitions', () => {
  it('cover every status', () => {
    expect(Object.keys(WORK_ORDER_TRANSITIONS).sort()).toEqual([...WORK_ORDER_STATUS].sort())
    expect(Object.keys(PURCHASE_ORDER_TRANSITIONS).sort()).toEqual(
      [...PURCHASE_ORDER_STATUS].sort(),
    )
  })

  it('follow the required work order path', () => {
    expect(canTransitionWorkOrder('OPEN', 'ASSIGNED')).toBe(true)
    expect(canTransitionWorkOrder('ASSIGNED', 'IN_PROGRESS')).toBe(true)
    expect(canTransitionWorkOrder('IN_PROGRESS', 'ON_HOLD')).toBe(true)
    expect(canTransitionWorkOrder('ON_HOLD', 'IN_PROGRESS')).toBe(true)
    expect(canTransitionWorkOrder('IN_PROGRESS', 'COMPLETED')).toBe(true)
    expect(canTransitionWorkOrder('COMPLETED', 'REVIEW')).toBe(true)
    expect(canTransitionWorkOrder('REVIEW', 'CLOSED')).toBe(true)
  })

  it('reopen goes back to ASSIGNED and nothing skips ahead', () => {
    expect(canTransitionWorkOrder('CLOSED', 'ASSIGNED')).toBe(true)
    expect(canTransitionWorkOrder('OPEN', 'COMPLETED')).toBe(false)
    expect(canTransitionWorkOrder('OPEN', 'CLOSED')).toBe(false)
    expect(canTransitionWorkOrder('IN_PROGRESS', 'CLOSED')).toBe(false)
  })
})
