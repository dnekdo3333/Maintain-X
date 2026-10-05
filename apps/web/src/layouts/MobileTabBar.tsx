import { Menu } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'
import type { NavGroup } from './navigation'

/** The main destinations on a phone, in the order people use them. */
const TAB_KEYS = ['dashboard', 'work-orders', 'requests', 'assets'] as const

/**
 * Bottom tab bar for the admin app on phones (like the MaintainX mobile app).
 * It is only displayed below 1024px — see styles/mobile.css (.m-tabbar); on
 * desktop the sidebar is the navigation.
 */
export function MobileTabBar({ nav, onMenu }: { nav: NavGroup[]; onMenu: () => void }) {
  const { t } = useTranslation()
  const items = nav.flatMap((g) => g.items)
  const tabs = TAB_KEYS.flatMap((k) => items.filter((i) => i.key === k))
  return (
    <nav aria-label={t('nav.mobileTabs')} className="m-tabbar">
      {tabs.map((item) => (
        <NavLink key={item.key} to={item.to} end={item.end} className="m-tab">
          <item.icon aria-hidden className="m-tab-icon" />
          <span className="m-tab-label">{item.label}</span>
          {item.badge ? (
            <span className="m-tab-badge">{item.badge > 99 ? '99+' : item.badge}</span>
          ) : null}
        </NavLink>
      ))}
      <button type="button" className="m-tab" onClick={onMenu}>
        <Menu aria-hidden className="m-tab-icon" />
        <span className="m-tab-label">{t('nav.menu')}</span>
      </button>
    </nav>
  )
}
