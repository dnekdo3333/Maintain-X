import { Lock, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { Can } from '@/components/common/Can'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useRoles } from '@/hooks/useAdminQueries'
import { enumLabel } from '@/utils/i18n'

export function RolesPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const query = useRoles()

  return (
    <>
      <PageHeader
        title={t('roles.title')}
        description={t('roles.subtitle')}
        actions={
          <Can permission="roles:create">
            <Button asChild>
              <Link to="/roles/new">
                <Plus aria-hidden /> {t('roles.new')}
              </Link>
            </Button>
          </Can>
        }
      />
      <Panel className="overflow-hidden">
        {query.isPending ? (
          <div className="grid gap-3 p-4" aria-busy="true">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
        ) : (
          <Table aria-label={t('roles.title')}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('roles.colName')}</TableHead>
                <TableHead className="hidden sm:table-cell">{t('roles.colApp')}</TableHead>
                <TableHead className="text-right">{t('roles.colUsers')}</TableHead>
                <TableHead className="hidden text-right md:table-cell">
                  {t('roles.colPermissions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.map((role) => (
                <TableRow
                  key={role.id}
                  data-clickable
                  tabIndex={0}
                  onClick={() => navigate(`/roles/${role.id}`)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/roles/${role.id}`)}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{role.name}</span>
                      {role.locked && (
                        <Badge tone="outline">
                          <Lock aria-hidden /> {t('roles.builtIn')}
                        </Badge>
                      )}
                    </div>
                    {role.description && (
                      <p className="text-13 text-muted-foreground">{role.description}</p>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {enumLabel(t, 'roleKind', role.kind)}
                  </TableCell>
                  <TableCell className="text-right tabular">{role.userCount}</TableCell>
                  <TableCell className="hidden text-right text-muted-foreground tabular md:table-cell">
                    {role.permissions.length}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </>
  )
}
