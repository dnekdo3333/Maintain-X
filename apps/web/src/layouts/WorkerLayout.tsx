import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet, useMatches } from 'react-router'
import { cn } from '@/utils/cn'
import type { LayoutRouteHandle, NavItem } from './navigation'
import { SkipLink } from './SkipLink'

interface WorkerLayoutProps {
  /** Bottom tab bar items. Keep to 5 or fewer. */
  tabs: NavItem[]
  children?: ReactNode
}

/**
 * Mobile-first worker shell: content column capped at phone width, fixed
 * bottom tab bar with 64px touch targets, iOS safe-area aware. Routes can
 * hide the tab bar with `handle: { hideWorkerNav: true }` for focused flows.
 */
export function WorkerLayout({ tabs, children }: WorkerLayoutProps) {
  const { t } = useTranslation()
  const matches = useMatches()
  const hideNav = matches.some((m) => (m.handle as LayoutRouteHandle | undefined)?.hideWorkerNav)

  return (
    <div className="min-h-dvh bg-canvas">
      <SkipLink />
      <main
        id="main-content"
        tabIndex={-1}
        className={cn(
          'mx-auto min-h-dvh w-full max-w-lg bg-background outline-none sm:border-x',
          hideNav ? 'pb-safe' : 'pb-[calc(4rem+env(safe-area-inset-bottom))]',
        )}
      >
        {children ?? <Outlet />}
      </main>

      {!hideNav && (
        <nav
          aria-label={t('nav.main')}
          className="fixed inset-x-0 bottom-0 z-30 border-t bg-background pb-safe"
        >
          <ul
            className="mx-auto grid max-w-lg"
            style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
          >
            {tabs.map((tab) => (
              <li key={tab.key}>
                <NavLink
                  to={tab.to}
                  end={tab.end}
                  className={({ isActive }) =>
                    cn(
                      'relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium',
                      'transition-colors duration-(--duration-fast)',
                      'focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring',
                      isActive ? 'text-primary' : 'text-muted-foreground active:text-foreground',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span className="relative">
                        <tab.icon
                          aria-hidden
                          className="size-5"
                          strokeWidth={isActive ? 2.25 : 1.75}
                        />
                        {tab.badge ? (
                          <span className="absolute -top-1 -right-2 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 font-semibold text-destructive-foreground tabular">
                            {tab.badge > 9 ? '9+' : tab.badge}
                          </span>
                        ) : null}
                      </span>
                      <span className="max-w-full truncate px-1">{tab.label}</span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  )
}
