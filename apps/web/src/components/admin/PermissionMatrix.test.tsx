import type { Permission } from '@maintainx/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '@/i18n'
import { PermissionMatrix } from './PermissionMatrix'
import { allowedPermissions } from './permission-groups'

function Harness({
  initial = [],
  kind = 'ADMIN' as const,
}: {
  initial?: Permission[]
  kind?: 'ADMIN' | 'WORKER'
}) {
  const [value, setValue] = useState<Permission[]>(initial)
  return (
    <>
      <PermissionMatrix kind={kind} value={value} onChange={setValue} />
      <output data-testid="value">{value.join(',')}</output>
    </>
  )
}

const value = () => screen.getByTestId('value').textContent?.split(',').filter(Boolean) ?? []

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

describe('PermissionMatrix', () => {
  it('ticking an action also grants View', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('checkbox', { name: 'Work orders: Assign' }))
    expect(value()).toEqual(['work_orders:assign', 'work_orders:view'])
  })

  it('removing View clears the whole row', async () => {
    const user = userEvent.setup()
    render(<Harness initial={['work_orders:view', 'work_orders:edit', 'assets:view']} />)
    await user.click(screen.getByRole('checkbox', { name: 'Work orders: View' }))
    expect(value()).toEqual(['assets:view'])
  })

  it('row checkbox selects every action of that row', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('checkbox', { name: 'All for Purchase orders' }))
    expect(value()).toEqual([
      'purchase_orders:approve',
      'purchase_orders:create',
      'purchase_orders:delete',
      'purchase_orders:edit',
      'purchase_orders:export',
      'purchase_orders:view',
    ])
  })

  it('Super-Admin-only resources cannot be granted to other roles', () => {
    render(<Harness />)
    expect(screen.getByRole('checkbox', { name: 'Roles: Edit' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Settings: View' })).toBeDisabled()
    expect(allowedPermissions('ADMIN').has('roles:view')).toBe(false)
  })

  it('worker roles only offer the worker set', () => {
    render(<Harness kind="WORKER" />)
    expect(screen.getByRole('checkbox', { name: 'Users: View' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Work orders: Edit' })).toBeEnabled()
  })
})
