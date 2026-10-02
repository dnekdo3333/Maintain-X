import {
  PRIORITY,
  WORK_ORDER_CATEGORY,
  WORK_ORDER_SORT_FIELDS,
  WORK_ORDER_STATUS,
  fullName,
  type WorkOrderListItem,
} from '@maintainx/shared'
import { createColumnHelper } from '@tanstack/react-table'
import { ClipboardList, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'
import { Can } from '@/components/common/Can'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { StatusBadge } from '@/components/common/StatusBadge'
import { DataTable, FilterSelect, SearchInput } from '@/components/tables'
import { Button } from '@/components/ui/button'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ViewSwitch } from '@/components/ui/view-switch'
import { WorkOrderForm, type WorkOrderPrefill } from '@/components/work-orders/WorkOrderForm'
import { useRestaurantScope } from '@/contexts/RestaurantScopeContext'
import { useRestaurants } from '@/hooks/useAdminQueries'
import { useTableState } from '@/hooks/useTableState'
import { useWorkOrders } from '@/services/work-orders.service'
import { cn } from '@/utils/cn'
import { DUE_TONE_CLASS, describeDue } from '@/utils/format'
import { enumLabel } from '@/utils/i18n'

const FILTERS = [
  'view',
  'status',
  'priority',
  'category',
  'restaurantId',
  'assetId',
  'assignedUserId',
] as const
const TABLE_CONFIG = {
  sortFields: WORK_ORDER_SORT_FIELDS,
  defaultSort: { field: 'createdAt', direction: 'desc' },
  filters: FILTERS,
} as const
const VIEWS = ['all', 'active', 'overdue', 'unassigned', 'review'] as const
const col = createColumnHelper<WorkOrderListItem>()

