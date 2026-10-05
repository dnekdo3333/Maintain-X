import {
  FREQUENCY,
  PRIORITY,
  WORK_ORDER_CATEGORY,
  type PmScheduleDetail,
  type PmScheduleInput,
  type RestaurantDto,
} from '@maintainx/shared'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { MoreOptions } from '@/components/common/MoreOptions'
import {
  DateField,
  Form,
  FormActions,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormRootError,
  NumberField,
  SelectField,
  TextField,
  TextareaField,
  applyServerErrors,
  useZodForm,
} from '@/components/forms'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { NONE } from '@/components/work-orders/WorkOrderForm'
import { useAuth } from '@/contexts/AuthContext'
import { useRestaurantScope } from '@/contexts/RestaurantScopeContext'
import {
  useInvalidatingMutation,
  useRestaurants,
  useTeams,
  useUserOptions,
} from '@/hooks/useAdminQueries'
import { useAssets } from '@/services/assets.service'
import { mxKeys, pmApi, useProcedures } from '@/services/maintenance.service'
import { cn } from '@/utils/cn'
import { describeError } from '@/utils/errors'
import { enumLabel } from '@/utils/i18n'
import { weekdayNames } from './schedule-text'

const formSchema = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2000),
  restaurantId: z.string().min(1, 'validation.selectOption'),
  assetId: z.string(),
  frequency: z.enum(FREQUENCY),
  intervalDays: z.number().int().min(1).max(365).optional(),
  daysOfWeek: z.array(z.number()),
  dayOfMonth: z.number().int().min(1).max(28).optional(),
  timeOfDay: z.string(),
  procedureId: z.string(),
  category: z.enum(WORK_ORDER_CATEGORY),
  priority: z.enum(PRIORITY),
  assignee: z.string(),
  estimatedMinutes: z.number().int().min(5).max(10_080).optional(),
  leadTimeDays: z.number().int().min(0).max(30),
  startDate: z.string().min(1, 'validation.required'),
  endDate: z.string(),
})
type Values = z.infer<typeof formSchema>

const todayLocal = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function fromSchedule(s: PmScheduleDetail): Values {
  return {
    name: s.name,
    description: s.description ?? '',
    restaurantId: s.restaurant.id,
    assetId: s.asset?.id ?? NONE,
    frequency: s.frequency,
    intervalDays: s.intervalDays ?? undefined,
    daysOfWeek: s.daysOfWeek,
    dayOfMonth: s.dayOfMonth ?? undefined,
    timeOfDay: s.timeOfDay ?? '',
    procedureId: s.procedure?.id ?? NONE,
    category: s.category,
    priority: s.priority,
    assignee: s.assignedUser
      ? `user:${s.assignedUser.id}`
      : s.assignedTeam
        ? `team:${s.assignedTeam.id}`
        : NONE,
    estimatedMinutes: s.estimatedMinutes ?? undefined,
    leadTimeDays: s.leadTimeDays,
    startDate: s.startDate,
    endDate: s.endDate ?? '',
  }
}

function toInput(v: Values): PmScheduleInput {
  return {
    name: v.name,
    description: v.description,
    restaurantId: v.restaurantId,
    assetId: v.assetId === NONE ? '' : v.assetId,
    frequency: v.frequency,
    intervalDays: v.intervalDays,
    daysOfWeek: v.daysOfWeek,
    dayOfMonth: v.dayOfMonth,
    timeOfDay: v.timeOfDay,
    procedureId: v.procedureId === NONE ? '' : v.procedureId,
    category: v.category,
    priority: v.priority,
    assignedUserId: v.assignee.startsWith('user:') ? v.assignee.slice(5) : '',
    assignedTeamId: v.assignee.startsWith('team:') ? v.assignee.slice(5) : '',
    estimatedMinutes: v.estimatedMinutes,
    leadTimeDays: v.leadTimeDays,
    startDate: v.startDate,
    endDate: v.endDate,
  }
}

interface Props {
  schedule?: PmScheduleDetail | null
  /** Prefill (e.g. from an asset page). */
  assetId?: string | null
  restaurantId?: string | null
  onDone: (s: PmScheduleDetail) => void
  onCancel: () => void
}

/** Waits for restaurants so selects get values with options present. */
export function PmScheduleForm(props: Props) {
  const restaurants = useRestaurants()
  if (!restaurants.data)
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    )
  return <Inner {...props} restaurants={restaurants.data} />
}

