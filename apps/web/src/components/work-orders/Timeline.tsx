import { fullName, type WorkOrderEvent, type WorkOrderMessage } from '@maintainx/shared'
import { Send } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toaster'
import { cn } from '@/utils/cn'
import { describeError } from '@/utils/errors'
import { formatDateTime } from '@/utils/format'

/** Notes between the worker and admins, with a composer when messaging is allowed. */
export function MessagesPanel({
  messages,
  canSend,
  send,
}: {
  messages: WorkOrderMessage[]
  canSend: boolean
  send: (body: string) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    const text = body.trim()
    if (!text) return
    setBusy(true)
    try {
      await send(text)
      setBody('')
    } catch (err) {
      toast.error(describeError(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3">
      {messages.length === 0 ? (
        <p className="text-13 text-muted-foreground">{t('wo.noMessages')}</p>
      ) : (
        <ul className="grid gap-2">
          {messages.map((m) => (
            <li
              key={m.id}
              className={cn(
                'grid max-w-[85%] gap-0.5 rounded-lg px-3 py-2 text-sm',
                m.mine ? 'justify-self-end bg-info-soft' : 'justify-self-start bg-muted',
              )}
            >
              <span className="text-xs text-muted-foreground">
                {m.mine ? t('wo.you') : fullName(m.author)} · {formatDateTime(m.createdAt)}
              </span>
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
            </li>
          ))}
        </ul>
      )}
      {canSend && (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <Textarea
            aria-label={t('wo.messageLabel')}
            placeholder={t('wo.messagePlaceholder')}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            maxLength={2000}
            className="min-h-11"
          />
          <Button
            type="submit"
            size="icon-lg"
            aria-label={t('wo.send')}
            loading={busy}
            disabled={!body.trim()}
          >
            <Send />
          </Button>
        </form>
      )}
    </div>
  )
}

/** Status changes, newest first. */
export function HistoryList({ events }: { events: WorkOrderEvent[] }) {
  const { t } = useTranslation()
  const sorted = [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return (
    <ol className="grid gap-3">
      {sorted.map((e) => (
        <li key={e.id} className="grid gap-1 border-l-2 pl-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="workOrderStatus" value={e.toStatus} />
            <span className="text-xs text-muted-foreground">
              {e.actor ? fullName(e.actor) : t('wo.system')} · {formatDateTime(e.createdAt)}
            </span>
          </div>
          {e.note && <p className="text-13 whitespace-pre-wrap text-foreground/90">{e.note}</p>}
        </li>
      ))}
    </ol>
  )
}
