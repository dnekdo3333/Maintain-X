import { Menu } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/utils/cn'
import type { NavGroup } from './navigation'
import { SkipLink } from './SkipLink'

interface AdminLayoutProps {
  nav: NavGroup[]
  /** Top of the sidebar (logo / product name). */
  brand: ReactNode
  /** Left side of the top bar (e.g. restaurant scope switcher, breadcrumbs). */
  headerStart?: ReactNode
  /** Right side of the top bar (notifications, user menu). */
  headerEnd?: ReactNode
  /** Bottom of the sidebar (e.g. signed-in user). */
  sidebarFooter?: ReactNode
  /** Defaults to the nested route <Outlet />. */
  children?: ReactNode
}

function SidebarNav({ nav, onNavigate }: { nav: NavGroup[]; onNavigate?: () => void }) {
  const { t } = useTranslation()
  return (
    <nav aria-label={t('nav.main')} className="flex-1 overflow-y-auto px-3 py-3">
      {nav.map((group) => (
        <div key={group.key} className="mb-4 last:mb-0">
          {group.label && (
            <p className="mb-1 px-2 text-xs font-medium text-muted-foreground">{group.label}</p>
          )}
          <ul className="grid gap-px">
            {group.items.map((item) => (
              <li key={item.key}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'flex h-8 items-center gap-2.5 rounded-md px-2 text-sm text-sidebar-foreground',
                      'transition-colors duration-(--duration-fast) hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                      isActive && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon
                        aria-hidden
                        className={cn(
                          'size-4 shrink-0',
                          isActive ? 'text-foreground' : 'text-muted-foreground',
                        )}
                      />
                      <span className="truncate">{item.label}</span>
                      {item.badge ? (
                        <span className="ml-auto rounded-sm bg-muted px-1.5 text-xs font-medium tabular text-muted-foreground">
                          {item.badge > 99 ? '99+' : item.badge}
                        </span>
                      ) : null}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

/**
 * Desktop shell for Super Admin and Admin: fixed sidebar ≥1024px, slide-in
 * drawer below that. Content area is width-capped for readable tables/forms.
 */
export function AdminLayout({
  nav,
  brand,
  headerStart,
  headerEnd,
  sidebarFooter,
  children,
}: AdminLayoutProps) {
  const { t } = useTranslation()
  const [mobileOpen, setMobileOpen] = useState(false)

  const sidebar = (onNavigate?: () => void) => (
    <>
      <div className="flex h-14 shrink-0 items-center border-b border-sidebar-border px-5">
        {brand}
      </div>
      <SidebarNav nav={nav} onNavigate={onNavigate} />
      {sidebarFooter && (
        <div className="shrink-0 border-t border-sidebar-border p-3">{sidebarFooter}</div>
      )}
    </>
  )

  return (
    <div className="min-h-dvh bg-canvas">
      <SkipLink />

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        {sidebar()}
      </aside>

      <div className="flex min-h-dvh flex-col lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4 lg:px-6">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="-ml-2 lg:hidden"
                aria-label={t('actions.openMenu')}
              >
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 bg-sidebar p-0" aria-describedby={undefined}>
              <SheetTitle className="sr-only">{t('nav.main')}</SheetTitle>
              <div className="flex h-full flex-col">{sidebar(() => setMobileOpen(false))}</div>
            </SheetContent>
          </Sheet>
          <div className="flex min-w-0 flex-1 items-center gap-3">{headerStart}</div>
          {headerEnd && <div className="flex shrink-0 items-center gap-2">{headerEnd}</div>}
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 outline-none lg:px-8"
        >
          {children ?? <Outlet />}
        </main>
      </div>
    </div>
  )
}
