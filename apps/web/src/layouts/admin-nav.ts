import type { TFunction } from 'i18next'
import {
  BarChart3,
  Boxes,
  Building2,
  CalendarClock,
  ClipboardCheck,
  ListChecks,
  ScrollText,
  ShoppingCart,
  Truck,
  ClipboardList,
  FileText,
  Inbox,
  LayoutDashboard,
  Package,
  ShieldCheck,
  UserRound,
  Users,
  UsersRound,
} from 'lucide-react'
import type { NavGroup } from './navigation'

/**
 * Admin app navigation. Items appear as their modules are built (no
 * placeholders) and only for users holding the matching `view` permission.
 */
export function adminNavigation(t: TFunction): NavGroup[] {
  return [
    {
      key: 'overview',
      items: [
        {
          key: 'dashboard',
          label: t('nav.dashboard'),
          to: '/',
          end: true,
          icon: LayoutDashboard,
          permission: 'dashboard:view',
        },
      ],
    },
    {
      key: 'work',
      label: t('nav.groupWork'),
      items: [
        {
          key: 'work-orders',
          label: t('nav.workOrders'),
          to: '/work-orders',
          icon: ClipboardList,
          permission: 'work_orders:view',
        },
        {
          key: 'requests',
          label: t('nav.requests'),
          to: '/requests',
          icon: Inbox,
          permission: 'requests:view',
        },
        {
          key: 'maintenance',
          label: t('nav.maintenance'),
          to: '/maintenance',
          icon: CalendarClock,
          permission: 'maintenance:view',
        },
        {
          key: 'inspections',
          label: t('nav.inspections'),
          to: '/inspections',
          icon: ClipboardCheck,
          permission: 'inspections:view',
        },
        {
          key: 'procedures',
          label: t('nav.procedures'),
          to: '/procedures',
          icon: ListChecks,
          permission: 'procedures:view',
        },
      ],
    },
    {
      key: 'purchasing',
      label: t('nav.groupPurchasing'),
      items: [
        {
          key: 'inventory',
          label: t('nav.inventory'),
          to: '/inventory',
          icon: Boxes,
          permission: 'parts:view',
        },
        {
          key: 'purchase-orders',
          label: t('nav.purchaseOrders'),
          to: '/purchase-orders',
          icon: ShoppingCart,
          permission: 'purchase_orders:view',
        },
        {
          key: 'vendors',
          label: t('nav.vendors'),
          to: '/vendors',
          icon: Truck,
          permission: 'vendors:view',
        },
      ],
    },
    {
      key: 'assets',
      label: t('nav.groupAssets'),
      items: [
        {
          key: 'assets',
          label: t('nav.assets'),
          to: '/assets',
          icon: Package,
          permission: 'assets:view',
        },
      ],
    },
    {
      key: 'insights',
      label: t('nav.groupInsights'),
      items: [
        {
          key: 'reports',
          label: t('nav.reports'),
          to: '/reports',
          icon: BarChart3,
          permission: 'reports:view',
        },
      ],
    },
    {
      key: 'organization',
      label: t('nav.groupOrganization'),
      items: [
        {
          key: 'restaurants',
          label: t('nav.restaurants'),
          to: '/restaurants',
          icon: Building2,
          permission: 'restaurants:view',
        },
        {
          key: 'teams',
          label: t('nav.teams'),
          to: '/teams',
          icon: UsersRound,
          permission: 'teams:view',
        },
        {
          key: 'documents',
          label: t('nav.documents'),
          to: '/documents',
          icon: FileText,
          permission: 'documents:view',
        },
      ],
    },
    {
      key: 'administration',
      label: t('nav.groupAdministration'),
      items: [
        {
          key: 'users',
          label: t('nav.users'),
          to: '/users',
          icon: Users,
          permission: 'users:view',
        },
        {
          key: 'roles',
          label: t('nav.roles'),
          to: '/roles',
          icon: ShieldCheck,
          permission: 'roles:view',
        },
        {
          key: 'audit',
          label: t('nav.audit'),
          to: '/audit',
          icon: ScrollText,
          permission: 'audit_logs:view',
        },
      ],
    },
    {
      key: 'you',
      label: t('nav.groupYou'),
      items: [{ key: 'account', label: t('nav.account'), to: '/account', icon: UserRound }],
    },
  ]
}
