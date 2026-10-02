import type { ChecklistItemDto, StepAnswerInput } from '@maintainx/shared'
import { fullName } from '@maintainx/shared'
import { Link } from 'react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toaster'
import { ResultToggle } from '@/components/worker/ResultToggle'
import { cn } from '@/utils/cn'
import { describeError } from '@/utils/errors'
import { formatNumber } from '@/utils/format'
import { rangeLabel } from './checklist-utils'

export type AnswerFn = (itemId: string, input: StepAnswerInput) => Promise<unknown>

/**
 * A list of steps. Editable: every answer is saved as soon as it's given
 * (tap a result, or leave a number / text field). Read-only: shows results.
 */
export function Checklist({
  items,
  editable,
  onAnswer,
  correctiveLinkBase = '/work-orders',
}: {
  items: ChecklistItemDto[]
  editable: boolean
  onAnswer?: AnswerFn
  /** Where follow-up work orders open (workers can't open admin pages). */
  correctiveLinkBase?: string | null
}) {
  return (
    <ol className="grid gap-4">
      {items.map((item) => (
        <li key={item.id}>
          <Step
            item={item}
            editable={editable && !!onAnswer}
            onAnswer={onAnswer}
            correctiveLinkBase={correctiveLinkBase}
          />
        </li>
      ))}
    </ol>
  )
}

function Step({
  item,
  editable,
  onAnswer,
  correctiveLinkBase,
}: {
  item: ChecklistItemDto
  editable: boolean
  onAnswer?: AnswerFn
  correctiveLinkBase: string | null
}) {
  const { t } = useTranslation()
  const [num, setNum] = useState(item.numericValue === null ? '' : String(item.numericValue))
  const [text, setText] = useState(item.textValue ?? '')
  const [note, setNote] = useState(item.note ?? '')
  const [noteOpen, setNoteOpen] = useState(!!item.note)
  const [saving, setSaving] = useState(false)
  const labelId = `step-${item.id}`
  const range = item.inputType === 'NUMBER' ? rangeLabel(item, t) : ''

  /** Sends the full current answer; `patch` overrides what just changed. */
  async function save(patch: Partial<StepAnswerInput> = {}) {
    if (!onAnswer) return
    const n = num.trim() === '' ? undefined : Number(num.replace(',', '.'))
    const input: StepAnswerInput = {
      result: item.inputType === 'PASS_FAIL_NA' ? (item.result ?? '') : '',
      numericValue: n !== undefined && !Number.isNaN(n) ? n : undefined,
      textValue: text,
      note,
      ...patch,
    }
    setSaving(true)
    try {
      await onAnswer(item.id, input)
    } catch (err) {
      toast.error(describeError(err, t))
    } finally {
      setSaving(false)
    }
  }

  const failed = item.result === 'FAIL'
  return (
    <div
      className={cn(
        'grid gap-2 rounded-lg border p-3',
        failed && 'border-danger/50 bg-danger-soft/40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p id={labelId} className="text-sm font-medium">
          {item.position}. {item.title}
          {!item.required && (
            <span className="ml-1 font-normal text-muted-foreground">({t('common.optional')})</span>
          )}
        </p>
        <span className="flex shrink-0 items-center gap-1">
          {saving && <Spinner className="size-4" />}
          {item.result && <StatusBadge kind="stepResult" value={item.result} />}
        </span>
      </div>
      {item.instruction && <p className="text-13 text-muted-foreground">{item.instruction}</p>}

      {item.inputType === 'PASS_FAIL_NA' &&
        (editable ? (
          <ResultToggle
            labelledBy={labelId}
            value={item.result}
            disabled={saving}
            onChange={(v) => {
              if (v === 'FAIL') setNoteOpen(true)
              void save({ result: v })
            }}
          />
        ) : null)}

      {item.inputType === 'NUMBER' &&
        (editable ? (
          <div className="grid gap-1">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="decimal"
                step="any"
                aria-labelledby={labelId}
                aria-describedby={range ? `${labelId}-range` : undefined}
                value={num}
                onChange={(e) => setNum(e.target.value)}
                onBlur={() => {
                  if (num !== (item.numericValue === null ? '' : String(item.numericValue)))
                    void save()
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
                className="h-12 max-w-40 text-base tabular"
              />
              {item.unit && <span className="text-sm text-muted-foreground">{item.unit}</span>}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                disabled={saving}
                onClick={() => {
                  setNum('')
                  void save({ numericValue: undefined, result: 'NA' })
                }}
              >
                {t('checklist.notApplicable')}
              </Button>
            </div>
            {range && (
              <p id={`${labelId}-range`} className="text-xs text-muted-foreground">
                {range}
              </p>
            )}
          </div>
        ) : (
          item.numericValue !== null && (
            <p className="text-sm tabular">
              {formatNumber(item.numericValue)}
              {item.unit ? ` ${item.unit}` : ''}
              {range && <span className="ml-2 text-xs text-muted-foreground">({range})</span>}
            </p>
          )
        ))}

      {item.inputType === 'TEXT' &&
        (editable ? (
          <Textarea
            aria-labelledby={labelId}
            rows={2}
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              if (text !== (item.textValue ?? '')) void save()
            }}
          />
        ) : (
          item.textValue && <p className="text-sm whitespace-pre-wrap">{item.textValue}</p>
        ))}

      {editable ? (
        noteOpen ? (
          <Textarea
            aria-label={t('checklist.noteFor', { step: item.title })}
            placeholder={
              failed ? t('checklist.failNotePlaceholder') : t('checklist.notePlaceholder')
            }
            rows={2}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => {
              if (note !== (item.note ?? '') && item.result !== null) void save()
            }}
          />
        ) : (
          <Button
            variant="link"
            size="sm"
            className="justify-self-start"
            onClick={() => setNoteOpen(true)}
          >
            {t('checklist.addNote')}
          </Button>
        )
      ) : (
        item.note && <p className="text-13 whitespace-pre-wrap text-foreground/90">{item.note}</p>
      )}

      {(item.completedBy || item.correctiveWorkOrder) && (
        <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          {item.completedBy && !editable && <span>{fullName(item.completedBy)}</span>}
          {item.correctiveWorkOrder &&
            (correctiveLinkBase ? (
              <Link
                to={`${correctiveLinkBase}/${item.correctiveWorkOrder.id}`}
                className="font-medium text-primary hover:underline"
              >
                {t('checklist.followUp', { code: item.correctiveWorkOrder.code })}
              </Link>
            ) : (
              <span>{t('checklist.followUp', { code: item.correctiveWorkOrder.code })}</span>
            ))}
        </p>
      )}
    </div>
  )
}
