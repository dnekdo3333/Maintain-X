import { PrismaClient } from '@prisma/client'
import { env } from '../config/env.js'
import { logger } from './logger.js'

export const prisma = new PrismaClient({
  // Tests exercise failure paths deliberately; keep their output clean.
  log: env.isTest ? [] : env.isDevelopment ? ['warn', 'error'] : ['error'],
})

export interface DatabaseCheck {
  ok: boolean
  latencyMs: number
}

/** Cheap round-trip used by the readiness endpoint. Never throws. */
export async function checkDatabase(timeoutMs = 2000): Promise<DatabaseCheck> {
  const started = performance.now()
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`database check timed out after ${timeoutMs}ms`)),
      timeoutMs,
    )
  })
  try {
    await Promise.race([prisma.$queryRaw`SELECT 1`, timeout])
    return { ok: true, latencyMs: Math.round(performance.now() - started) }
  } catch (err) {
    logger.warn({ err }, 'database check failed')
    return { ok: false, latencyMs: Math.round(performance.now() - started) }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
