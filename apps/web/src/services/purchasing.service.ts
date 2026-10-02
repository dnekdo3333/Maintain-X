import type {
  ApiResponse,
  PagedResponse,
  PartDetail,
  PartInput,
  PartListItem,
  PurchaseOrderDetail,
  PurchaseOrderInput,
  PurchaseOrderListItem,
  ReceivePoInput,
  StockAdjustmentInput,
  StockSettingsInput,
  UseWorkOrderPartInput,
  VendorDetail,
  VendorInput,
  VendorInvoiceDto,
  VendorInvoiceInput,
  VendorListItem,
  VendorOption,
  WorkOrderDetail,
} from '@maintainx/shared'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { http, type QueryValue } from './http'

const unwrap = <T>(p: Promise<ApiResponse<T>>) => p.then((r) => r.data)

export const partsApi = {
  list: (query: Record<string, QueryValue>, signal?: AbortSignal) =>
    http.get<PagedResponse<PartListItem>>('/parts', { query, signal }),
  categories: (signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<string[]>>('/parts/categories', { signal })),
  get: (id: string, signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<PartDetail>>(`/parts/${id}`, { signal })),
  create: (input: PartInput) => unwrap(http.post<ApiResponse<PartDetail>>('/parts', input)),
  update: (id: string, input: PartInput) =>
    unwrap(http.put<ApiResponse<PartDetail>>(`/parts/${id}`, input)),
  archive: (id: string) => http.delete<void>(`/parts/${id}`),
  adjust: (id: string, input: StockAdjustmentInput) =>
    unwrap(http.post<ApiResponse<PartDetail>>(`/parts/${id}/adjust`, input)),
  settings: (id: string, input: StockSettingsInput) =>
    unwrap(http.put<ApiResponse<PartDetail>>(`/parts/${id}/stock-settings`, input)),
}

export const workOrderPartsApi = {
  use: (workOrderId: string, input: UseWorkOrderPartInput) =>
    unwrap(http.post<ApiResponse<WorkOrderDetail>>(`/work-orders/${workOrderId}/parts`, input)),
  remove: (workOrderId: string, lineId: string) =>
    unwrap(
      http.delete<ApiResponse<WorkOrderDetail>>(`/work-orders/${workOrderId}/parts/${lineId}`),
    ),
}

export const vendorsApi = {
  list: (query: Record<string, QueryValue>, signal?: AbortSignal) =>
    http.get<PagedResponse<VendorListItem>>('/vendors', { query, signal }),
  options: (restaurantId?: string, signal?: AbortSignal) =>
    unwrap(
      http.get<ApiResponse<VendorOption[]>>('/vendors/options', {
        query: { restaurantId },
        signal,
      }),
    ),
  get: (id: string, signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<VendorDetail>>(`/vendors/${id}`, { signal })),
  create: (input: VendorInput) => unwrap(http.post<ApiResponse<VendorDetail>>('/vendors', input)),
  update: (id: string, input: VendorInput) =>
    unwrap(http.put<ApiResponse<VendorDetail>>(`/vendors/${id}`, input)),
  archive: (id: string) => http.delete<void>(`/vendors/${id}`),
  invoices: (id: string, signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<VendorInvoiceDto[]>>(`/vendors/${id}/invoices`, { signal })),
  addInvoice: (id: string, input: VendorInvoiceInput) =>
    unwrap(http.post<ApiResponse<VendorInvoiceDto>>(`/vendors/${id}/invoices`, input)),
  setPaid: (id: string, invoiceId: string, paid: boolean) =>
    unwrap(
      http.put<ApiResponse<VendorInvoiceDto>>(`/vendors/${id}/invoices/${invoiceId}/paid`, {
        paid,
      }),
    ),
  deleteInvoice: (id: string, invoiceId: string) =>
    http.delete<void>(`/vendors/${id}/invoices/${invoiceId}`),
}

