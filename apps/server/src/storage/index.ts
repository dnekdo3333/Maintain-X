import { env } from '../config/env.js'
import { LocalStorageProvider } from './local.provider.js'
import { S3StorageProvider } from './s3.provider.js'
import { SupabaseStorageProvider } from './supabase.provider.js'
import type { StorageProvider } from './storage.provider.js'

function createStorage(): StorageProvider {
  if (env.STORAGE_DRIVER === 'local') {
    return new LocalStorageProvider(env.STORAGE_LOCAL_DIR, env.FILE_SIGNING_SECRET)
  }
  if (env.STORAGE_DRIVER === 's3') {
    if (!env.S3_BUCKET) throw new Error('S3_BUCKET is required when STORAGE_DRIVER=s3')
    return new S3StorageProvider({
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      prefix: env.S3_PREFIX,
    })
  }
  if (env.STORAGE_DRIVER === 'supabase') {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when STORAGE_DRIVER=supabase',
      )
    return new SupabaseStorageProvider({
      url: env.SUPABASE_URL,
      serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
      bucket: env.SUPABASE_BUCKET,
    })
  }
  throw new Error(`Unsupported STORAGE_DRIVER: ${String(env.STORAGE_DRIVER)}`)
}

export const storage: StorageProvider = createStorage()
export type { StorageProvider, SignedUrlOptions, StoredObject } from './storage.provider.js'
