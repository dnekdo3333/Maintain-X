import {
  PRIORITY,
  WORK_ORDER_CATEGORY,
  createWorkOrderSchema,
  type CreateWorkOrderInput,
  type Priority,
  type RestaurantDto,
  type WorkOrderCategory,
  type WorkOrderDetail,
} from '@maintainx/shared'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { MoreOptions } from '@/components/common/MoreOptions'
import {
  DateField,
  Form,
  FormActions,
  FormRootError,
  NumberField,
  SelectField,
  TextField,
  TextareaField,
  applyServerErrors,
  useZodForm,
} from '@/components/forms'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { useAuth } from '@/contexts/AuthContext'
import { useRestaurantScope } from '@/contexts/RestaurantScopeContext'
import { useRestaurants, useTeams, useUserOptions } from '@/hooks/useAdminQueries'
import { useAssets, useLocations } from '@/services/assets.service'
import { useProcedures } from '@/services/maintenance.service'
import { useApplyWorkOrder, workOrdersApi } from '@/services/work-orders.service'
import { describeError } from '@/utils/errors'
import { enumLabel } from '@/utils/i18n'

/** Radix Select can't hold ''; this stands for "none". */
export const NONE = '__none__'

const formSchema = createWorkOrderSchema
  .omit({
    locationId: true,
    assetId: true,
    dueDate: true,
    assignedUserId: true,
    assignedTeamId: true,
    requestId: true,
    procedureId: true,
  })
  .extend({
    procedureId: z.string(),
    locationId: z.string(),
    assetId: z.string(),
    /** 'YYYY-MM-DD' or ''. Due at the end of that day. */
    dueDate: z.string(),
    /** NONE, 'user:<id>' or 'team:<id>'. */
    assignee: z.string(),
  })

/** Values to start a new work order from (a request, an asset page…). */
export interface WorkOrderPrefill {
  title?: string
  description?: string
  category?: WorkOrderCategory
  priority?: Priority
  restaurantId?: string
  locationId?: string | null
  assetId?: string | null
  requestId?: string
  procedureId?: string
}

const toDateInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
/** End of the chosen day, local time, as ISO with offset. */
const toDueIso = (day: string) => (day ? new Date(`${day}T23:59:00`).toISOString() : '')

interface WorkOrderFormProps {
  workOrder?: WorkOrderDetail | null
  prefill?: WorkOrderPrefill
  onDone: (w: WorkOrderDetail) => void
  onCancel: () => void
}

/** Waits for restaurants so selects receive values with their options present. */
export function WorkOrderForm(props: WorkOrderFormProps) {
  const restaurants = useRestaurants()
  if (!restaurants.data) {
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }
  return <WorkOrderFormInner {...props} restaurants={restaurants.data} />
}