const poAction =
  <I = void>(path: string) =>
  (id: string, input?: I) =>
    unwrap(http.post<ApiResponse<PurchaseOrderDetail>>(`/purchase-orders/${id}/${path}`, input))

export const poApi = {
  list: (query: Record<string, QueryValue>, signal?: AbortSignal) =>
    http.get<PagedResponse<PurchaseOrderListItem>>('/purchase-orders', { query, signal }),
  get: (id: string, signal?: AbortSignal) =>
    unwrap(http.get<ApiResponse<PurchaseOrderDetail>>(`/purchase-orders/${id}`, { signal })),
  create: (input: PurchaseOrderInput) =>
    unwrap(http.post<ApiResponse<PurchaseOrderDetail>>('/purchase-orders', input)),
  update: (id: string, input: PurchaseOrderInput) =>
    unwrap(http.put<ApiResponse<PurchaseOrderDetail>>(`/purchase-orders/${id}`, input)),
  submit: poAction('submit'),
  approve: poAction('approve'),
  reject: poAction<{ reason: string }>('reject'),
  order: poAction('order'),
  receive: poAction<ReceivePoInput>('receive'),
  cancel: poAction<{ reason: string }>('cancel'),
}

export const buyKeys = {
  parts: ['parts'] as const,
  partList: (q: Record<string, QueryValue>) => ['parts', 'list', q] as const,
  part: (id: string) => ['parts', 'detail', id] as const,
  partCategories: ['parts', 'categories'] as const,
  vendors: ['vendors'] as const,
  vendorList: (q: Record<string, QueryValue>) => ['vendors', 'list', q] as const,
  vendorOptions: (restaurantId?: string) => ['vendors', 'options', restaurantId ?? 'all'] as const,
  vendor: (id: string) => ['vendors', 'detail', id] as const,
  invoices: (id: string) => ['vendors', 'invoices', id] as const,
  pos: ['purchase-orders'] as const,
  poList: (q: Record<string, QueryValue>) => ['purchase-orders', 'list', q] as const,
  po: (id: string) => ['purchase-orders', 'detail', id] as const,
}

export function useParts(query: Record<string, QueryValue>, enabled = true) {
  return useQuery({
    queryKey: buyKeys.partList(query),
    queryFn: ({ signal }) => partsApi.list(query, signal),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function usePart(id: string) {
  return useQuery({ queryKey: buyKeys.part(id), queryFn: ({ signal }) => partsApi.get(id, signal) })
}

export function usePartCategories() {
  return useQuery({
    queryKey: buyKeys.partCategories,
    queryFn: ({ signal }) => partsApi.categories(signal),
    staleTime: 60_000,
  })
}

export function useVendors(query: Record<string, QueryValue>) {
  return useQuery({
    queryKey: buyKeys.vendorList(query),
    queryFn: ({ signal }) => vendorsApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
}

export function useVendorOptions(restaurantId?: string, enabled = true) {
  return useQuery({
    queryKey: buyKeys.vendorOptions(restaurantId),
    queryFn: ({ signal }) => vendorsApi.options(restaurantId, signal),
    enabled,
    staleTime: 30_000,
  })
}

export function useVendor(id: string) {
  return useQuery({
    queryKey: buyKeys.vendor(id),
    queryFn: ({ signal }) => vendorsApi.get(id, signal),
  })
}

export function useVendorInvoices(id: string) {
  return useQuery({
    queryKey: buyKeys.invoices(id),
    queryFn: ({ signal }) => vendorsApi.invoices(id, signal),
  })
}

export function usePurchaseOrders(query: Record<string, QueryValue>) {
  return useQuery({
    queryKey: buyKeys.poList(query),
    queryFn: ({ signal }) => poApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
}

export function usePurchaseOrder(id: string | undefined) {
  return useQuery({
    queryKey: buyKeys.po(id ?? ''),
    queryFn: ({ signal }) => poApi.get(id!, signal),
    enabled: !!id,
  })
}
