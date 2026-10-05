import { config as loadDotenv } from 'dotenv'
import { z } from 'zod'

// Loads apps/server/.env when present. Real environment variables always win.
loadDotenv({ quiet: true })

// On Vercel, fill in what the platform already knows so a fresh deployment
// works with only the secrets and DATABASE_URL configured.
if (process.env.VERCEL) {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL
  if (host) {
    process.env.APP_URL ??= `https://${host}`
    process.env.CORS_ORIGIN ??= `https://${host}`
  }
  process.env.TRUST_PROXY ??= 'true'
  // Only /tmp is writable on Vercel and it isn't shared: use STORAGE_DRIVER=s3 for real files.
  process.env.STORAGE_LOCAL_DIR ??= '/tmp/maintainx-storage'
  // Vercel functions accept request bodies up to 4.5 MB.
  process.env.MAX_UPLOAD_MB ??= '4'
}

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')

const commaSeparated = z
  .string()
  .min(1)
  .transform((s) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  )

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    TRUST_PROXY: booleanString.default(false),

    DATABASE_URL: z
      .string()
      .min(1)
      .refine((s) => s.startsWith('postgresql://') || s.startsWith('postgres://'), {
        message: 'must be a postgresql:// connection string',
      }),

    APP_URL: z.url(),
    CORS_ORIGIN: commaSeparated,

    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    COOKIE_SECURE: booleanString.optional(),

    STORAGE_DRIVER: z.enum(['local', 's3', 'supabase']).default('local'),
    /** Supabase Storage (STORAGE_DRIVER=supabase): project URL, service-role key, private bucket. */
    SUPABASE_URL: z.url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
    SUPABASE_BUCKET: z.string().min(3).default('maintenance-files'),
    STORAGE_LOCAL_DIR: z.string().min(1).default('./storage'),
    FILE_SIGNING_SECRET: z.string().min(32, 'must be at least 32 characters'),
    /** S3-compatible storage (AWS S3, Cloudflare R2). Used when STORAGE_DRIVER=s3. */
    S3_BUCKET: z.string().min(3).optional(),
    S3_REGION: z.string().min(1).default('ap-south-1'),
    S3_ENDPOINT: z.url().optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    S3_FORCE_PATH_STYLE: booleanString.optional(),
    S3_PREFIX: z.string().max(100).optional(),
    MAX_UPLOAD_MB: z.coerce.number().positive().default(25),
    /** Plan limits used for the storage meter and alerts (Supabase free: 1 GB files, 500 MB database). */
    STORAGE_QUOTA_MB: z.coerce.number().positive().default(1024),
    DATABASE_QUOTA_MB: z.coerce.number().positive().default(500),

    /** Protects GET /api/v1/jobs/run (Vercel Cron sends it as a Bearer token). */
    CRON_SECRET: z.string().min(16).optional(),

    /** Email notifications (optional), e.g. smtps://user:pass@smtp.example.com:465 */
    SMTP_URL: z.string().min(8).optional(),
    MAIL_FROM: z.string().min(3).optional(),
    /** Web Push (optional): generate with `npx web-push generate-vapid-keys`. */
    VAPID_PUBLIC_KEY: z.string().min(20).optional(),
    VAPID_PRIVATE_KEY: z.string().min(20).optional(),
    VAPID_SUBJECT: z.string().min(5).optional(),

    /** Sign in with Google (optional): OAuth client from console.cloud.google.com. */
    GOOGLE_CLIENT_ID: z.string().min(10).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(10).optional(),
    /** Sign in with Microsoft (optional): app registration in Microsoft Entra ID. */
    MICROSOFT_CLIENT_ID: z.string().min(10).optional(),
    MICROSOFT_CLIENT_SECRET: z.string().min(10).optional(),
    /** Your directory (tenant) id; only accounts from it can sign in. */
    MICROSOFT_TENANT_ID: z.string().min(3).optional(),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  })
  .transform((e) => ({
    ...e,
    COOKIE_SECURE: e.COOKIE_SECURE ?? e.NODE_ENV === 'production',
    isProduction: e.NODE_ENV === 'production',
    isDevelopment: e.NODE_ENV === 'development',
    isTest: e.NODE_ENV === 'test',
  }))
  .superRefine((e, ctx) => {
    if (e.JWT_ACCESS_SECRET === e.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'must differ from JWT_ACCESS_SECRET',
      })
    }
    if (!!e.VAPID_PUBLIC_KEY !== !!e.VAPID_PRIVATE_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['VAPID_PRIVATE_KEY'],
        message: 'set both VAPID keys (or neither)',
      })
    }
    if (e.SMTP_URL && !/^smtps?:\/\//.test(e.SMTP_URL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_URL'],
        message: 'must start with smtp:// or smtps://',
      })
    }
    if (e.isProduction && !e.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'must be true in production',
      })
    }
  })

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const lines = parsed.error.issues.map(
    (i) => `  - ${i.path.map(String).join('.') || '(root)'}: ${i.message}`,
  )
  // The logger depends on env, so write directly to stderr here.
  process.stderr.write(
    `\nInvalid environment configuration (see apps/server/.env.example):\n${lines.join('\n')}\n\n`,
  )
  process.exit(1)
}

export const env = parsed.data
export type Env = typeof env