function Inner({
  schedule,
  assetId,
  restaurantId: presetRestaurant,
  onDone,
  onCancel,
  restaurants,
}: Props & { restaurants: RestaurantDto[] }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const scope = useRestaurantScope()
  const canAssign = can('maintenance:assign')

  const form = useZodForm(formSchema, {
    defaultValues: schedule
      ? fromSchedule(schedule)
      : {
          name: '',
          description: '',
          restaurantId:
            presetRestaurant ??
            scope.restaurantId ??
            (restaurants.length === 1 ? restaurants[0]!.id : ''),
          assetId: assetId ?? NONE,
          frequency: 'MONTHLY',
          intervalDays: undefined,
          daysOfWeek: [],
          dayOfMonth: 1,
          timeOfDay: '',
          procedureId: NONE,
          category: 'OTHER',
          priority: 'MEDIUM',
          assignee: NONE,
          estimatedMinutes: undefined,
          leadTimeDays: 0,
          startDate: todayLocal(),
          endDate: '',
        },
  })
  const restaurantId = form.watch('restaurantId')
  const frequency = form.watch('frequency')
  const assets = useAssets({ restaurantId, pageSize: 100, sort: 'name:asc' }, !!restaurantId)
  const procedures = useProcedures({ restaurantId }, !!restaurantId)
  const users = useUserOptions(restaurantId || undefined, canAssign && !!restaurantId)
  const teams = useTeams()

  // Options from another restaurant aren't valid after switching restaurants.
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

  const save = useInvalidatingMutation(
    (input: PmScheduleInput) => (schedule ? pmApi.update(schedule.id, input) : pmApi.create(input)),
    [mxKeys.pm, mxKeys.procedures],
  )
  const { errors, isSubmitting } = form.formState
  const advancedError = Boolean(
    errors.leadTimeDays || errors.endDate || errors.estimatedMinutes || errors.description,
  )

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const saved = await save.mutateAsync(toInput(v))
      toast.success(schedule ? t('pm.saved') : t('pm.created'))
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

  const days = weekdayNames()
  const teamOptions = (teams.data ?? []).filter(
    (tm) => !tm.restaurant || tm.restaurant.id === restaurantId,
  )

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormRootError message={errors.root?.message} />
        <TextField
          control={form.control}
          name="name"
          label={t('pm.fieldName')}
          placeholder={t('pm.namePlaceholder')}
          required
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={form.control}
            name="restaurantId"
            label={t('wo.fieldRestaurant')}
            required
            placeholder={t('validation.selectOption')}
            options={restaurants.map((r) => ({ value: r.id, label: r.name }))}
          />
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
        </div>

        <fieldset className="grid gap-4 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">{t('pm.repeat')}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              control={form.control}
              name="frequency"
              label={t('pm.fieldFrequency')}
              required
              options={FREQUENCY.map((f) => ({ value: f, label: enumLabel(t, 'frequency', f) }))}
            />
            {(frequency === 'YEARLY' || frequency === 'ONCE') && (
              <p className="self-end pb-2 text-13 text-muted-foreground">
                {frequency === 'YEARLY' ? t('pm.yearlyHint') : t('pm.onceHint')}
              </p>
            )}
            {frequency === 'CUSTOM' && (
              <NumberField
                control={form.control}
                name="intervalDays"
                label={t('pm.fieldInterval')}
                required
                min={1}
                max={365}
                suffix={t('pm.days')}
              />
            )}
            {(frequency === 'MONTHLY' || frequency === 'QUARTERLY') && (
              <NumberField
                control={form.control}
                name="dayOfMonth"
                label={t('pm.fieldDayOfMonth')}
                description={t('pm.dayOfMonthHint')}
                required
                min={1}
                max={28}
              />
            )}
          </div>
          {frequency === 'WEEKLY' && (
            <FormField
              control={form.control}
              name="daysOfWeek"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t('pm.fieldDays')}</FormLabel>
                  <FormControl>
                    <div className="flex flex-wrap gap-1.5" role="group">
                      {days.map((name, i) => {
                        const on = field.value.includes(i)
                        return (
                          <button
                            key={i}
                            type="button"
                            aria-pressed={on}
                            onClick={() =>
                              field.onChange(
                                on ? field.value.filter((d) => d !== i) : [...field.value, i],
                              )
                            }
                            className={cn(
                              'h-9 min-w-12 rounded-md border px-2 text-sm font-medium',
                              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                              on
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'bg-background hover:bg-accent',
                            )}
                          >
                            {name}
                          </button>
                        )
                      })}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <DateField
              control={form.control}
              name="startDate"
              label={t('pm.fieldStart')}
              required
            />
            <FormField
              control={form.control}
              name="timeOfDay"
              render={({ field }) => (
                <FormItem>
                  <FormLabel optional>{t('pm.fieldTime')}</FormLabel>
                  <FormControl>
                    <Input
                      type="time"
                      name={field.name}
                      ref={field.ref}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      className="tabular"
                    />
                  </FormControl>
                  <FormDescription>{t('pm.timeHint')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={form.control}
            name="category"
            label={t('wo.fieldCategory')}
            options={WORK_ORDER_CATEGORY.map((c) => ({
              value: c,
              label: enumLabel(t, 'workOrderCategory', c),
            }))}
          />
          <SelectField
            control={form.control}
            name="priority"
            label={t('wo.fieldPriority')}
            options={PRIORITY.map((p) => ({ value: p, label: enumLabel(t, 'priority', p) }))}
          />
        </div>
        <SelectField
          control={form.control}
          name="procedureId"
          label={t('wo.fieldProcedure')}
          description={t('pm.procedureHint')}
          disabled={!restaurantId}
          options={[
            { value: NONE, label: t('wo.noProcedure') },
            ...(procedures.data ?? []).map((p) => ({
              value: p.id,
              label: t('wo.procedureOption', { name: p.name, count: p.stepCount }),
            })),
          ]}
        />
        {canAssign && (
          <SelectField
            control={form.control}
            name="assignee"
            label={t('pm.fieldAssignee')}
            description={t('pm.assigneeHint')}
            disabled={!restaurantId}
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
        <MoreOptions forceOpen={advancedError} defaultOpen={!!schedule}>
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField
              control={form.control}
              name="leadTimeDays"
              label={t('pm.fieldLead')}
              description={t('pm.leadHint')}
              min={0}
              max={30}
              suffix={t('pm.days')}
            />
            <DateField control={form.control} name="endDate" label={t('pm.fieldEnd')} optional />
            <NumberField
              control={form.control}
              name="estimatedMinutes"
              label={t('wo.fieldEstimate')}
              min={5}
              step={5}
              suffix={t('wo.minutes')}
            />
          </div>
          <TextareaField
            control={form.control}
            name="description"
            label={t('pm.fieldInstructions')}
            rows={3}
          />
        </MoreOptions>
        <FormActions>
          <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {schedule ? t('actions.saveChanges') : t('pm.create')}
          </Button>
        </FormActions>
      </form>
    </Form>
  )
}
