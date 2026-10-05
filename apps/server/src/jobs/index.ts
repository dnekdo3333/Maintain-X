import { logger } from '../core/logger.js'
import { prisma } from '../core/prisma.js'
import { runPmGenerator } from '../modules/maintenance/pm-generator.js'
import { pruneNotifications } from '../modules/notifications/notifications.service.js'
import { runAlerts } from './alerts.js'
import { runStorageJobs } from './storage.js'
import { IDEMPOTENCY_TTL_MS } from '../middleware/idempotency.js'

/*
 * In-process background jobs. Each job is idempotent (safe to run twice, or
 * on several server instances at once), so a simple timer is enough.
 */

interface Job {
  name: string
  everyMs: number
  /** Delay before the first run after start-up. */
  firstAfterMs: number
  run: () => Promise<unknown>
}

/** Sessions that expired more than a week ago are no longer needed for reuse detection. */
export async function cleanup() {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000)
  const tokens = await prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: weekAgo } } })
  const notifications = await pruneNotifications()
  const keys = await prisma.idempotencyKey.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - IDEMPOTENCY_TTL_MS) } },
  })
  return { tokens: tokens.count, notifications, idempotencyKeys: keys.count }
}

export const JOBS: Job[] = [
  { name: 'pm-generator', everyMs: 5 * 60_000, firstAfterMs: 5_000, run: () => runPmGenerator() },
  { name: 'alerts', everyMs: 60 * 60_000, firstAfterMs: 30_000, run: () => runAlerts() },
  { name: 'cleanup', everyMs: 24 * 60 * 60_000, firstAfterMs: 60_000, run: cleanup },
  // Shrink old photos, remove expired files, warn before the plan is full.
  { name: 'storage', everyMs: 6 * 60 * 60_000, firstAfterMs: 120_000, run: () => runStorageJobs() },
]

export function startBackgroundJobs(jobs: Job[] = JOBS): () => void {
  const timers: NodeJS.Timeout[] = []
  for (const job of jobs) {
    let running = false
    const tick = async () => {
      if (running) return
      running = true
      const started = Date.now()
      try {
        const result = await job.run()
        logger.debug({ job: job.name, ms: Date.now() - started, result }, 'job finished')
      } catch (err) {
        logger.error({ err, job: job.name }, 'job failed')
      } finally {
        running = false
      }
    }
    const first = setTimeout(() => void tick(), job.firstAfterMs)
    const every = setInterval(() => void tick(), job.everyMs)
    first.unref()
    every.unref()
    timers.push(first, every)
  }
  return () => timers.forEach((t) => clearTimeout(t))
}

/** Every job once, in order (used by the cron endpoint on serverless hosting). */
export async function runAllJobs() {
  const results: Record<string, unknown> = {}
  for (const job of JOBS) {
    try {
      results[job.name] = await job.run()
    } catch (err) {
      logger.error({ err, job: job.name }, 'job failed')
      results[job.name] = { error: true }
    }
  }
  return results
}
