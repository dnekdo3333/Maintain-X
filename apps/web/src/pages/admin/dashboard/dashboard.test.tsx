import { ADMIN_DEFAULT_PERMISSIONS, type DashboardSummary } from '@maintainx/shared'
import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppProviders } from '@/app/providers'
import i18n from '@/i18n'
import { appRoutes } from '@/routes/app.routes'
import { setAccessToken } from '@/services/http'
import { installFakeAuthApi, json, makeUser } from '@/test/fake-auth-api'

const R1 = { id: '11111111-1111-4111-8111-111111111111', code: 'R1', name: 'Restaurant 1' }
const R2 = { id: '22222222-2222-4222-8222-222222222222', code: 'R2', name: 'Restaurant 2' }

const EMPTY: DashboardSummary = {
  generatedAt: new Date().toISOString(),
  counts: {
    restaurants: 2,
    open: 0,
    overdue: 0,
    inProgress: 0,
    completed30d: 0,
    critical: 0,
    lowStock: 0,
  },
  pmCompliance: null,
  todaysTasks: [],
  criticalIssues: [],
  overdueTasks: [],
  recentActivity: [],
  restaurants: [
    { ...R1, open: 0, overdue: 0, critical: 0 },
    { ...R2, open: 0, overdue: 0, critical: 0 },
  ],
}

const BUSY: DashboardSummary = {
  ...EMPTY,
  counts: {
    restaurants: 2,
    open: 12,
    overdue: 3,
    inProgress: 4,
    completed30d: 40,
    critical: 1,
    lowStock: 2,
  },
  pmCompliance: 92,
  criticalIssues: [
    {
      id: 'w1',
      code: 'WO-000042',
      title: 'Walk-in freezer not holding temperature',
      priority: 'CRITICAL',
      status: 'ASSIGNED',
      dueDate: new Date(Date.now() - 3_600_000).toISOString(),
      restaurant: { id: R1.id, name: R1.name },
      assignee: { id: 'u9', firstName: 'Ramesh', lastName: 'K' },
    },
  ],
  recentActivity: [
    {
      id: 'a1',
      action: 'team.created',
      entityType: 'TEAM',
      actor: { id: 'u1', firstName: 'Priya', lastName: 'Mehta' },
      restaurant: { id: R1.id, name: R1.name },
      createdAt: new Date().toISOString(),
    },
  ],
  restaurants: [
    { ...R1, open: 9, overdue: 3, critical: 1 },
    { ...R2, open: 3, overdue: 0, critical: 0 },
  ],
}

const admin = makeUser({ permissions: [...ADMIN_DEFAULT_PERMISSIONS], restaurants: [R1, R2] })

function setup(data: DashboardSummary, user = admin) {
  const requested: Array<string | null> = []
  installFakeAuthApi({
    user,
    signedIn: true,
    routes: (_m, path, _b, query) => {
      if (path !== '/dashboard') return undefined
      requested.push(query.get('restaurantId'))
      return json({ data })
    },
  })
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/'] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <AppProviders queryClient={client}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return { ...utils, requested }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  setAccessToken(null)
  localStorage.clear()
})
afterEach(() => setAccessToken(null))

describe('DashboardPage', () => {
  it('is the admin home and shows honest empty states', async () => {
    const { container } = setup(EMPTY)
    await screen.findByRole('heading', { name: 'Dashboard', level: 1 })
    expect(await screen.findByText('You’re all caught up. No tasks due today.')).toBeInTheDocument()
    expect(screen.getByText('No critical issues. Everything is under control.')).toBeInTheDocument()
    expect(screen.getByText('No preventive work due yet')).toBeInTheDocument()
    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument()
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(results.violations.map((v) => v.id)).toEqual([])
  })

  it('shows counts, critical issues, activity and the restaurant breakdown', async () => {
    setup(BUSY)
    expect(await screen.findByText('Walk-in freezer not holding temperature')).toBeInTheDocument()
    expect(screen.getByText('92%')).toBeInTheDocument()
    expect(screen.getAllByText('Needs attention')).toHaveLength(3) // overdue, critical, low stock
    expect(screen.getByText('created a team', { exact: false })).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'By restaurant' })
    expect(within(table).getAllByRole('row')).toHaveLength(3)
  })

  it('the restaurant switcher re-queries for one restaurant and is remembered', async () => {
    const { requested } = setup(EMPTY)
    await screen.findByText('You’re all caught up. No tasks due today.')
    expect(requested).toEqual([null])

    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'Restaurant' }))
    await user.click(await screen.findByRole('option', { name: 'Restaurant 2' }))
    await screen.findByRole('combobox', { name: 'Restaurant' })
    expect(requested.at(-1)).toBe(R2.id)
    expect(localStorage.getItem(`mx.scope.${admin.id}`)).toBe(R2.id)
  })

  it('translates the page', async () => {
    // The language saved on the account is applied at sign-in.
    setup(BUSY, { ...admin, preferredLocale: 'gu' })
    expect(await screen.findByRole('heading', { name: 'ડૅશબોર્ડ', level: 1 })).toBeInTheDocument()
    expect(await screen.findByText('ટીમ બનાવી', { exact: false })).toBeInTheDocument()
  })
})
