import type { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'

/*
 * Organization settings stored as JSON rows (scopeKey "org"). Every reader
 * supplies its defaults, so a missing or partial row never breaks anything.
 */

export async function getOrgSetting<T extends object>(
  organizationId: string,
  key: string,
  defaults: T,
): Promise<T> {
  const row = await prisma.setting.findUnique({
    where: { organizationId_scopeKey_key: { organizationId, scopeKey: 'org', key } },
    select: { value: true },
  })
  const value = row?.value
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...defaults, ...(value as Partial<T>) }
    : defaults
}

export async function setOrgSetting(
  organizationId: string,
  key: string,
  value: Prisma.InputJsonValue,
  updatedById: string,
) {
  await prisma.setting.upsert({
    where: { organizationId_scopeKey_key: { organizationId, scopeKey: 'org', key } },
    update: { value, updatedById },
    create: { organizationId, scope: 'ORGANIZATION', scopeKey: 'org', key, value, updatedById },
  })
}

/** What a technician must hand in before a job counts as complete. */
export interface CompletionPolicy {
  requireBeforePhoto: boolean
  requireAfterPhoto: boolean
}

export const COMPLETION_POLICY_KEY = 'workOrders.completion'

export const completionPolicy = (organizationId: string) =>
  getOrgSetting<CompletionPolicy>(organizationId, COMPLETION_POLICY_KEY, {
    requireBeforePhoto: true,
    requireAfterPhoto: true,
  })

/** Inventory automation. */
export interface InventorySettingsValue {
  autoPurchaseRequest: boolean
}

export const INVENTORY_SETTINGS_KEY = 'inventory.settings'

export const inventorySettings = (organizationId: string) =>
  getOrgSetting<InventorySettingsValue>(organizationId, INVENTORY_SETTINGS_KEY, {
    autoPurchaseRequest: false,
  })
