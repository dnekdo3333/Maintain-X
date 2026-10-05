import { stepIsDone, type ChecklistItemDto } from '@maintainx/shared'
import type { TFunction } from 'i18next'
import { formatNumber } from '@/utils/format'
import { looseT } from '@/utils/i18n'

/** "−25 to −15 °C", "at least 2 bar", "" */
export function rangeLabel(
  i: Pick<ChecklistItemDto, 'minValue' | 'maxValue' | 'unit'>,
  t: TFunction,
): string {
  const tl = looseT(t)
  const u = i.unit ? ` ${i.unit}` : ''
  if (i.minValue !== null && i.maxValue !== null)
    return tl('checklist.rangeBetween', {
      min: formatNumber(i.minValue),
      max: formatNumber(i.maxValue),
      unit: u,
    })
  if (i.minValue !== null)
    return tl('checklist.rangeMin', { min: formatNumber(i.minValue), unit: u })
  if (i.maxValue !== null)
    return tl('checklist.rangeMax', { max: formatNumber(i.maxValue), unit: u })
  return ''
}

export const checklistProgress = (items: ChecklistItemDto[]) => ({
  answered: items.filter((i) => i.result !== null).length,
  /** Steps blocking submission (incl. a required photo that's missing) — same rule as the server. */
  requiredLeft: items.filter((i) => !stepIsDone({ ...i, photoCount: i.attachments.length })).length,
  failed: items.filter((i) => i.result === 'FAIL').length,
})
