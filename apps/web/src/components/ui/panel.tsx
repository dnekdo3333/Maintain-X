import type { ComponentProps } from 'react'
import { cn } from '@/utils/cn'

/**
 * Bordered content container. Deliberately plain: hairline border, no shadow,
 * small radius. Use instead of large decorative "cards".
 */
export function Panel({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      data-slot="panel"
      className={cn('rounded-lg border bg-card text-card-foreground', className)}
      {...props}
    />
  )
}

export function PanelHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="panel-header"
      className={cn(
        'flex min-h-12 items-center justify-between gap-3 border-b px-4 py-2.5',
        className,
      )}
      {...props}
    />
  )
}

export function PanelTitle({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 className={cn('text-sm font-semibold text-foreground', className)} {...props} />
}

export function PanelBody({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="panel-body" className={cn('p-4', className)} {...props} />
}

export function PanelFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="panel-footer"
      className={cn('flex items-center justify-end gap-2 border-t px-4 py-3', className)}
      {...props}
    />
  )
}
