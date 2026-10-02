import {
  LOCATION_TYPE,
  locationSchema,
  type LocationDto,
  type LocationInput,
} from '@maintainx/shared'
import { MapPin, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Can } from '@/components/common/Can'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
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
import { toast } from '@/components/ui/toaster'
import { useInvalidatingMutation } from '@/hooks/useAdminQueries'
import { assetKeys, locationsApi, useLocations } from '@/services/assets.service'
import { describeError } from '@/utils/errors'
import { enumLabel } from '@/utils/i18n'

function LocationForm({
  restaurantId,
  location,
  onDone,
}: {
  restaurantId: string
  location: LocationDto | null
  onDone: () => void
}) {
  const { t } = useTranslation()
  const form = useZodForm(locationSchema, {
    defaultValues: location
      ? {
          restaurantId,
          name: location.name,
          type: location.type,
          description: location.description ?? '',
        }
      : { restaurantId, name: '', type: 'KITCHEN', description: '' },
  })
  const save = useInvalidatingMutation(
    (v: LocationInput) => (location ? locationsApi.update(location.id, v) : locationsApi.create(v)),
    [assetKeys.locationsAll],
  )
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await save.mutateAsync(values)
      toast.success(t('locations.saved'))
      onDone()
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormRootError message={errors.root?.message} />
        <TextField
          control={form.control}
          name="name"
          label={t('locations.name')}
          required
          placeholder="Hot kitchen"
        />
        <SelectField
          control={form.control}
          name="type"
          label={t('locations.type')}
          options={LOCATION_TYPE.map((v) => ({ value: v, label: enumLabel(t, 'locationType', v) }))}
        />
        <TextField
          control={form.control}
          name="description"
          label={t('locations.description')}
          optional
        />
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

export function LocationsPanel({ restaurantId }: { restaurantId: string }) {
  const { t } = useTranslation()
  const query = useLocations(restaurantId)
  const [editing, setEditing] = useState<LocationDto | 'new' | null>(null)
  const [archiving, setArchiving] = useState<LocationDto | null>(null)
  const archive = useInvalidatingMutation(locationsApi.archive, [assetKeys.locationsAll])

  const addButton = (
    <Can permission="locations:create">
      <Button size="sm" onClick={() => setEditing('new')}>
        <Plus aria-hidden /> {t('locations.new')}
      </Button>
    </Can>
  )

  return (
    <>
      {query.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
      ) : query.data.length === 0 ? (
        <Panel>
          <EmptyState
            icon={MapPin}
            title={t('locations.emptyTitle')}
            description={t('locations.emptyBody')}
            action={addButton}
          />
        </Panel>
      ) : (
        <div className="grid gap-3">
          <div className="flex justify-end">{addButton}</div>
          <Panel>
            <ul className="divide-y">
              {query.data.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{l.name}</p>
                    <p className="text-13 text-muted-foreground">
                      {enumLabel(t, 'locationType', l.type)} ·{' '}
                      {t('locations.assets', { count: l.assetCount })}
                      {l.description && ` · ${l.description}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Can permission="locations:edit">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${t('actions.edit')}: ${l.name}`}
                        onClick={() => setEditing(l)}
                      >
                        <Pencil />
                      </Button>
                    </Can>
                    <Can permission="locations:delete">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${t('locations.archive')}: ${l.name}`}
                        title={l.assetCount > 0 ? t('locations.inUse') : undefined}
                        disabled={l.assetCount > 0}
                        onClick={() => setArchiving(l)}
                      >
                        <Trash2 />
                      </Button>
                    </Can>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>
              {editing === 'new' ? t('locations.createTitle') : t('locations.editTitle')}
            </SheetTitle>
          </SheetHeader>
          <SheetBody>
            {editing !== null && (
              <LocationForm
                restaurantId={restaurantId}
                location={editing === 'new' ? null : editing}
                onDone={() => setEditing(null)}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(o) => !o && setArchiving(null)}
        tone="destructive"
        title={t('locations.archiveTitle', { name: archiving?.name ?? '' })}
        description={t('locations.archiveBody')}
        confirmLabel={t('locations.archive')}
        onConfirm={async () => {
          try {
            await archive.mutateAsync(archiving!.id)
            toast.success(t('locations.archived'))
          } catch (err) {
            toast.error(describeError(err, t))
            throw err
          }
        }}
      />
    </>
  )
}
