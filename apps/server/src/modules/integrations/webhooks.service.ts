import {
  WEBHOOK_SIGNATURE_HEADER,
  type AutomationTrigger,
  type CreatedWebhook,
  type WebhookDto,
  type WebhookEvent,
  type WebhookInput,
} from '@maintainx/shared'
import { createHmac, randomBytes } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { Request } from 'express'
import { env } from '../../config/env.js'
import { recordAudit } from '../../core/audit.js'
import { NotFoundError, ValidationError } from '../../core/errors.js'
import { logger } from '../../core/logger.js'
import { prisma } from '../../core/prisma.js'
import type { AuthContext } from '../auth/auth.context.js'

/*
 * Outgoing webhooks: an HTTPS POST with a JSON body for each event, signed
 * with HMAC-SHA256 ("sha256=<hex>" in X-Bookends-Signature). Private and
 * local addresses are refused, redirects are not followed, each call has a
 * 5 s limit, and a hook that fails 20 times in a row is switched off.
 */

const TIMEOUT_MS = 5_000
const MAX_FAILURES = 20
const MAX_HOOKS = 10

const EVENT_FOR: Partial<Record<AutomationTrigger, WebhookEvent>> = {
  WORK_ORDER_CREATED: 'work_order.created',
  WORK_ORDER_COMPLETED: 'work_order.completed',
  WORK_ORDER_OVERDUE: 'work_order.overdue',
  REQUEST_CREATED: 'request.created',
  INSPECTION_FAILED: 'inspection.failed',
  LOW_STOCK: 'stock.low',
  METER_READING: 'meter.reading',
}

const include = {
  deliveries: { orderBy: { createdAt: 'desc' as const }, take: 5 },
}

type Row = Awaited<ReturnType<typeof prisma.webhook.findFirstOrThrow<{ include: typeof include }>>>

const toDto = (h: Row): WebhookDto => ({
  id: h.id,
  url: h.url,
  events: h.events as WebhookEvent[],
  active: h.active,
  lastStatus: h.lastStatus,
  lastError: h.lastError,
  lastSentAt: h.lastSentAt?.toISOString() ?? null,
  failureCount: h.failureCount,
  createdAt: h.createdAt.toISOString(),
  recent: h.deliveries.map((d) => ({
    event: d.event,
    status: d.status,
    error: d.error,
    createdAt: d.createdAt.toISOString(),
  })),
})

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number]
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    )
  }
  const v = ip.toLowerCase()
  return (
    v === '::1' ||
    v === '::' ||
    v.startsWith('fc') ||
    v.startsWith('fd') ||
    v.startsWith('fe80') ||
    v.startsWith('::ffff:127.') ||
    v.startsWith('::ffff:10.') ||
    v.startsWith('::ffff:192.168.')
  )
}

/** Only public HTTPS hosts: blocks calls into the server's own network. */
async function assertPublicUrl(raw: string) {
  const url = new URL(raw)
  if (url.protocol !== 'https:') throw new ValidationError({ url: ['validation.httpsRequired'] })
  if (env.isTest) return
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true }).catch(() => [])
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address)))
    throw new ValidationError({ url: ['validation.urlNotPublic'] })
}

export async function listWebhooks(auth: AuthContext): Promise<WebhookDto[]> {
  const rows = await prisma.webhook.findMany({
    where: { organizationId: auth.organizationId },
    include,
    orderBy: { createdAt: 'asc' },
  })
  return rows.map(toDto)
}

function audit(auth: AuthContext, action: string, id: string, value: object, req: Request) {
  return recordAudit(
    {
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action,
      entityType: 'SETTING',
      entityId: id,
      newValue: { ...value },
    },
    req,
  )
}

