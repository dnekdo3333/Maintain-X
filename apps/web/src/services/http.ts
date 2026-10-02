import {
  AUTH_CSRF_HEADER,
  AUTH_CSRF_VALUE,
  type ApiErrorBody,
  type ErrorCode,
} from '@maintainx/shared'
import i18n from '@/i18n'

// ---------------------------------------------------------------------------
// Session plumbing. The access token lives only in memory (never localStorage);
// the auth service installs the refresh handler so this module has no
// dependency on it.
// ---------------------------------------------------------------------------

let accessToken: string | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string | null): void {
  accessToken = token
}

/** Returns true when a new access token is available, false when the session is over. */
type RefreshHandler = () => Promise<boolean>
let refreshHandler: RefreshHandler | null = null

export function setRefreshHandler(handler: RefreshHandler | null): void {
  refreshHandler = handler
}

const RETRYABLE_AUTH_CODES = new Set(['TOKEN_EXPIRED', 'TOKEN_INVALID'])

export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR'

/** Normalised API failure. `code` maps to a translated message via describeError(). */
export class ApiError extends Error {
  readonly status: number
  readonly code: ClientErrorCode
  readonly fieldErrors: Record<string, string[]> | undefined
  readonly requestId: string | undefined

  constructor(
    status: number,
    code: ClientErrorCode,
    message: string,
    fieldErrors?: Record<string, string[]>,
    requestId?: string,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fieldErrors = fieldErrors
    this.requestId = requestId
  }
}

const API_BASE = `${(import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')}/api/v1`

export type QueryValue = string | number | boolean | null | undefined

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  query?: Record<string, QueryValue>
  headers?: Record<string, string>
  signal?: AbortSignal
  /** Non-2xx statuses whose body should be returned instead of thrown (e.g. 503 from /ready). */
  acceptStatuses?: readonly number[]
  /** Don't attach the access token (login, refresh). */
  anonymous?: boolean
  /** Internal: this is the retry after a refresh, don't refresh again. */
  isRetry?: boolean
  /** Return the response body as text (CSV downloads) instead of parsed JSON. */
  raw?: boolean
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = `${API_BASE}${path}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    query,
    headers = {},
    signal,
    acceptStatuses = [],
    anonymous = false,
    isRetry = false,
  } = options

  const token = anonymous ? null : accessToken
  const requestHeaders: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Language': i18n.language,
    [AUTH_CSRF_HEADER]: AUTH_CSRF_VALUE,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headers,
  }
  const init: RequestInit = { method, credentials: 'include', signal, headers: requestHeaders }

  if (body !== undefined) {
    if (body instanceof FormData) {
      init.body = body
    } else {
      requestHeaders['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
  }

  let response: Response
  try {
    response = await fetch(buildUrl(path, query), init)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server.')
  }

  const text = await response.text()
  let json: unknown = null
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
  }

  if (!response.ok && !acceptStatuses.includes(response.status)) {
    const error = (json as Partial<ApiErrorBody> | null)?.error

    // Expired access token: refresh once (shared by concurrent requests), then retry.
    if (
      response.status === 401 &&
      token &&
      !isRetry &&
      refreshHandler &&
      error?.code &&
      RETRYABLE_AUTH_CODES.has(error.code)
    ) {
      if (await refreshHandler()) return request<T>(path, { ...options, isRetry: true })
    }

    throw new ApiError(
      response.status,
      error?.code ?? 'INTERNAL_ERROR',
      error?.message ?? `Request failed (${response.status})`,
      error?.fieldErrors,
      error?.requestId,
    )
  }

  return (options.raw ? text : json) as T
}

type Opts = Omit<RequestOptions, 'method' | 'body'>

export const http = {
  get: <T>(path: string, opts?: Opts) => request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Opts) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, opts?: Opts) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, opts?: Opts) =>
    request<T>(path, { ...opts, method: 'PUT', body }),
  delete: <T>(path: string, opts?: Opts) => request<T>(path, { ...opts, method: 'DELETE' }),
}

/** Downloads an authenticated text file (e.g. CSV) and saves it under `fileName`. */
export async function downloadFile(
  path: string,
  query: Record<string, QueryValue>,
  fileName: string,
  mimeType = 'text/csv;charset=utf-8',
): Promise<void> {
  const text = await request<string>(path, { method: 'GET', query, raw: true })
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
