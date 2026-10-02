import { fullName } from '@maintainx/shared'
import { useQuery } from '@tanstack/react-query'
import { Package, Pencil, Users, UsersRound } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Can } from '@/components/common/Can'
import { DocumentsPanel } from '@/components/documents/DocumentList'
import { DetailList } from '@/components/common/DetailList'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody } from '@/components/ui/panel'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/contexts/AuthContext'
import { adminKeys, useTeams, useUsers } from '@/hooks/useAdminQueries'
import { restaurantsApi } from '@/services/admin.service'
import { useAssets } from '@/services/assets.service'
import { LocationsPanel } from './LocationsPanel'
import { RestaurantForm } from './RestaurantsPage'

const TABS = ['details', 'locations', 'assets', 'people', 'teams', 'documents'] as const
type Tab = (typeof TABS)[number]

function AssetsTab({ restaurantId }: { restaurantId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const query = useAssets({ restaurantId, page: 1, pageSize: 50, sort: 'name:asc' })
  if (query.isPending) return <Skeleton className="h-40 w-full" />
  if (query.isError)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
  if (query.data.data.length === 0)
    return (
      <Panel>
        <EmptyState
          icon={Package}
          title={t('assets.emptyTitle')}
          description={t('assets.emptyBody')}
        />
      </Panel>
    )
  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <Button asChild variant="secondary" size="sm">
          <Link to={`/assets?restaurantId=${restaurantId}`}>
            {t('restaurantDetail.viewAllAssets')}
          </Link>
        </Button>
      </div>
      <Panel>
        <ul className="divide-y">
          {query.data.data.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => navigate(`/assets/${a.id}`)}
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{a.name}</span>
                  <span className="block text-13 text-muted-foreground">
                    {a.assetCode} · {a.category.name}
                    {a.location && ` · ${a.location.name}`}
                  </span>
                </span>
                <StatusBadge kind="assetStatus" value={a.status} />
              </button>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}

function PeopleTab({ restaurantId }: { restaurantId: string }) {
  const { t } = useTranslation()
  const query = useUsers({ restaurantId, page: 1, pageSize: 100, sort: 'name:asc' })
  if (query.isPending) return <Skeleton className="h-40 w-full" />
  if (query.isError)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
  if (query.data.data.length === 0)
    return (
      <Panel>
        <EmptyState icon={Users} title={t('restaurantDetail.peopleEmpty')} />
      </Panel>
    )
  return (
    <Panel>
      <ul className="divide-y">
        {query.data.data.map((u) => (
          <li key={u.id}>
            <Link
              to={`/users/${u.id}`}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            >
              <Avatar name={fullName(u)} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{fullName(u)}</span>
              <span className="text-13 text-muted-foreground">{u.role?.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function TeamsTab({ restaurantId }: { restaurantId: string }) {
  const { t } = useTranslation()
  const query = useTeams()
  if (query.isPending) return <Skeleton className="h-32 w-full" />
  if (query.isError)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
  const teams = query.data.filter((tm) => tm.restaurant?.id === restaurantId)
  if (teams.length === 0)
    return (
      <Panel>
        <EmptyState icon={UsersRound} title={t('restaurantDetail.teamsEmpty')} />
      </Panel>
    )
  return (
    <Panel>
      <ul className="divide-y">
        {teams.map((tm) => (
          <li key={tm.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="text-sm font-medium">{tm.name}</span>
            <span className="text-13 text-muted-foreground tabular">{tm.members.length}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

export function RestaurantDetailPage() {
  const { t } = useTranslation()
  const { restaurantId = '' } = useParams()
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState(false)
  const query = useQuery({
    queryKey: [...adminKeys.restaurants, 'detail', restaurantId],
    queryFn: ({ signal }) => restaurantsApi.get(restaurantId, signal),
  })

  const available: Tab[] = TABS.filter(
    (tab) =>
      (tab !== 'assets' || can('assets:view')) &&
      (tab !== 'people' || can('users:view')) &&
      (tab !== 'teams' || can('teams:view')) &&
      (tab !== 'locations' || can('locations:view')) &&
      (tab !== 'documents' || can('documents:view')),
  )
  const requested = params.get('tab') as Tab | null
  const tab: Tab = requested && available.includes(requested) ? requested : 'details'
  const labels: Record<Tab, string> = {
    details: t('restaurantDetail.tabDetails'),
    locations: t('restaurantDetail.tabLocations'),
    assets: t('restaurantDetail.tabAssets'),
    people: t('restaurantDetail.tabPeople'),
    teams: t('restaurantDetail.tabTeams'),
    documents: t('documents.pageTitle'),
  }

  if (query.isPending) return <Skeleton className="h-64 w-full" />
  if (query.isError) {
    return (
      <>
        <PageHeader
          title={t('restaurants.title')}
          back={{ to: '/restaurants', label: t('restaurants.title') }}
        />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </>
    )
  }

  const r = query.data
  const address = [r.addressLine1, r.addressLine2, r.city, r.state, r.postalCode]
    .filter(Boolean)
    .join(', ')
  return (
    <>
      <PageHeader
        back={{ to: '/restaurants', label: t('restaurants.title') }}
        title={r.name}
        meta={
          <>
            <span className="text-13 text-muted-foreground tabular">{r.code}</span>
            <StatusBadge kind="restaurantStatus" value={r.status} />
          </>
        }
        actions={
          <Can permission="restaurants:edit">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil aria-hidden /> {t('actions.edit')}
            </Button>
          </Can>
        }
      />

      <Tabs
        value={tab}
        onValueChange={(v) => setParams(v === 'details' ? {} : { tab: v }, { replace: true })}
      >
        <TabsList>
          {available.map((v) => (
            <TabsTrigger key={v} value={v}>
              {labels[v]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="details" className="max-w-3xl">
          <Panel>
            <PanelBody className="py-1">
              <DetailList
                items={[
                  { label: t('restaurantDetail.address'), value: address },
                  {
                    label: t('restaurantDetail.hours'),
                    value: r.opensAt && r.closesAt ? `${r.opensAt}–${r.closesAt}` : null,
                  },
                  { label: t('restaurants.phone'), value: r.phone },
                  { label: t('restaurants.email'), value: r.email },
                ]}
              />
            </PanelBody>
          </Panel>
        </TabsContent>
        <TabsContent value="locations" className="max-w-3xl">
          {tab === 'locations' && <LocationsPanel restaurantId={r.id} />}
        </TabsContent>
        <TabsContent value="assets" className="max-w-3xl">
          {tab === 'assets' && <AssetsTab restaurantId={r.id} />}
        </TabsContent>
        <TabsContent value="people" className="max-w-3xl">
          {tab === 'people' && <PeopleTab restaurantId={r.id} />}
        </TabsContent>
        <TabsContent value="teams" className="max-w-3xl">
          {tab === 'teams' && <TeamsTab restaurantId={r.id} />}
        </TabsContent>
        <TabsContent value="documents" className="max-w-3xl">
          {tab === 'documents' && (
            <DocumentsPanel ownerType="RESTAURANT" ownerId={r.id} ownerName={r.name} />
          )}
        </TabsContent>
      </Tabs>

      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>{t('restaurants.editTitle')}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {editing && <RestaurantForm restaurant={r} onDone={() => setEditing(false)} />}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  )
}
