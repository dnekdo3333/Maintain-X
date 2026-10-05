import type { NotificationType } from '@maintainx/shared'
import nodemailer, { type Transporter } from 'nodemailer'
import webpush from 'web-push'
import { env } from '../config/env.js'
import { logger } from './logger.js'
import { prisma } from './prisma.js'

/*
 * Delivery beyond the in-app notification centre:
 *  - email, when SMTP_URL is configured and the user turned email on for that type;
 *  - Web Push, when VAPID keys are configured and the user allowed it in a browser.
 * Both are best effort and run after the request: a mail server or push
 * service being down never fails the action that caused the notification.
 */

export const emailEnabled = () => !!env.SMTP_URL
export const pushEnabled = () => !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)

let transport: Transporter | null = null
function mailer(): Transporter | null {
  if (!env.SMTP_URL) return null
  transport ??= nodemailer.createTransport(env.SMTP_URL)
  return transport
}

let vapidReady = false
function push(): typeof webpush | null {
  if (!pushEnabled()) return null
  if (!vapidReady) {
    webpush.setVapidDetails(
      env.VAPID_SUBJECT ?? `mailto:${env.MAIL_FROM ?? 'admin@example.com'}`,
      env.VAPID_PUBLIC_KEY!,
      env.VAPID_PRIVATE_KEY!,
    )
    vapidReady = true
  }
  return webpush
}

export interface Delivery {
  type: NotificationType
  title: string
  body: string | null
  actionUrl: string
}

const absolute = (url: string) => new URL(url, env.APP_URL).toString()

async function sendEmails(userIds: string[], d: Delivery) {
  const m = mailer()
  if (!m) return
  const prefs = await prisma.notificationPreference.findMany({
    where: { userId: { in: userIds }, type: d.type, email: true },
    select: { user: { select: { email: true, status: true, archivedAt: true } } },
  })
  const to = prefs
    .map((p) => p.user)
    .filter((u) => u.email && u.status === 'ACTIVE' && !u.archivedAt)
    .map((u) => u.email!)
  for (const address of to) {
    await m.sendMail({
      from: env.MAIL_FROM ?? 'Bookends Maintenance <no-reply@localhost>',
      to: address,
      subject: d.title,
      text: [d.body, absolute(d.actionUrl)].filter(Boolean).join('\n\n'),
    })
  }
}

async function sendPushes(userIds: string[], d: Delivery) {
  const p = push()
  if (!p) return
  const subs = await prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } })
  const payload = JSON.stringify({ title: d.title, body: d.body ?? '', url: d.actionUrl })
  for (const s of subs) {
    try {
      await p.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        {
          TTL: 3600,
        },
      )
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      // The browser dropped the subscription: forget it.
      if (status === 404 || status === 410)
        await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined)
      else logger.warn({ err, subscription: s.id }, 'push failed')
    }
  }
}

/** Fire-and-forget external delivery for users who already got the in-app notification. */
export function deliverExternally(userIds: string[], d: Delivery): void {
  if (userIds.length === 0 || (!emailEnabled() && !pushEnabled())) return
  setImmediate(() => {
    Promise.all([sendEmails(userIds, d), sendPushes(userIds, d)]).catch((err: unknown) =>
      logger.error({ err }, 'notification delivery failed'),
    )
  })
}
