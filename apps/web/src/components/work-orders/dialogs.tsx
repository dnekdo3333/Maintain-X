import { ASSET_STATUS, type AssetStatus, type WorkOrderDetail } from '@maintainx/shared'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import {
  Form,
  FormActions,
  FormRootError,
  SelectField,
  TextareaField,
  applyServerErrors,
  useZodForm,
} from '@/components/forms'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useTeams, useUserOptions } from '@/hooks/useAdminQueries'
import { describeError } from '@/utils/errors'
import { enumLabel } from '@/utils/i18n'
import { NONE } from './WorkOrderForm'

interface DialogBaseProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * One text box and a confirm button: hold reason, reopen reason, rejection
 * reason, closing note. `minLength` 0 makes the text optional.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  confirmLabel,
  minLength = 3,
  tone = 'default',
  onSubmit,
}: DialogBaseProps & {
  title: string
  description?: ReactNode
  label: string
  confirmLabel: string
  minLength?: number
  tone?: 'default' | 'destructive'
  onSubmit: (text: string) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const form = useZodForm(z.object({ text: z.string().trim().min(minLength).max(500) }), {
    defaultValues: { text: '' },
  })
  const { errors, isSubmitting } = form.formState
  const submit = form.handleSubmit(async ({ text }) => {
    try {
      await onSubmit(text)
      form.reset({ text: '' })
      onOpenChange(false)
    } catch (err) {
      form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="grid gap-4">
            <FormRootError message={errors.root?.message} />
            <TextareaField
              control={form.control}
              name="text"
              label={label}
              required={minLength > 0}
              optional={minLength === 0}
              rows={3}
              maxLength={500}
            />
            <FormActions>
              <Button
                variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                {t('actions.cancel')}
              </Button>
              <Button
                type="submit"
                variant={tone === 'destructive' ? 'destructive' : 'default'}
                loading={isSubmitting}
              >
                {confirmLabel}
              </Button>
            </FormActions>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

const completeForm = z.object({
  notes: z.string().trim().min(3).max(5000),
  assetStatus: z.string(),
})

/** Completion notes, and (when the task has an asset) the asset's state afterwards. */
export function CompleteDialog({
  open,
  onOpenChange,
  workOrder,
  onSubmit,
}: DialogBaseProps & {
  workOrder: WorkOrderDetail
  onSubmit: (v: { notes: string; assetStatus: AssetStatus | '' }) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const form = useZodForm(completeForm, {
    defaultValues: { notes: '', assetStatus: workOrder.asset ? 'OPERATIONAL' : NONE },
  })
  const { errors, isSubmitting } = form.formState
  const submit = form.handleSubmit(async (v) => {
    try {
      await onSubmit({
        notes: v.notes,
        assetStatus: v.assetStatus === NONE ? '' : (v.assetStatus as AssetStatus),
      })
      onOpenChange(false)
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('wo.completeTitle')}</DialogTitle>
          <DialogDescription>{t('wo.completeBody')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="grid gap-4">
            <FormRootError message={errors.root?.message} />
            <TextareaField
              control={form.control}
              name="notes"
              label={t('wo.completionNotes')}
              placeholder={t('wo.completionPlaceholder')}
              required
              rows={4}
            />
            {workOrder.asset && (
              <SelectField
                control={form.control}
                name="assetStatus"
                label={t('wo.assetAfter', { name: workOrder.asset.name })}
                options={[
                  { value: NONE, label: t('wo.assetUnchanged') },
                  ...ASSET_STATUS.filter((s) => s !== 'RETIRED').map((s) => ({
                    value: s,
                    label: enumLabel(t, 'assetStatus', s),
                  })),
                ]}
              />
            )}
            <FormActions>
              <Button
                variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                {t('actions.cancel')}
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {t('wo.complete')}
              </Button>
            </FormActions>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

/** Pick a person or a team from the work order's restaurant. */
export function AssignDialog({
  open,
  onOpenChange,
  workOrder,
  onSubmit,
}: DialogBaseProps & {
  workOrder: WorkOrderDetail
  onSubmit: (v: { assignedUserId: string; assignedTeamId: string }) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const users = useUserOptions(workOrder.restaurant.id, open)
  const teams = useTeams()
  const ready = users.data && teams.data
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('wo.assignTitle')}</DialogTitle>
          <DialogDescription>
            {workOrder.code} · {workOrder.restaurant.name}
          </DialogDescription>
        </DialogHeader>
        {ready ? (
          <AssignFormInner
            initial={
              workOrder.assignedUser
                ? `user:${workOrder.assignedUser.id}`
                : workOrder.assignedTeam
                  ? `team:${workOrder.assignedTeam.id}`
                  : ''
            }
            options={[
              ...users.data.map((u) => ({
                value: `user:${u.id}`,
                label: `${u.firstName} ${u.lastName}${u.role ? ` · ${u.role}` : ''}`,
              })),
              ...teams.data
                .filter((tm) => !tm.restaurant || tm.restaurant.id === workOrder.restaurant.id)
                .map((tm) => ({
                  value: `team:${tm.id}`,
                  label: t('wo.teamOption', { name: tm.name }),
                })),
            ]}
            onCancel={() => onOpenChange(false)}
            onSubmit={async (v) => {
              await onSubmit({
                assignedUserId: v.startsWith('user:') ? v.slice(5) : '',
                assignedTeamId: v.startsWith('team:') ? v.slice(5) : '',
              })
              onOpenChange(false)
            }}
          />
        ) : (
          <Skeleton className="h-20 w-full" />
        )}
      </DialogContent>
    </Dialog>
  )
}

function AssignFormInner({
  initial,
  options,
  onCancel,
  onSubmit,
}: {
  initial: string
  options: Array<{ value: string; label: string }>
  onCancel: () => void
  onSubmit: (assignee: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const form = useZodForm(
    z.object({ assignee: z.string().min(1, 'validation.assigneeRequired') }),
    {
      defaultValues: { assignee: options.some((o) => o.value === initial) ? initial : '' },
    },
  )
  const { errors, isSubmitting } = form.formState
  const submit = form.handleSubmit(async ({ assignee }) => {
    try {
      await onSubmit(assignee)
    } catch (err) {
      form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Form {...form}>
      <form onSubmit={submit} noValidate className="grid gap-4">
        <FormRootError message={errors.root?.message} />
        <SelectField
          control={form.control}
          name="assignee"
          label={t('wo.fieldAssignee')}
          required
          placeholder={t('validation.selectOption')}
          description={t('wo.assigneeHint')}
          options={options}
        />
        <FormActions>
          <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {t('wo.assign')}
          </Button>
        </FormActions>
      </form>
    </Form>
  )
}
