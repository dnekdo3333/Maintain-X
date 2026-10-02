import { expect, test } from '@playwright/test'
import { JOB_TITLE, signIn } from './helpers'

test.describe('worker (phone)', () => {
  test('opens the assigned task, starts it and completes it', async ({ page }) => {
    await signIn(page, 'ravi')
    await expect(page.getByRole('heading', { name: /Ravi/, level: 1 })).toBeVisible()

    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'My Tasks' })
      .click()
    await page.getByRole('link', { name: new RegExp(JOB_TITLE) }).click()

    // Focused task screen: no tab bar, one big action.
    await expect(page.getByRole('heading', { name: JOB_TITLE })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Start task' }).click()
    await expect(page.getByText(/Timer running/)).toBeVisible()

    await page.getByRole('textbox', { name: 'Message' }).fill('Old gasket was torn, replacing now')
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.getByText('Old gasket was torn, replacing now')).toBeVisible()

    await page.getByRole('button', { name: 'Complete' }).click()
    const dialog = page.getByRole('dialog')
    await dialog
      .getByLabel(/Completion notes/)
      .fill('Replaced the door gasket, door seals properly')
    await dialog.getByRole('button', { name: 'Complete' }).click()
    await expect(page.getByText('Sent for review', { exact: true }).first()).toBeVisible()
  })

  test('reports a problem', async ({ page }) => {
    await signIn(page, 'ravi')
    await page.getByRole('link', { name: 'Report a problem' }).click()
    await page.getByRole('radio', { name: 'Plumbing' }).click()
    await page.getByLabel(/What’s wrong/).fill('Hand-wash tap is leaking under the sink')
    await page.getByRole('radio', { name: 'Urgent' }).click()
    await page.getByRole('button', { name: 'Send report' }).click()
    await expect(page).toHaveURL(/\/w\/reports$/)
    await expect(page.getByText('Hand-wash tap is leaking under the sink')).toBeVisible()
  })
})