function WorkOrderFormInner({
  workOrder,
  prefill = {},
  onDone,
  onCancel,
  restaurants,
}: WorkOrderFormProps & { restaurants: RestaurantDto[] }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const scope = useRestaurantScope()
  const apply = useApplyWorkOrder()
  const editing = !!workOrder
  const canAssign = !editing && can('work_orders:assign')

  const form = useZodForm(formSchema, {
    defaultValues: workOrder
      ? {
          title: workOrder.title,
          description: workOrder.description ?? '',
          category: workOrder.category,
          priority: workOrder.priority,
          restaurantId: workOrder.restaurant.id,
          locationId: workOrder.location?.id ?? NONE,
          assetId: workOrder.asset?.id ?? NONE,
          dueDate: toDateInput(workOrder.dueDate),
          estimatedMinutes: workOrder.estimatedMinutes ?? undefined,
          assignee: NONE,
          procedureId: NONE,
        }
      : {
          title: prefill.title ?? '',
          description: prefill.description ?? '',
          category: prefill.category ?? 'OTHER',
          priority: prefill.priority ?? 'MEDIUM',
          restaurantId:
            prefill.restaurantId ??
            scope.restaurantId ??
            (restaurants.length === 1 ? restaurants[0]!.id : ''),
          locationId: prefill.locationId ?? NONE,
          assetId: prefill.assetId ?? NONE,
          dueDate: '',
          estimatedMinutes: undefined,
          assignee: NONE,
          procedureId: prefill.procedureId ?? NONE,
        },
  })
  const restaurantId = form.watch('restaurantId')
  const locations = useLocations(restaurantId || undefined, !!restaurantId)
  const assets = useAssets({ restaurantId, pageSize: 100, sort: 'name:asc' }, !!restaurantId)
  const users = useUserOptions(restaurantId || undefined, canAssign && !!restaurantId)
  const teams = useTeams()
  const procedures = useProcedures(
    { restaurantId },
    !editing && !!restaurantId && can('procedures:view'),
  )

  // Options from another restaurant aren't valid after switching restaurants.
  useEffect(() => {
    const loc = form.getValues('locationId')
    if (loc !== NONE && locations.data && !locations.data.some((l) => l.id === loc))
      form.setValue('locationId', NONE)
  }, [locations.data, form])
  useEffect(() => {
    const a = form.getValues('assetId')
    if (a !== NONE && assets.data && !assets.data.data.some((x) => x.id === a))
      form.setValue('assetId', NONE)
  }, [assets.data, form])
  useEffect(() => {
    const p = form.getValues('procedureId')
    if (p !== NONE && procedures.data && !procedures.data.some((x) => x.id === p))
      form.setValue('procedureId', NONE)
  }, [procedures.data, form])
  useEffect(() => {
    const v = form.getValues('assignee')
    if (v.startsWith('user:') && users.data && !users.data.some((u) => `user:${u.id}` === v))
      form.setValue('assignee', NONE)
  }, [users.data, form])

  const teamOptions = canAssign
    ? (teams.data ?? []).filter((tm) => !tm.restaurant || tm.restaurant.id === restaurantId)
    : []
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (v) => {
    const base = {
      title: v.title,
      description: v.description,
      category: v.category,
      priority: v.priority,
      restaurantId: v.restaurantId,
      locationId: v.locationId === NONE ? '' : v.locationId,
      assetId: v.assetId === NONE ? '' : v.assetId,
      dueDate: toDueIso(v.dueDate),
      estimatedMinutes: v.estimatedMinutes,
    }
    try {
      let saved: WorkOrderDetail
      if (workOrder) {
        saved = await workOrdersApi.update(workOrder.id, base)
      } else {
        const input: CreateWorkOrderInput = {
          ...base,
          assignedUserId: v.assignee.startsWith('user:') ? v.assignee.slice(5) : '',
          assignedTeamId: v.assignee.startsWith('team:') ? v.assignee.slice(5) : '',
          requestId: prefill.requestId ?? '',
          procedureId: v.procedureId === NONE ? '' : v.procedureId,
        }
        saved = await workOrdersApi.create(input)
      }
      await apply(saved)
      toast.success(editing ? t('wo.saved') : t('wo.created', { code: saved.code }))
      onDone(saved)
    } catch (err) {
      if (
        !applyServerErrors(form, err, {
          assignedUserId: 'assignee',
          assignedTeamId: 'assignee',
        })
      )
        form.setError('root', { message: describeError(err, t) })
    }
  })

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormRootError message={errors.root?.message} />
        <TextField control={form.control} name="title" label={t('wo.fieldTitle')} required />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={form.control}
            name="category"
            label={t('wo.fieldCategory')}
            required
            options={WORK_ORDER_CATEGORY.map((c) => ({
              value: c,
              label: enumLabel(t, 'workOrderCategory', c),
            }))}
          />
          <SelectField
            control={form.control}
            name="priority"
            label={t('wo.fieldPriority')}
            required
            options={PRIORITY.map((p) => ({ value: p, label: enumLabel(t, 'priority', p) }))}
          />
        </div>
        <SelectField
          control={form.control}
          name="restaurantId"
          label={t('wo.fieldRestaurant')}
          required
          disabled={!!prefill.requestId || (editing && workOrder.assignedUser !== null)}
          placeholder={t('validation.selectOption')}
          options={restaurants.map((r) => ({ value: r.id, label: r.name }))}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={form.control}
            name="assetId"
            label={t('wo.fieldAsset')}
            disabled={!restaurantId}
            options={[
              { value: NONE, label: t('wo.noAsset') },
              ...(assets.data?.data ?? []).map((a) => ({
                value: a.id,
                label: `${a.name} · ${a.assetCode}`,
              })),
            ]}
          />
          <SelectField
            control={form.control}
            name="locationId"
            label={t('wo.fieldLocation')}
            disabled={!restaurantId}
            options={[
              { value: NONE, label: t('assets.noLocation') },
              ...(locations.data ?? []).map((l) => ({ value: l.id, label: l.name })),
            ]}
          />
        </div>
        {canAssign && (
          <SelectField
            control={form.control}
            name="assignee"
            label={t('wo.fieldAssignee')}
            disabled={!restaurantId}
            description={t('wo.assigneeHint')}
            options={[
              { value: NONE, label: t('wo.notAssigned') },
              ...(users.data ?? []).map((u) => ({
                value: `user:${u.id}`,
                label: `${u.firstName} ${u.lastName}${u.role ? ` · ${u.role}` : ''}`,
              })),
              ...teamOptions.map((tm) => ({
                value: `team:${tm.id}`,
                label: t('wo.teamOption', { name: tm.name }),
              })),
            ]}
          />
        )}
        <DateField control={form.control} name="dueDate" label={t('wo.fieldDue')} optional />
        {!editing && (procedures.data?.length ?? 0) > 0 && (
          <SelectField
            control={form.control}
            name="procedureId"
            label={t('wo.fieldProcedure')}
            description={t('wo.procedureHint')}
            options={[
              { value: NONE, label: t('wo.noProcedure') },
              ...(procedures.data ?? []).map((p) => ({
                value: p.id,
                label: t('wo.procedureOption', { name: p.name, count: p.stepCount }),
              })),
            ]}
          />
        )}
        <TextareaField
          control={form.control}
          name="description"
          label={t('wo.fieldDescription')}
          optional
          rows={4}
        />
        <MoreOptions forceOpen={!!errors.estimatedMinutes}>
          <NumberField
            control={form.control}
            name="estimatedMinutes"
            label={t('wo.fieldEstimate')}
            min={5}
            step={5}
            suffix={t('wo.minutes')}
          />
        </MoreOptions>
        <FormActions>
          <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {editing ? t('actions.saveChanges') : t('wo.create')}
          </Button>
        </FormActions>
      </form>
    </Form>
  )
}
