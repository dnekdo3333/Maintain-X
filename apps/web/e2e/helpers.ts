import { expect, type Page } from '@playwright/test'

export const PASSWORD = 'Correct-Horse-9'
/** Shared between the specs (they run in order: admin → worker → review). */
export const JOB_TITLE = 'E2E: Replace walk-in freezer gasket'

export async function signIn(page: Page, identifier: string) {
  await page.goto('/login')
  await page.getByLabel(/Email, username or phone/).fill(identifier)
  await page.getByLabel(/^Password/).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}
