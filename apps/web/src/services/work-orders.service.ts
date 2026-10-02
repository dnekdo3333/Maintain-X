import type {
  ApiResponse,
  AssignWorkOrderInput,
  CloseWorkOrderInput,
  CompleteWorkOrderInput,
  CreateRequestInput,
  CreateWorkOrderInput,
  HoldWorkOrderInput,
  MessageInput,
  PagedResponse,
  RejectRequestInput,
  ReopenWorkOrderInput,
  RequestDetail,
  RequestListItem,
  UpdateWorkOrderInput,
  WorkOrderDetail,
  WorkOrderListItem,
} from '@maintainx/shared'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { http, type QueryValue } from './http'

const unwrap = <T>(p: Promise<ApiResponse<T>>) => p.then((r) => r.data)

function filesBody(files: File[]): FormData {
  const body = new FormData()
  for (const f of files) body.append('files', f, f.name)
  return body
}

export const requestsApi = {
  list: (query: Record<string, QueryValue>, signal?: AbortSignal) =>
    http.get<PagedResponse<RequestListItem>>('/requests', { query, signal }),
  get: (id: string, signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<RequestDetail>>(`/requests/${id}`, { signal })),
  create: (input: CreateRequestInput) =>
    unwrap(http.post<ApiResponse<RequestDetail>>('/requests', input)),
  addPhotos: (id: string, files: File[]) =>
    unwrap(http.post<ApiResponse<RequestDetail>>(`/requests/${id}/attachments`, filesBody(files))),
  reject: (id: string, input: RejectRequestInput) =>
    unwrap(http.post<ApiResponse<RequestDetail>>(`/requests/${id}/reject`, input)),
}

const action =
  <I = void>(path: string) =>
  (id: string, input?: I) =>
    unwrap(http.post<ApiResponse<WorkOrderDetail>>(`/work-orders/${id}/${path}`, input))

export const workOrdersApi = {
  list: (query: Record<string, QueryValue>, signal?: AbortSignal) =>
    http.get<PagedResponse<WorkOrderListItem>>('/work-orders', { query, signal }),
  get: (id: string, signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<WorkOrderDetail>>(`/work-orders/${id}`, { signal })),
  create: (input: CreateWorkOrderInput) =>
    unwrap(http.post<ApiResponse<WorkOrderDetail>>('/work-orders', input)),
  update: (id: string, input: UpdateWorkOrderInput) =>
    unwrap(http.put<ApiResponse<WorkOrderDetail>>(`/work-orders/${id}`, input)),
  assign: action<AssignWorkOrderInput>('assign'),
  unassign: action('unassign'),
  start: action('start'),
  hold: action<HoldWorkOrderInput>('hold'),
  resume: action('resume'),
  complete: action<CompleteWorkOrderInput>('complete'),
  close: action<CloseWorkOrderInput>('close'),
  reopen: action<ReopenWorkOrderInput>('reopen'),
  message: action<MessageInput>('messages'),
  upload: (id: string, files: File[]) =>
    unwrap(
      http.post<ApiResponse<WorkOrderDetail>>(`/work-orders/${id}/attachments`, filesBody(files)),
    ),
}

export const workKeys = {
  requests: ['requests'] as const,
  requestList: (q: Record<string, QueryValue>) => ['requests', 'list', q] as const,
  request: (id: string) => ['requests', 'detail', id] as const,
  workOrders: ['work-orders'] as const,
  workOrderList: (q: Record<string, QueryValue>) => ['work-orders', 'list', q] as const,
  workOrder: (id: string) => ['work-orders', 'detail', id] as const,
}

/**
 * Everything a work-order change can affect: lists, the record, the worker's
 * home/tasks, the dashboard, and the asset (status, history).
 */
export const WORK_ORDER_EFFECTS = [
  workKeys.workOrders,
  workKeys.requests,
  ['me'],
  ['dashboard'],
  ['assets'],
  ['parts'],
] as const

export function useRequests(query: Record<string, QueryValue>) {
  return useQuery({
    queryKey: workKeys.requestList(query),
    queryFn: ({ signal }) => requestsApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
}

export function useRequest(id: string | null) {
  return useQuery({
    queryKey: workKeys.request(id ?? ''),
    queryFn: ({ signal }) => requestsApi.get(id!, signal),
    enabled: !!id,
  })
}

export function useWorkOrders(query: Record<string, QueryValue>, enabled = true) {
  return useQuery({
    queryKey: workKeys.workOrderList(query),
    queryFn: ({ signal }) => workOrdersApi.list(query, signal),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useWorkOrder(id: string) {
  return useQuery({
    queryKey: workKeys.workOrder(id),
    queryFn: ({ signal }) => workOrdersApi.get(id, signal),
    // Keeps the worked time and status fresh while the page is open.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}

/** Writes a fresh detail into the cache and refreshes everything that depends on it. */
export function useApplyWorkOrder() {
  const qc = useQueryClient()
  return async (w: WorkOrderDetail) => {
    qc.setQueryData(workKeys.workOrder(w.id), w)
    await Promise.all(
      WORK_ORDER_EFFECTS.filter((k) => k !== workKeys.workOrders).map((queryKey) =>
        qc.invalidateQueries({ queryKey }),
      ),
    )
    await qc.invalidateQueries({ queryKey: ['work-orders', 'list'] })
  }
}
