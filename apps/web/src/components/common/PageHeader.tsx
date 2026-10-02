import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { cn } from '@/utils/cn'

interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  /** Primary action(s), right-aligned. Keep to one primary button. */
  actions?: ReactNode
  /** Small link above the title, e.g. back to the list. */
  back?: { to: string; label?: ReactNode }
  /** Meta row under the title (status badge, code, assignee…). */
  meta?: ReactNode
  className?: string
}

export function PageHeader({
  title,
  description,
  actions,
  back,
  meta,
  className,
}: PageHeaderProps) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'flex flex-col gap-3 pb-5 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        {back && (
          <Link
            to={back.to}
            className="mb-2 inline-flex items-center gap-1 text-13 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            {back.label ?? t('actions.back')}
          </Link>
        )}
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {meta && <div className="mt-1.5 flex flex-wrap items-center gap-2">{meta}</div>}
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
