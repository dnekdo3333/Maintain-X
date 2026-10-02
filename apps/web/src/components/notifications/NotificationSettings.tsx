import {
  NOTIFICATION_TYPE,
  UNMUTABLE_NOTIFICATIONS,
  type NotificationType,
} from '@maintainx/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/toaster'
import {
  notificationsApi,
  platformKeys,
  useNotificationPreferences,
} from '@/services/platform.service'
import { describeError } from '@/utils/errors'

/** Which alerts the user wants in the app. Critical issues can't be turned off. */
export function NotificationSettings() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const prefs = useNotificationPreferences()

  async function toggle(type: NotificationType, on: boolean) {
    const muted = new Set(prefs.data?.muted ?? [])
    if (on) muted.delete(type)
    else muted.add(type)
    try {
      const next = await notificationsApi.setPreferences([...muted])
      qc.setQueryData(platformKeys.preferences, next)
    } catch (err) {
      toast.error(describeError(err, t))
    }
  }

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>{t('notifications.settings')}</PanelTitle>
      </PanelHeader>
      <PanelBody className="grid gap-1">
        <p className="mb-2 text-13 text-muted-foreground">{t('notifications.settingsHint')}</p>
        {prefs.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          NOTIFICATION_TYPE.map((type) => {
            const locked = UNMUTABLE_NOTIFICATIONS.includes(type)
            const id = `notif-${type}`
            return (
              <div key={type} className="flex min-h-11 items-center justify-between gap-3">
                <label htmlFor={id} className="text-sm">
                  {t(`notifications.type_${type}`)}
                  {locked && (
                    <span className="block text-xs text-muted-foreground">
                      {t('notifications.alwaysOn')}
                    </span>
                  )}
                </label>
                <Switch
                  id={id}
                  checked={locked || !prefs.data?.muted.includes(type)}
                  disabled={locked}
                  onCheckedChange={(on) => void toggle(type, on)}
                />
              </div>
            )
          })
        )}
      </PanelBody>
    </Panel>
  )
}
