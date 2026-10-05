import {
  ROLE_KIND,
  SYSTEM_ROLES,
  roleSchema,
  type Permission,
  type RoleDto,
  type RoleInput,
} from '@maintainx/shared'
import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { PermissionMatrix } from '@/components/admin/PermissionMatrix'
import { allowedPermissions } from '@/components/admin/permission-groups'
import { Callout } from '@/components/common/Callout'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import {
  Form,
  FormActions,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormRootError,
  TextField,
  applyServerErrors,
  useZodForm,
} from '@/components/forms'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Panel, PanelBody } from '@/components/ui/panel'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { useAuth } from '@/contexts/AuthContext'
import { adminKeys, useInvalidatingMutation, useRole } from '@/hooks/useAdminQueries'
import { rolesApi } from '@/services/admin.service'
import { describeError, reportError } from '@/utils/errors'
import { enumLabel } from '@/utils/i18n'

const EMPTY: RoleInput = {
  name: '',
  description: '',
  kind: 'ADMIN',
  permissions: ['dashboard:view'],
}

function RoleForm({ role }: { role: RoleDto | null }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { can } = useAuth()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const locked = role?.locked ?? false
  const builtIn = role?.isSystem ?? false
  const readOnly = locked || !can(role ? 'roles:edit' : 'roles:create')

  const form = useZodForm(roleSchema, {
    defaultValues: role
      ? {
          name: role.name,
          description: role.description ?? '',
          kind: role.kind,
          permissions: role.permissions,
        }
      : EMPTY,
  })
  const kind = form.watch('kind')

  // Switching to the worker app drops permissions that kind of role can't hold.
  useEffect(() => {
    const allowed = allowedPermissions(kind)
    const current = form.getValues('permissions') as Permission[]
    const kept = current.filter((p) => allowed.has(p))
    if (kept.length !== current.length) form.setValue('permissions', kept, { shouldDirty: true })
  }, [kind, form])

  const save = useInvalidatingMutation(
    (input: RoleInput) => (role ? rolesApi.update(role.id, input) : rolesApi.create(input)),
    [adminKeys.roles],
  )
  const remove = useInvalidatingMutation(() => rolesApi.remove(role!.id), [adminKeys.roles])
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await save.mutateAsync(values)
      toast.success(role ? t('roles.saved') : t('roles.created'))
      navigate('/roles')
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })

  const hint =
    role?.systemKey === SYSTEM_ROLES.SUPER_ADMIN
      ? t('roles.superAdminHint')
      : role?.systemKey === SYSTEM_ROLES.WORKER
        ? t('roles.workerHint')
        : null

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="grid gap-5">
        {locked && (
          <Callout tone="neutral" title={t('roles.lockedHint')}>
            {hint}
          </Callout>
        )}
        <FormRootError message={errors.root?.message} />

        <Panel>
          <PanelBody className="grid gap-4 sm:grid-cols-2">
            <TextField
              control={form.control}
              name="name"
              label={t('roles.name')}
              required
              disabled={readOnly || builtIn}
            />
            <TextField
              control={form.control}
              name="description"
              label={t('roles.description')}
              optional
              disabled={readOnly}
            />
            <FormField
              control={form.control}
              name="kind"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>{t('roles.kind')}</FormLabel>
                  <FormControl>
                    <RadioGroup
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={readOnly || builtIn}
                      className="flex flex-wrap gap-4"
                    >
                      {ROLE_KIND.map((k) => (
                        <div key={k} className="flex items-center gap-2">
                          <RadioGroupItem id={`kind-${k}`} value={k} />
                          <Label htmlFor={`kind-${k}`} className="font-normal">
                            {enumLabel(t, 'roleKind', k)}
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </FormControl>
                  <FormDescription>{t('roles.kindHint')}</FormDescription>
                </FormItem>
              )}
            />
          </PanelBody>
        </Panel>

        <FormField
          control={form.control}
          name="permissions"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">{t('roles.permissions')}</h2>
                <span className="text-13 text-muted-foreground tabular">
                  {t('roles.permissionCount', { count: (field.value as Permission[]).length })}
                </span>
              </div>
              <PermissionMatrix
                kind={kind}
                value={field.value as Permission[]}
                onChange={(v) => field.onChange(v)}
                readOnly={readOnly}
              />
              <FormMessage />
            </FormItem>
          )}
        />

        {!readOnly && (
          <FormActions className="justify-between sm:justify-between">
            <div>
              {role && !builtIn && can('roles:delete') && (
                <Button
                  variant="destructive-outline"
                  onClick={() => setConfirmDelete(true)}
                  disabled={role.userCount > 0}
                  title={role.userCount > 0 ? t('roles.inUseHint') : undefined}
                >
                  <Trash2 aria-hidden /> {t('roles.deleteRole')}
                </Button>
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                variant="secondary"
                onClick={() => navigate('/roles')}
                disabled={isSubmitting}
              >
                {t('actions.cancel')}
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {t('roles.save')}
              </Button>
            </div>
          </FormActions>
        )}
        {role && !builtIn && role.userCount > 0 && !readOnly && (
          <p className="text-13 text-muted-foreground">{t('roles.inUseHint')}</p>
        )}
      </form>

      {role && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          tone="destructive"
          title={t('roles.deleteTitle', { name: role.name })}
          description={t('roles.deleteBody')}
          confirmLabel={t('roles.deleteRole')}
          onConfirm={async () => {
            try {
              await remove.mutateAsync()
              toast.success(t('roles.deleted'))
              navigate('/roles', { replace: true })
            } catch (err) {
              reportError(err, t)
              throw err
            }
          }}
        />
      )}
    </Form>
  )
}

export function RoleEditorPage() {
  const { t } = useTranslation()
  const { roleId } = useParams()
  const isNew = roleId === 'new'
  const query = useRole(isNew ? undefined : roleId)
  const title = isNew ? t('roles.createTitle') : (query.data?.name ?? t('roles.editTitle'))

  return (
    <>
      <PageHeader title={title} back={{ to: '/roles', label: t('roles.title') }} />
      <div className="max-w-5xl">
        {isNew ? (
          <RoleForm role={null} />
        ) : query.isPending ? (
          <div className="grid gap-4" aria-busy="true">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <RoleForm key={query.data.id} role={query.data} />
        )}
      </div>
    </>
  )
}
