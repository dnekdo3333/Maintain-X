import { fullName, type ChatMessageDto, type ConversationListItem } from '@maintainx/shared'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ClipboardList,
  LogOut,
  MessageSquarePlus,
  MessagesSquare,
  Search,
  Send,
  Trash2,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { chatApi, chatKeys, useChatPeople, useConversations } from '@/services/chat.service'
import { cn } from '@/utils/cn'
import { reportError } from '@/utils/errors'
import { formatDateTime, formatTime } from '@/utils/format'

/** New messages in the open chat are fetched this often. */
const POLL_MS = 4_000

/**
 * Team chat: the list of chats beside the open one (phones show one at a
 * time). `base` is "/chat" in the admin app and "/w/chat" for workers.
 */
export function ChatPage({ base }: { base: string }) {
  const { t } = useTranslation()
  const { conversationId } = useParams()
  const list = useConversations()
  const [starting, setStarting] = useState(false)
  const open = list.data?.find((c) => c.id === conversationId) ?? null

  return (
    <div className="flex h-[calc(100dvh-8rem)] min-h-96 overflow-hidden rounded-xl border bg-card">
      <aside
        className={cn(
          'flex w-full flex-col border-r md:w-80 md:shrink-0',
          conversationId && 'hidden md:flex',
        )}
        aria-label={t('chat.title')}
      >
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
          <h1 className="text-base font-semibold">{t('chat.title')}</h1>
          <Button size="sm" onClick={() => setStarting(true)}>
            <MessageSquarePlus aria-hidden /> {t('chat.new')}
          </Button>
        </div>
        {list.isPending ? (
          <div className="grid gap-2 p-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : list.data.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={MessagesSquare} title={t('chat.none')} description={t('chat.noneHint')} />
          </div>
        ) : (
          <ul className="flex-1 overflow-y-auto">
            {list.data.map((c) => (
              <li key={c.id}>
                <ConversationRow c={c} active={c.id === conversationId} to={`${base}/${c.id}`} />
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className={cn('min-w-0 flex-1 flex-col', conversationId ? 'flex' : 'hidden md:flex')}>
        {open ? (
          <ChatThread key={open.id} c={open} base={base} />
        ) : conversationId && list.isPending ? (
          <div className="grid flex-1 place-items-center">
            <Spinner />
          </div>
        ) : (
          <div className="grid flex-1 place-items-center p-6 text-center text-sm text-muted-foreground">
            {conversationId ? t('chat.notFound') : t('chat.pick')}
          </div>
        )}
      </section>
      <NewChatDialog open={starting} onOpenChange={setStarting} base={base} />
    </div>
  )
}

function ConversationRow({ c, active, to }: { c: ConversationListItem; active: boolean; to: string }) {
  const { t } = useTranslation()
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 border-b px-3 py-2.5 transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        active && 'bg-info-soft',
      )}
    >
      {c.type === 'GROUP' ? (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
          <Users className="size-4 text-muted-foreground" aria-hidden />
        </span>
      ) : (
        <Avatar name={c.title} className="size-9" />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className={cn('truncate text-sm', c.unread > 0 ? 'font-semibold' : 'font-medium')}>
            {c.title}
          </span>
          {c.lastMessage && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatTime(c.lastMessage.createdAt)}
            </span>
          )}
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-13 text-muted-foreground">
            {c.lastMessage
              ? `${c.type === 'GROUP' ? `${c.lastMessage.authorName}: ` : ''}${c.lastMessage.body}`
              : t('chat.noMessages')}
          </span>
          {c.unread > 0 && (
            <Badge tone="info" aria-label={t('chat.unread', { count: c.unread })}>
              {c.unread}
            </Badge>
          )}
        </span>
      </span>
    </Link>
  )
}

function ChatThread({ c, base }: { c: ConversationListItem; base: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [messages, setMessages] = useState<ChatMessageDto[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const lastId = messages.at(-1)?.id

  const markRead = useCallback(async () => {
    try {
      await chatApi.read(c.id)
      void qc.invalidateQueries({ queryKey: chatKeys.list })
      void qc.invalidateQueries({ queryKey: chatKeys.unread })
    } catch {
      // Not critical: the next poll tries again.
    }
  }, [c.id, qc])

  useEffect(() => {
    const ctrl = new AbortController()
    chatApi
      .messages(c.id, {}, ctrl.signal)
      .then((p) => {
        setMessages(p.messages)
        setHasMore(p.hasMore)
        void markRead()
      })
      .catch((err) => !ctrl.signal.aborted && setError(err))
      .finally(() => !ctrl.signal.aborted && setLoading(false))
    return () => ctrl.abort()
  }, [c.id, markRead])

  // Poll for new messages while the chat is open.
  useEffect(() => {
    if (loading || error) return
    const timer = setInterval(() => {
      if (document.hidden) return
      void chatApi
        .messages(c.id, lastId ? { after: lastId } : {})
        .then((p) => {
          const fresh = lastId ? p.messages : []
          if (fresh.length) {
            setMessages((m) => [...m, ...fresh.filter((x) => !m.some((y) => y.id === x.id))])
            void markRead()
          }
        })
        .catch(() => undefined)
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [c.id, lastId, loading, error, markRead])

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' })
  }, [lastId])

  async function older() {
    const first = messages[0]
    if (!first) return
    try {
      const p = await chatApi.messages(c.id, { before: first.id })
      setMessages((m) => [...p.messages, ...m])
      setHasMore(p.hasMore)
    } catch (err) {
      reportError(err, t)
    }
  }

  async function send() {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    try {
      const msg = await chatApi.send(c.id, { body, workOrderId: '' })
      setMessages((m) => [...m, msg])
      setText('')
      void qc.invalidateQueries({ queryKey: chatKeys.list })
    } catch (err) {
      reportError(err, t)
    } finally {
      setSending(false)
    }
  }

  async function remove(m: ChatMessageDto) {
    try {
      await chatApi.remove(c.id, m.id)
      setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, deleted: true, body: '' } : x)))
    } catch (err) {
      reportError(err, t)
    }
  }

  async function leave() {
    try {
      await chatApi.leave(c.id)
      await qc.invalidateQueries({ queryKey: chatKeys.list })
      navigate(base, { replace: true })
    } catch (err) {
      reportError(err, t)
    }
  }

  const others = c.members
  return (
    <>
      <header className="flex items-center gap-2 border-b px-3 py-2.5">
        <Button variant="ghost" size="icon-sm" className="md:hidden" asChild>
          <Link to={base} aria-label={t('chat.back')}>
            <ArrowLeft />
          </Link>
        </Button>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{c.title}</span>
          {c.type === 'GROUP' && (
            <span className="block truncate text-xs text-muted-foreground">
              {others.map((m) => m.firstName).join(', ')}
            </span>
          )}
        </span>
        {c.type === 'GROUP' && (
          <Button variant="ghost" size="sm" onClick={() => void leave()}>
            <LogOut aria-hidden /> {t('chat.leave')}
          </Button>
        )}
      </header>
      <div className="flex-1 overflow-y-auto px-3 py-3" aria-live="polite">
        {loading ? (
          <div className="grid h-full place-items-center">
            <Spinner />
          </div>
        ) : error ? (
          <ErrorState error={error} />
        ) : (
          <ol className="grid gap-2">
            {hasMore && (
              <li className="text-center">
                <Button variant="ghost" size="sm" onClick={() => void older()}>
                  {t('chat.older')}
                </Button>
              </li>
            )}
            {messages.length === 0 && (
              <li className="py-8 text-center text-sm text-muted-foreground">{t('chat.say')}</li>
            )}
            {messages.map((m) => (
              <li key={m.id} className={cn('flex', m.mine ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'group max-w-[80%] rounded-2xl px-3 py-2 text-sm',
                    m.mine ? 'bg-primary text-primary-foreground' : 'bg-muted',
                    m.deleted && 'italic opacity-70',
                  )}
                >
                  {!m.mine && c.type === 'GROUP' && (
                    <p className="mb-0.5 text-xs font-semibold">{fullName(m.author)}</p>
                  )}
                  <p className="break-words whitespace-pre-wrap">
                    {m.deleted ? t('chat.deleted') : m.body}
                  </p>
                  {m.workOrder && (
                    <Link
                      to={
                        base.startsWith('/w')
                          ? `/w/tasks/${m.workOrder.id}`
                          : `/work-orders/${m.workOrder.id}`
                      }
                      className="mt-1 flex items-center gap-1 text-xs underline"
                    >
                      <ClipboardList className="size-3.5" aria-hidden />
                      {m.workOrder.code} · {m.workOrder.title}
                    </Link>
                  )}
                  <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] opacity-75">
                    <time dateTime={m.createdAt} title={formatDateTime(m.createdAt)}>
                      {formatTime(m.createdAt)}
                    </time>
                    {m.mine && !m.deleted && (
                      <button
                        type="button"
                        aria-label={t('chat.delete')}
                        onClick={() => void remove(m)}
                        className="rounded p-0.5 opacity-60 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <Trash2 className="size-3" aria-hidden />
                      </button>
                    )}
                  </p>
                </div>
              </li>
            ))}
            <div ref={bottom} />
          </ol>
        )}
      </div>
      <form
        className="flex items-end gap-2 border-t p-2"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          rows={1}
          maxLength={2000}
          aria-label={t('chat.message')}
          placeholder={t('chat.message')}
          className="max-h-32 min-h-10 resize-none"
        />
        <Button type="submit" size="icon" loading={sending} aria-label={t('chat.send')} disabled={!text.trim()}>
          <Send />
        </Button>
      </form>
    </>
  )
}

