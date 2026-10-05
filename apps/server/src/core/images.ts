import sharp from 'sharp'
import { logger } from './logger.js'

/*
 * Photos are stored small so years of evidence fit in the storage plan:
 *   new photo   longest side 1280px, WebP q72   (~60–120 KB)
 *   thumbnail   longest side 320px,  WebP q60   (~8–15 KB) for lists and galleries
 *   after 6 months the full photo is re-saved at 800px, WebP q55 (~30–50 KB)
 * EXIF orientation is applied and metadata (GPS etc.) dropped.
 */

export const PHOTO = { side: 1280, quality: 72 }
export const THUMB = { side: 320, quality: 60 }
export const COMPACT = { side: 800, quality: 55 }

export interface OptimizedPhoto {
  main: Buffer
  thumb: Buffer
  width: number
  height: number
}

async function toWebp(input: Buffer, side: number, quality: number) {
  const { data, info } = await sharp(input, { failOn: 'none' })
    .rotate()
    .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
    .webp({ quality, effort: 4 })
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

/** Resized WebP + thumbnail; null when the image can't be decoded (stored as-is). */
export async function optimizePhoto(input: Buffer): Promise<OptimizedPhoto | null> {
  try {
    const main = await toWebp(input, PHOTO.side, PHOTO.quality)
    const thumb = await toWebp(main.data, THUMB.side, THUMB.quality)
    // Never make a small upload bigger.
    const keepOriginal = main.data.length >= input.length && input.length < 150 * 1024
    return {
      main: keepOriginal ? input : main.data,
      thumb: thumb.data,
      width: main.width,
      height: main.height,
    }
  } catch (err) {
    logger.warn({ err }, 'photo could not be optimised; storing original')
    return null
  }
}

/** Smaller copy for photos older than the compaction age. */
export async function compactPhoto(input: Buffer): Promise<Buffer | null> {
  try {
    const out = await toWebp(input, COMPACT.side, COMPACT.quality)
    return out.data.length < input.length ? out.data : null
  } catch (err) {
    logger.warn({ err }, 'photo could not be compacted')
    return null
  }
}
