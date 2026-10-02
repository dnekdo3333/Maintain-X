import {
  ACTIONS,
  RESOURCE_ACTIONS,
  permissionKey,
  type Action,
  type Permission,
  type Resource,
  type RoleKind,
} from '@maintainx/shared'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/utils/cn'
import { PERMISSION_GROUPS, allowedPermissions } from './permission-groups'
import { looseT } from '@/utils/i18n'

interface PermissionMatrixProps {
  value: readonly Permission[]
  onChange?: (value: Permission[]) => void
  kind: RoleKind
  readOnly?: boolean
}

/**
 * Resource × action grid. Ticking any action also ticks "View" (you can't edit
 * what you can't see); unticking "View" clears the row.
 */
export function PermissionMatrix({
  value,
  onChange,
  kind,
  readOnly = false,
}: PermissionMatrixProps) {
  const { t } = useTranslation()
  const tl = looseT(t)
  const selected = useMemo(() => new Set(value), [value])
  const allowed = useMemo(() => allowedPermissions(kind), [kind])

  const emit = (next: Set<Permission>) => {
    onChange?.([...next].filter((p) => allowed.has(p)).sort())
  }

  const toggle = (resource: Resource, action: Action, on: boolean) => {
    const next = new Set(selected)
    const key = permissionKey(resource, action)
    if (on) {
      next.add(key)
      const view = permissionKey(resource, 'view')
      if (allowed.has(view)) next.add(view)
    } else {
      next.delete(key)
      if (action === 'view')
        for (const a of RESOURCE_ACTIONS[resource]) next.delete(permissionKey(resource, a))
    }
    emit(next)
  }

  const rowKeys = (resource: Resource) =>
    RESOURCE_ACTIONS[resource].map((a) => permissionKey(resource, a)).filter((p) => allowed.has(p))

  const toggleRow = (resource: Resource, on: boolean) => {
    const next = new Set(selected)
    for (const p of rowKeys(resource)) {
      if (on) next.add(p)
      else next.delete(p)
    }
    emit(next)
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[42rem] border-separate border-spacing-0 text-sm">
        <thead className="bg-muted/60">
          <tr>
            <th
              scope="col"
              className="sticky left-0 border-b bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground"
            >
              {t('roles.permissions')}
            </th>
            {ACTIONS.map((a) => (
              <th
                key={a}
                scope="col"
                className="w-20 border-b px-1 py-2 text-center text-xs font-medium text-muted-foreground"
              >
                {tl(`permissions.action.${a}`)}
              </th>
            ))}
          </tr>
        </thead>
        {PERMISSION_GROUPS.map((group) => (
          <tbody key={group.key}>
            <tr>
              <th
                scope="colgroup"
                colSpan={ACTIONS.length + 1}
                className="border-b bg-background px-3 pt-3 pb-1 text-left text-xs font-semibold text-foreground"
              >
                {tl(`permissions.group.${group.key}`)}
              </th>
            </tr>
            {group.resources.map((resource) => {
              const resourceLabel = tl(`permissions.resource.${resource}`)
              const keys = rowKeys(resource)
              const rowDisabled = readOnly || keys.length === 0
              const allOn = keys.length > 0 && keys.every((k) => selected.has(k))
              const someOn = keys.some((k) => selected.has(k))
              return (
                <tr key={resource} className="hover:bg-muted/30">
                  <th
                    scope="row"
                    className="sticky left-0 border-b bg-background px-3 py-1.5 text-left font-normal"
                  >
                    <label
                      className={cn(
                        'flex items-center gap-2.5',
                        rowDisabled ? 'text-muted-foreground' : 'cursor-pointer',
                      )}
                    >
                      <Checkbox
                        checked={allOn ? true : someOn ? 'indeterminate' : false}
                        onCheckedChange={(v) => toggleRow(resource, v === true)}
                        disabled={rowDisabled}
                        aria-label={t('roles.rowAll', { resource: resourceLabel })}
                      />
                      {resourceLabel}
                    </label>
                  </th>
                  {ACTIONS.map((action) => {
                    const applicable = RESOURCE_ACTIONS[resource].includes(action)
                    const key = permissionKey(resource, action)
                    if (!applicable) {
                      return (
                        <td key={action} className="border-b text-center text-muted-foreground/50">
                          <span aria-label={t('roles.notApplicable')}>–</span>
                        </td>
                      )
                    }
                    return (
                      <td key={action} className="border-b py-1.5 text-center">
                        <Checkbox
                          checked={selected.has(key)}
                          onCheckedChange={(v) => toggle(resource, action, v === true)}
                          disabled={readOnly || !allowed.has(key)}
                          aria-label={`${resourceLabel}: ${tl(`permissions.action.${action}`)}`}
                        />
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        ))}
      </table>
    </div>
  )
}
