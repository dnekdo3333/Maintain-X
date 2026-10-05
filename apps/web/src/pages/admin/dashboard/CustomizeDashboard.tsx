import {
  DASHBOARD_WIDGETS,
  DEFAULT_DASHBOARD_LAYOUT,
  type ApiResponse,
  type DashboardLayout,
  type DashboardWidget,
} from '@maintainx/shared'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, LayoutGrid, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { toast } from '@/components/ui/toaster'
import { http } from '@/services/http'
import { DASHBOARD_LAYOUT_KEY as KEY } from './dashboard-layout'
import { reportError } from '@/utils/errors'

interface Row {
  key: DashboardWidget
  shown: boolean
}

function rowsFor(layout: DashboardLayout): Row[] {
  const shown = layout.widgets.map((key) => ({ key, shown: true }))
  const hidden = DASHBOARD_WIDGETS.filter((w) => !layout.widgets.includes(w)).map((key) => ({
    key,
    shown: false,
  }))
  return [...shown, ...hidden]
}

/** "Customize" sheet: tick the blocks to show and move them up / down. */
export function CustomizeDashboard({ layout }: { layout: DashboardLayout }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Row[]>(() => rowsFor(layout))
  const [saving, setSaving] = useState(false)

  function move(i: number, dir: -1 | 1) {
    setRows((r) => {
      const next = [...r]
      ;[next[i], next[i + dir]] = [next[i + dir]!, next[i]!]
      return next
    })
  }

  async function save(widgets: DashboardWidget[]) {
    setSaving(true)
    try {
      const res = await http.put<ApiResponse<DashboardLayout>>('/me/dashboard-layout', { widgets })
      qc.setQueryData(KEY, res.data)
      toast.success(t('dashboardCustom.saved'))
      setOpen(false)
    } catch (err) {
      reportError(err, t)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setRows(rowsFor(layout))
          setOpen(true)
        }}
      >
        <LayoutGrid aria-hidden /> {t('dashboardCustom.open')}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t('dashboardCustom.title')}</SheetTitle>
            <SheetDescription>{t('dashboardCustom.hint')}</SheetDescription>
          </SheetHeader>
          <SheetBody>
            <ol className="grid gap-1.5">
              {rows.map((r, i) => {
                const id = `widget-${r.key}`
                const label = t(`dashboardCustom.w_${r.key}`)
                return (
                  <li key={r.key} className="flex items-center gap-3 rounded-md border px-3 py-2">
                    <Checkbox
                      id={id}
                      checked={r.shown}
                      onCheckedChange={(v) =>
                        setRows((list) =>
                          list.map((x) => (x.key === r.key ? { ...x, shown: v === true } : x)),
                        )
                      }
                    />
                    <label htmlFor={id} className="flex-1 text-sm">
                      {label}
                    </label>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('dashboardCustom.moveUp', { name: label })}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('dashboardCustom.moveDown', { name: label })}
                      disabled={i === rows.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown />
                    </Button>
                  </li>
                )
              })}
            </ol>
          </SheetBody>
          <SheetFooter>
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => void save([...DEFAULT_DASHBOARD_LAYOUT.widgets])}
            >
              <RotateCcw aria-hidden /> {t('dashboardCustom.reset')}
            </Button>
            <Button
              loading={saving}
              onClick={() => void save(rows.filter((r) => r.shown).map((r) => r.key))}
            >
              {t('actions.save')}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}
