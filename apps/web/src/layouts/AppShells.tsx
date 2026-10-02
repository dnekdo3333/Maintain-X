import { Bell, ClipboardList, Home, Menu, ScanLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router'
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher'
import { RestaurantSwitcher } from '@/components/common/RestaurantSwitcher'
import { UserMenu } from '@/components/common/UserMenu'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { useAuth } from '@/contexts/AuthContext'
import { useUnreadCount } from '@/services/platform.service'
import { RestaurantScopeProvider } from '@/contexts/RestaurantScopeContext'
import { AdminLayout } from './AdminLayout'
import { adminNavigation } from './admin-nav'
import { BrandMark } from './BrandMark'
import { filterNavigation, type NavItem } from './navigation'
import { WorkerLayout } from './WorkerLayout'

/*
 * The signed-in app shells. Navigation grows as modules are built:
 * Phase 5 adds the dashboard, Phase 6 the worker tabs.
 */

function useAdminNav() {
  // Cheap to rebuild; recomputing every render keeps labels in the current language.
  const { t } = useTranslation()
  const { can } = useAuth()
  return filterNavigation(adminNavigation(t), can)
}

export function AdminShell() {
  const nav = useAdminNav()
  return (
    <RestaurantScopeProvider>
      <AdminLayout
        nav={nav}
        brand={<BrandMark />}
        headerStart={<RestaurantSwitcher />}
        headerEnd={
          <>
            <LanguageSwitcher className="hidden sm:block" />
            <NotificationBell />
            <UserMenu accountPath="/account" />
          </>
        }
      />
    </RestaurantScopeProvider>
  )
}

/** "/" for users without the dashboard: the first module they can open. */
export function AdminHome() {
  const nav = useAdminNav()
  const first = nav[0]?.items[0]?.to ?? '/account'
  return <Navigate to={first === '/' ? '/account' : first} replace />
}

export function WorkerShell() {
  const { t } = useTranslation()
  const unread = useUnreadCount()
  // Schedule lives under More; alerts get a tab with a badge.
  const tabs: NavItem[] = [
    { key: 'home', label: t('nav.home'), to: '/w', icon: Home, end: true },
    { key: 'tasks', label: t('nav.myTasks'), to: '/w/tasks', icon: ClipboardList },
    { key: 'scan', label: t('nav.scan'), to: '/w/scan', icon: ScanLine },
    {
      key: 'notifications',
      label: t('nav.notifications'),
      to: '/w/notifications',
      icon: Bell,
      badge: unread.data?.count,
    },
    { key: 'more', label: t('nav.more'), to: '/w/more', icon: Menu },
  ]
  return <WorkerLayout tabs={tabs} />
}
