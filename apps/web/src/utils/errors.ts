import type { TFunction } from 'i18next'
import { ApiError } from '@/services/http'

/** Human-readable, translated message for any thrown value. Never exposes internals. */
export function describeError(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    return t(`errors.${error.code}`, { defaultValue: error.message })
  }
  return t('errors.INTERNAL_ERROR')
}
