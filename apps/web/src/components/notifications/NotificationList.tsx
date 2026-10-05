import { notificationLinkFor, type NotificationDto } from '@maintainx/shared'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlarmClock,
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileWarning,
  Inbox,
  MessageSquare,
  Package,
  ShieldAlert,
  ShoppingCart,
  ThumbsDown,
  ThumbsUp,
  Undo2,
  Ban,
  CalendarRange,
  PlayCircle,
  PackageCheck,
  FileClock,
  Zap,
  AtSign,
  UserMinus,
  Hourglass,
  RotateCcw,
  Gauge,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useAuth } from '@/contexts/AuthContext'
import { notificationsApi, platformKeys } from '@/services/platform.service'
import { cn } from '@/utils/cn'
import { formatRelative } from '@/utils/format'

const ICONS: Record<NotificationDto['type'], LucideIcon> = {
  NEW_REQUEST: Inbox,
  TASK_ASSIGNED: ClipboardList,
  TASK_OVERDUE: AlarmClock,
  PM_DUE: CalendarClock,
  CRITICAL_ISSUE: AlertTriangle,
  LOW_STOCK: Package,
  PO_APPROVAL: ShoppingCart,
  WARRANTY_EXPIRY: ShieldAlert,
  TASK_COMPLETED: CheckCircle2,
  INSPECTION_FAILED: AlertTriangle,
  NEW_MESSAGE: MessageSquare,
  DOCUMENT_EXPIRY: FileWarning,
  REQUEST_APPROVED: ThumbsUp,
  REQUEST_REJECTED: ThumbsDown,
  WORK_REJECTED: Undo2,
  WORK_CANCELLED: Ban,
  WORK_STARTED: PlayCircle,
  WORK_RESCHEDULED: CalendarRange,
  PO_RECEIVED: PackageCheck,
  CONTRACT_EXPIRY: FileClock,
  AUTOMATION: Zap,
  MENTION: AtSign,
  WORK_REASSIGNED: UserMinus,
  DUE_SOON: Hourglass,
  WORK_REOPENED: RotateCcw,
  METER_ALERT: Gauge,
}

/** One list for the bell popover, the admin page and the worker tab. */
export function NotificationList({
  items,
  onNavigate,
  large = false,
}: {
  items: NotificationDto[]
  onNavigate?: () => void
  large?: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuth()
  const isWorker = user?.roleKind === 'WORKER'

  async function open(n: NotificationDto) {
    if (!n.readAt) {
      // Optimistic: the badge drops at once; the server confirms in the background.
      void notificationsApi.read(n.id).finally(() => {
        void qc.invalidateQueries({ queryKey: platformKeys.notifications })
      })
    }
    const to = notificationLinkFor(n.actionUrl, isWorker)
    onNavigate?.()
    if (to) navigate(to)
  }

  return (
    <ul className="divide-y">
      {items.map((n) => {
        const Icon = ICONS[n.type] ?? Bell
        const urgent = n.priority === 'CRITICAL' || n.type === 'CRITICAL_ISSUE'
        return (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => void open(n)}
              className={cn(
                'flex w-full items-start gap-3 px-4 text-left hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                large ? 'py-3.5' : 'py-2.5',
                !n.readAt && 'bg-info-soft/40',
              )}
            >
              <Icon
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  urgent ? 'text-danger-fg' : 'text-muted-foreground',
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-muted-foreground">
                  {t(`notifications.type_${n.type}`)} · {formatRelative(n.createdAt)}
                </span>
                <span className={cn('block truncate text-sm', !n.readAt && 'font-semibold')}>
                  {n.title}
                </span>
                {n.body && (
                  <span className="line-clamp-2 block text-13 text-muted-foreground">{n.body}</span>
                )}
              </span>
              {!n.readAt && (
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary">
                  <span className="sr-only">{t('notifications.unread')}</span>
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
