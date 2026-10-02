import type { PmScheduleListItem } from '@maintainx/shared'
import type { TFunction } from 'i18next'
import { intlLocale } from '@/utils/format'

/** Short weekday names in the current language, Sunday first. */
export function weekdayNames(style: 'short' | 'long' = 'short'): string[] {
  const fmt = new Intl.DateTimeFormat(intlLocale(), { weekday: style, timeZone: 'UTC' })
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2023, 0, 1 + i))))
}

/** "Every day at 10:00", "Weekly on Mon, Fri", "Every 10 days" … */
export function describeSchedule(
  t: TFunction,
  s: Pick<
    PmScheduleListItem,
    'frequency' | 'intervalDays' | 'daysOfWeek' | 'dayOfMonth' | 'timeOfDay'
  >,
): string {
  let base: string
  switch (s.frequency) {
    case 'DAILY':
      base = t('pm.everyDay')
      break
    case 'WEEKLY': {
      const names = weekdayNames()
      base = t('pm.weeklyOn', { days: s.daysOfWeek.map((d) => names[d]).join(', ') })
      break
    }
    case 'MONTHLY':
      base = t('pm.monthlyOn', { day: s.dayOfMonth ?? 1 })
      break
    case 'QUARTERLY':
      base = t('pm.quarterlyOn', { day: s.dayOfMonth ?? 1 })
      break
    default:
      base = t('pm.everyNDays', { count: s.intervalDays ?? 1 })
  }
  return s.timeOfDay ? t('pm.atTime', { base, time: s.timeOfDay }) : base
}
