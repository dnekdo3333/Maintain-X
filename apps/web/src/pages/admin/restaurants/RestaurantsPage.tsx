import {
  RESTAURANT_STATUS,
  restaurantSchema,
  type RestaurantDto,
  type RestaurantInput,
} from '@maintainx/shared'
import { Building2, Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Can } from '@/components/common/Can'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import { StatusBadge } from '@/components/common/StatusBadge'
import {
  Form,
  FormActions,
  FormRootError,
  SelectField,
  TextField,
  applyServerErrors,
  useZodForm,
} from '@/components/forms'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/panel'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from '@/components/ui/toaster'
import { adminKeys, useInvalidatingMutation, useRestaurants } from '@/hooks/useAdminQueries'
import { restaurantsApi } from '@/services/admin.service'
import { describeError } from '@/utils/errors'
import { enumLabel } from '@/utils/i18n'

const EMPTY: RestaurantInput = {
  code: '',
  name: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  phone: '',
  email: '',
  opensAt: '',
  closesAt: '',
  status: 'ACTIVE',
}

function toInput(r: RestaurantDto): RestaurantInput {
  return {
    code: r.code,
    name: r.name,
    addressLine1: r.addressLine1 ?? '',
    addressLine2: r.addressLine2 ?? '',
    city: r.city ?? '',
    state: r.state ?? '',
    postalCode: r.postalCode ?? '',
    phone: r.phone ?? '',
    email: r.email ?? '',
    opensAt: r.opensAt ?? '',
    closesAt: r.closesAt ?? '',
    status: r.status,
  }
}

export function RestaurantForm({
  restaurant,
  onDone,
}: {
  restaurant: RestaurantDto | null
  onDone: () => void
}) {
  const { t } = useTranslation()
  const form = useZodForm(restaurantSchema, {
    defaultValues: restaurant ? toInput(restaurant) : EMPTY,
  })
  const save = useInvalidatingMutation(
    (input: RestaurantInput) =>
      restaurant ? restaurantsApi.update(restaurant.id, input) : restaurantsApi.create(input),
    // Restaurant names appear inside users and teams too.
    [adminKeys.restaurants, adminKeys.users, adminKeys.teams],
  )
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await save.mutateAsync(values)
      toast.success(t('restaurants.saved'))
      onDone()
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormRootError message={errors.root?.message} />
        <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
          <TextField
            control={form.control}
            name="code"
            label={t('restaurants.code')}
            required
            autoCapitalize="characters"
          />
          <TextField control={form.control} name="name" label={t('restaurants.name')} required />
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">{t('restaurants.codeHint')}</p>
        <TextField
          control={form.control}
          name="addressLine1"
          label={t('restaurants.addressLine1')}
          optional
        />
        <TextField
          control={form.control}
          name="addressLine2"
          label={t('restaurants.addressLine2')}
          optional
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField control={form.control} name="city" label={t('restaurants.city')} optional />
          <TextField control={form.control} name="state" label={t('restaurants.state')} optional />
          <TextField
            control={form.control}
            name="postalCode"
            label={t('restaurants.postalCode')}
            optional
            inputMode="numeric"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            control={form.control}
            name="phone"
            type="tel"
            label={t('restaurants.phone')}
            optional
          />
          <TextField
            control={form.control}
            name="email"
            type="email"
            label={t('restaurants.email')}
            optional
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            control={form.control}
            name="opensAt"
            label={t('restaurants.opensAt')}
            optional
            type="text"
            placeholder="09:00"
            inputMode="numeric"
          />
          <TextField
            control={form.control}
            name="closesAt"
            label={t('restaurants.closesAt')}
            optional
            type="text"
            placeholder="23:00"
            inputMode="numeric"
          />
          <SelectField
            control={form.control}
            name="status"
            label={t('restaurants.status')}
            options={RESTAURANT_STATUS.map((s) => ({
              value: s,
              label: enumLabel(t, 'restaurantStatus', s),
            }))}
          />
        </div>
        <FormActions>
          <Button variant="secondary" onClick={onDone} disabled={isSubmitting}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {t('actions.save')}
          </Button>
        </FormActions>
      </form>
    </Form>
  )
}

export function RestaurantsPage() {
  const { t } = useTranslation()
  const query = useRestaurants()
  const [editing, setEditing] = useState<RestaurantDto | 'new' | null>(null)
  const navigate = useNavigate()

  return (
    <>
      <PageHeader
        title={t('restaurants.title')}
        description={t('restaurants.subtitle')}
        actions={
          <Can permission="restaurants:create">
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden /> {t('restaurants.new')}
            </Button>
          </Can>
        }
      />

      <Panel className="overflow-hidden">
        {query.isPending ? (
          <div className="grid gap-3 p-4" aria-busy="true">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
        ) : query.data.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={t('restaurants.emptyTitle')}
            description={t('restaurants.emptyBody')}
            action={
              <Can permission="restaurants:create">
                <Button size="sm" onClick={() => setEditing('new')}>
                  <Plus aria-hidden /> {t('restaurants.new')}
                </Button>
              </Can>
            }
          />
        ) : (
          <Table aria-label={t('restaurants.title')}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">{t('restaurants.colCode')}</TableHead>
                <TableHead>{t('restaurants.colName')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('restaurants.colCity')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('restaurants.colHours')}</TableHead>
                <TableHead>{t('restaurants.colStatus')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.map((r) => (
                <TableRow
                  key={r.id}
                  data-clickable
                  tabIndex={0}
                  onClick={() => navigate(`/restaurants/${r.id}`)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/restaurants/${r.id}`)}
                >
                  <TableCell className="font-medium tabular">{r.code}</TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {r.city ?? '—'}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground tabular md:table-cell">
                    {r.opensAt && r.closesAt ? `${r.opensAt}–${r.closesAt}` : '—'}
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind="restaurantStatus" value={r.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>
              {editing === 'new' ? t('restaurants.createTitle') : t('restaurants.editTitle')}
            </SheetTitle>
          </SheetHeader>
          <SheetBody>
            {editing !== null && (
              <RestaurantForm
                restaurant={editing === 'new' ? null : editing}
                onDone={() => setEditing(null)}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  )
}