function NewChatDialog({
  open,
  onOpenChange,
  base,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  base: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const term = useDebouncedValue(q.trim(), 250)
  const people = useChatPeople(term, open)
  const group = picked.length > 1

  async function start() {
    setBusy(true)
    try {
      const { id } = await chatApi.start({ userIds: picked, name: group ? name.trim() : '' })
      await qc.invalidateQueries({ queryKey: chatKeys.list })
      onOpenChange(false)
      setPicked([])
      setName('')
      navigate(`${base}/${id}`)
    } catch (err) {
      reportError(err, t)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('chat.new')}</DialogTitle>
          <DialogDescription>{t('chat.newHint')}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('chat.searchPeople')}
            aria-label={t('chat.searchPeople')}
            className="pl-8"
          />
        </div>
        <ul className="grid max-h-72 gap-1 overflow-y-auto">
          {people.isPending ? (
            <Skeleton className="h-10 w-full" />
          ) : (people.data ?? []).length === 0 ? (
            <li className="py-4 text-center text-sm text-muted-foreground">{t('chat.noPeople')}</li>
          ) : (
            people.data!.map((p) => {
              const id = `pick-${p.id}`
              return (
                <li key={p.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/60">
                  <Checkbox
                    id={id}
                    checked={picked.includes(p.id)}
                    onCheckedChange={(v) =>
                      setPicked((list) => (v === true ? [...list, p.id] : list.filter((x) => x !== p.id)))
                    }
                  />
                  <Label htmlFor={id} className="flex-1 cursor-pointer font-normal">
                    {fullName(p)}
                    {p.role && <span className="ml-1 text-xs text-muted-foreground">· {p.role}</span>}
                  </Label>
                </li>
              )
            })
          )}
        </ul>
        {group && (
          <div className="grid gap-1.5">
            <Label htmlFor="chat-group-name">{t('chat.groupName')}</Label>
            <Input
              id="chat-group-name"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('chat.groupNameHint')}
            />
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('actions.cancel')}
          </Button>
          <Button
            loading={busy}
            disabled={picked.length === 0 || (group && name.trim().length < 2)}
            onClick={() => void start()}
          >
            {group ? t('chat.createGroup') : t('chat.start')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export const AdminChatPage = () => <ChatPage base="/chat" />

export function WorkerChatPage() {
  return (
    <div className="px-3 py-3">
      <ChatPage base="/w/chat" />
    </div>
  )
}