export async function createWebhook(
  auth: AuthContext,
  input: WebhookInput,
  req: Request,
): Promise<CreatedWebhook> {
  await assertPublicUrl(input.url)
  const count = await prisma.webhook.count({ where: { organizationId: auth.organizationId } })
  if (count >= MAX_HOOKS) throw new ValidationError({ url: ['validation.tooMany'] })
  const secret = `whsec_${randomBytes(24).toString('base64url')}`
  const h = await prisma.webhook.create({
    data: {
      organizationId: auth.organizationId,
      url: input.url,
      events: [...new Set(input.events)],
      active: input.active,
      secret,
    },
    include,
  })
  await audit(auth, 'webhook.created', h.id, { url: h.url, events: h.events }, req)
  return { ...toDto(h), secret }
}

async function load(auth: AuthContext, id: string) {
  const h = await prisma.webhook.findFirst({
    where: { id, organizationId: auth.organizationId },
    include,
  })
  if (!h) throw new NotFoundError('Webhook')
  return h
}

export async function updateWebhook(
  auth: AuthContext,
  id: string,
  input: WebhookInput,
  req: Request,
) {
  await load(auth, id)
  await assertPublicUrl(input.url)
  await prisma.webhook.update({
    where: { id },
    data: {
      url: input.url,
      events: [...new Set(input.events)],
      active: input.active,
      // Turning it back on gives it a clean slate.
      ...(input.active ? { failureCount: 0 } : {}),
    },
  })
  await audit(auth, 'webhook.updated', id, { url: input.url, events: input.events, active: input.active }, req)
  return listWebhooks(auth)
}

export async function deleteWebhook(auth: AuthContext, id: string, req: Request) {
  const h = await load(auth, id)
  await prisma.webhook.delete({ where: { id } })
  await audit(auth, 'webhook.deleted', id, { url: h.url }, req)
  return listWebhooks(auth)
}

/** Signature the receiver recomputes over the raw body with its secret. */
export const signBody = (secret: string, body: string) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

async function deliver(
  hook: { id: string; url: string; secret: string },
  event: string,
  payload: object,
) {
  const body = JSON.stringify({ event, occurredAt: new Date().toISOString(), data: payload })
  const started = Date.now()
  let status: number | null = null
  let error: string | null = null
  try {
    await assertPublicUrl(hook.url)
    const res = await fetch(hook.url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Bookends-Maintenance-Webhooks/1',
        [WEBHOOK_SIGNATURE_HEADER]: signBody(hook.secret, body),
        'x-bookends-event': event,
      },
      body,
    })
    status = res.status
    if (!res.ok) error = `HTTP ${res.status}`
  } catch (err) {
    error = err instanceof Error ? err.message.slice(0, 200) : 'Request failed'
  }
  const ok = error === null
  await prisma.$transaction([
    prisma.webhookDelivery.create({
      data: { webhookId: hook.id, event, status, error, durationMs: Date.now() - started },
    }),
    prisma.webhook.update({
      where: { id: hook.id },
      data: {
        lastStatus: status,
        lastError: error,
        lastSentAt: new Date(),
        failureCount: ok ? 0 : { increment: 1 },
      },
    }),
  ])
  if (!ok)
    await prisma.webhook.updateMany({
      where: { id: hook.id, failureCount: { gte: MAX_FAILURES } },
      data: { active: false },
    })
  return { ok, status, error }
}

/** Sends one event to every active hook that wants it. Never throws. */
export async function dispatchWebhooks(
  trigger: AutomationTrigger,
  ctx: { organizationId: string } & Record<string, unknown>,
) {
  const event = EVENT_FOR[trigger]
  if (!event) return
  try {
    const hooks = await prisma.webhook.findMany({
      where: { organizationId: ctx.organizationId, active: true, events: { has: event } },
      select: { id: true, url: true, secret: true },
    })
    if (hooks.length === 0) return
    const { organizationId: _org, fromAutomation: _from, ...data } = ctx
    await Promise.all(hooks.map((h) => deliver(h, event, data)))
  } catch (err) {
    logger.error({ err, trigger }, 'webhook dispatch failed')
  }
}

/** Sends a "ping" so the receiver can check the URL and signature. */
export async function testWebhook(auth: AuthContext, id: string) {
  const h = await load(auth, id)
  const result = await deliver(h, 'ping', { message: 'Test from Bookends Maintenance' })
  return { ...result, webhooks: await listWebhooks(auth) }
}
