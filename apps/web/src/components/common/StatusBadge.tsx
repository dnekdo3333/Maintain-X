import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { enumLabel } from '@/utils/i18n'
import { statusTone, type StatusKind, type StatusValueMap } from '@/utils/status'

interface StatusBadgeProps<K extends StatusKind> {
  kind: K
  value: StatusValueMap[K]
  className?: string
}

/**
 * The only way statuses and priorities are shown. Colour comes from
 * utils/status.ts; label is translated. The dot keeps meaning legible for
 * colour-blind users alongside the text.
 *
 *   <StatusBadge kind="workOrderStatus" value="IN_PROGRESS" />
 *   <StatusBadge kind="priority" value="CRITICAL" />
 */
export function StatusBadge<K extends StatusKind>({ kind, value, className }: StatusBadgeProps<K>) {
  const { t } = useTranslation()
  return (
    <Badge tone={statusTone(kind, value)} dot className={className}>
      {enumLabel(t, kind, value)}
    </Badge>
  )
}
