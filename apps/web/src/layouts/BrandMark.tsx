import { Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/cn'

/** Product mark + name. Plain on purpose; swap the icon for a real logo when available. */
export function BrandMark({ className, subtitle }: { className?: string; subtitle?: string }) {
  const { t } = useTranslation()
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span className="flex size-7 items-center justify-center rounded-md bg-foreground text-background">
        <Wrench className="size-4" aria-hidden />
      </span>
      <span className="grid leading-tight">
        <span className="text-sm font-semibold text-foreground">{t('app.name')}</span>
        {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
      </span>
    </div>
  )
}