export function WorkOrdersPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const scope = useRestaurantScope()
  const [params, setParams] = useSearchParams()
  const table = useTableState<(typeof WORK_ORDER_SORT_FIELDS)[number], (typeof FILTERS)[number]>(
    TABLE_CONFIG,
  )
  const restaurants = useRestaurants()
  const query = useWorkOrders(table.apiQuery)

  // "/work-orders?new=1&assetId=…" opens the create sheet prefilled (from an asset page).
  const [creating, setCreating] = useState<WorkOrderPrefill | null>(null)
  useEffect(() => {
    if (params.get('new') !== '1') return
    setCreating({
      assetId: params.get('newAssetId'),
      restaurantId: params.get('newRestaurantId') ?? undefined,
      locationId: params.get('newLocationId'),
      category: undefined,
    })
    const next = new URLSearchParams(params)
    for (const k of ['new', 'newAssetId', 'newRestaurantId', 'newLocationId']) next.delete(k)
    setParams(next, { replace: true })
  }, [params, setParams])

  useEffect(() => {
    if (scope.restaurantId && !table.state.filters.restaurantId)
      table.setFilter('restaurantId', scope.restaurantId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the scope changes
  }, [scope.restaurantId])

  const columns = [
    col.accessor('title', {
      header: t('wo.colWorkOrder'),
      enableHiding: false,
      cell: ({ row: { original: w } }) => (
        <div className="min-w-56">
          <p className="font-medium">{w.title}</p>
          <p className="text-13 text-muted-foreground">
            <span className="tabular">{w.code}</span>
            {w.asset && ` · ${w.asset.name}`}
          </p>
        </div>
      ),
    }),
    col.accessor('status', {
      header: t('wo.colStatus'),
      enableSorting: true,
      cell: (c) => <StatusBadge kind="workOrderStatus" value={c.getValue()} />,
    }),
    col.accessor('priority', {
      header: t('wo.colPriority'),
      enableSorting: true,
      cell: (c) => <StatusBadge kind="priority" value={c.getValue()} />,
    }),
    col.accessor((w) => w.restaurant.name, {
      id: 'restaurant',
      header: t('wo.colRestaurant'),
      meta: { hideBelow: 'lg' },
    }),
    col.display({
      id: 'assignee',
      header: t('wo.colAssignee'),
      meta: { hideBelow: 'md' },
      cell: ({ row: { original: w } }) =>
        w.assignedUser ? (
          fullName(w.assignedUser)
        ) : w.assignedTeam ? (
          t('wo.teamOption', { name: w.assignedTeam.name })
        ) : (
          <span className="text-muted-foreground">{t('dashboard.unassigned')}</span>
        ),
    }),
    col.accessor('dueDate', {
      header: t('wo.colDue'),
      enableSorting: true,
      meta: { hideBelow: 'md' },
      cell: ({ row: { original: w } }) => {
        if (!w.dueDate) return <span className="text-muted-foreground">—</span>
        const done = !['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'].includes(w.status)
        const due = describeDue(w.dueDate, t)
        return (
          <span
            className={cn(
              'text-13 whitespace-nowrap',
              done ? 'text-muted-foreground' : DUE_TONE_CLASS[due.tone],
            )}
          >
            {due.label}
          </span>
        )
      },
    }),
  ]

  const view = table.state.filters.view ?? 'all'

  return (
    <>
      <PageHeader
        title={t('wo.title')}
        description={t('wo.subtitle')}
        actions={
          <Can permission="work_orders:create">
            <Button onClick={() => setCreating({})}>
              <Plus aria-hidden /> {t('wo.new')}
            </Button>
          </Can>
        }
      />

      <ViewSwitch
        label={t('wo.views')}
        value={view}
        onValueChange={(v) => table.setFilter('view', v === 'all' ? undefined : v)}
        options={VIEWS.map((v) => ({ value: v, label: t(`wo.view_${v}`) }))}
        className="mb-3"
      />

      <DataTable
        label={t('wo.title')}
        persistKey="work-orders"
        columns={columns}
        data={query.data?.data}
        getRowId={(w) => w.id}
        total={query.data?.meta.total}
        page={table.state.page}
        pageSize={table.state.pageSize}
        pageSizes={table.pageSizes}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
        sort={table.state.sort}
        onSortChange={(s) => table.setSort(s as typeof table.state.sort)}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={(w) => navigate(`/work-orders/${w.id}`)}
        isFiltered={table.isFiltered}
        onClearFilters={table.clearFilters}
        toolbar={
          <>
            <SearchInput
              value={table.state.q}
              onChange={table.setSearch}
              placeholder={t('wo.search')}
            />
            {(restaurants.data?.length ?? 0) > 1 && (
              <FilterSelect
                label={t('wo.colRestaurant')}
                value={table.state.filters.restaurantId}
                onChange={(v) => table.setFilter('restaurantId', v)}
                options={(restaurants.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
              />
            )}
            <FilterSelect
              label={t('wo.colStatus')}
              value={table.state.filters.status}
              onChange={(v) => table.setFilter('status', v)}
              options={WORK_ORDER_STATUS.map((s) => ({
                value: s,
                label: enumLabel(t, 'workOrderStatus', s),
              }))}
            />
            <FilterSelect
              label={t('wo.colPriority')}
              value={table.state.filters.priority}
              onChange={(v) => table.setFilter('priority', v)}
              options={PRIORITY.map((p) => ({ value: p, label: enumLabel(t, 'priority', p) }))}
            />
            <FilterSelect
              label={t('wo.fieldCategory')}
              value={table.state.filters.category}
              onChange={(v) => table.setFilter('category', v)}
              options={WORK_ORDER_CATEGORY.map((c) => ({
                value: c,
                label: enumLabel(t, 'workOrderCategory', c),
              }))}
            />
          </>
        }
        emptyState={
          <EmptyState
            icon={ClipboardList}
            title={t('wo.emptyTitle')}
            description={t('wo.emptyBody')}
            action={
              <Can permission="work_orders:create">
                <Button size="sm" onClick={() => setCreating({})}>
                  <Plus aria-hidden /> {t('wo.new')}
                </Button>
              </Can>
            }
          />
        }
      />

      <Sheet open={!!creating} onOpenChange={(o) => !o && setCreating(null)}>
        <SheetContent aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>{t('wo.createTitle')}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {creating && (
              <WorkOrderForm
                prefill={{
                  ...creating,
                  restaurantId: creating.restaurantId ?? table.state.filters.restaurantId,
                }}
                onCancel={() => setCreating(null)}
                onDone={(w) => {
                  setCreating(null)
                  navigate(`/work-orders/${w.id}`)
                }}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  )
}
