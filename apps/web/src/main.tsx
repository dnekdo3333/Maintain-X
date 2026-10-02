import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/fonts'
import '@/styles/index.css'
import '@/i18n'
import { AppProviders } from '@/app/providers'
import { installZodI18n } from '@/components/forms/zod-i18n'
import { AppRouter } from '@/routes'

installZodI18n()

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>
      <AppRouter />
    </AppProviders>
  </StrictMode>,
)
