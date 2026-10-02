import QRCode from 'qrcode'

/** URL a printed asset QR code points to. Any phone camera can open it. */
export function assetQrUrl(publicId: string): string {
  return `${window.location.origin}/a/${publicId}`
}

/** Medium error correction survives smudges and a partly torn label. */
const OPTIONS = { errorCorrectionLevel: 'M', margin: 1 } as const

/** Downloads a high-resolution PNG of the QR code. */
export async function downloadQrPng(value: string, fileName: string): Promise<void> {
  const url = await QRCode.toDataURL(value, { ...OPTIONS, width: 1024 })
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
}

/**
 * Extracts the asset public id from a scanned value. Accepts our own links
 * (https://<host>/a/<id>) from any host, so labels printed before a domain
 * change still work.
 */
export function parseAssetQr(raw: string): string | null {
  try {
    const url = new URL(raw)
    const m = url.pathname.match(/^\/a\/([1-9A-HJ-NP-Za-km-z]{8,24})\/?$/)
    return m ? m[1]! : null
  } catch {
    return null
  }
}
