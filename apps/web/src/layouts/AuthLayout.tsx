import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet } from 'react-router'
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher'
import { BrandMark } from './BrandMark'

/** Sign-in / password screens: one narrow column, language choice always visible. */
export function AuthLayout({ children }: { children?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="flex h-14 items-center justify-between px-4 sm:px-6">
        <BrandMark />
        <LanguageSwitcher />
      </header>
      <main
        id="main-content"
        className="flex flex-1 items-start justify-center px-4 pt-[8vh] pb-12"
      >
        <div className="w-full max-w-sm">{children ?? <Outlet />}</div>
      </main>
      <footer className="px-4 pb-6 text-center text-xs text-muted-foreground">
        {t('app.tagline')}
      </footer>
    </div>
  )
}
