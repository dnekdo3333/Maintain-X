import type {
  ApiResponse,
  ChatMessageDto,
  ChatMessageInput,
  ChatMessagesPage,
  ChatPerson,
  ConversationListItem,
  StartConversationInput,
} from '@maintainx/shared'
import { useQuery } from '@tanstack/react-query'
import { http } from './http'

/** Chats poll: the list every 15 s, the open chat every 4 s (see ChatThread). */
export const chatKeys = {
  list: ['chats'] as const,
  unread: ['chats', 'unread'] as const,
  people: (q: string) => ['chats', 'people', q] as const,
}

export function useConversations() {
  return useQuery({
    queryKey: chatKeys.list,
    queryFn: ({ signal }) =>
      http.get<ApiResponse<ConversationListItem[]>>('/chats', { signal }).then((r) => r.data),
    refetchInterval: 15_000,
  })
}

export function useChatUnread() {
  return useQuery({
    queryKey: chatKeys.unread,
    queryFn: ({ signal }) =>
      http.get<ApiResponse<{ count: number }>>('/chats/unread', { signal }).then((r) => r.data.count),
    refetchInterval: 30_000,
  })
}

export function useChatPeople(q: string, enabled: boolean) {
  return useQuery({
    queryKey: chatKeys.people(q),
    queryFn: ({ signal }) =>
      http
        .get<ApiResponse<ChatPerson[]>>('/chats/people', { query: { q }, signal })
        .then((r) => r.data),
    enabled,
    staleTime: 60_000,
  })
}

export const chatApi = {
  start: (input: StartConversationInput) =>
    http.post<ApiResponse<{ id: string }>>('/chats', input).then((r) => r.data),
  messages: (id: string, query: { before?: string; after?: string } = {}, signal?: AbortSignal) =>
    http
      .get<ApiResponse<ChatMessagesPage>>(`/chats/${id}/messages`, { query, signal })
      .then((r) => r.data),
  send: (id: string, input: ChatMessageInput) =>
    http.post<ApiResponse<ChatMessageDto>>(`/chats/${id}/messages`, input).then((r) => r.data),
  remove: (id: string, messageId: string) => http.delete<void>(`/chats/${id}/messages/${messageId}`),
  read: (id: string) => http.post<void>(`/chats/${id}/read`),
  leave: (id: string) => http.post<void>(`/chats/${id}/leave`),
  addMembers: (id: string, userIds: string[]) =>
    http.post<void>(`/chats/${id}/members`, { userIds }),
}
