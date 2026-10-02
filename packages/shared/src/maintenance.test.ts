import { describe, expect, it } from 'vitest'
import {
  evaluateAnswer,
  nextOccurrence,
  upcomingOccurrences,
  type RecurrenceRule,
} from './maintenance.js'

const rule = (o: Partial<RecurrenceRule>): RecurrenceRule => ({
  frequency: 'DAILY',
  startDate: '2026-10-01',
  ...o,
})

describe('recurrence', () => {
  it('daily starts at the start date and respects the end date', () => {
    expect(nextOccurrence(rule({}), '2026-09-01')).toBe('2026-10-01')
    expect(nextOccurrence(rule({}), '2026-10-05')).toBe('2026-10-05')
    expect(nextOccurrence(rule({ endDate: '2026-10-03' }), '2026-10-04')).toBeNull()
  })

  it('weekly on chosen weekdays', () => {
    // 2026-10-01 is a Thursday. Mondays and Fridays.
    const r = rule({ frequency: 'WEEKLY', daysOfWeek: [1, 5] })
    expect(upcomingOccurrences(r, '2026-10-01', 4)).toEqual([
      '2026-10-02',
      '2026-10-05',
      '2026-10-09',
      '2026-10-12',
    ])
  })

  it('monthly and quarterly on a day of the month', () => {
    const m = rule({ frequency: 'MONTHLY', dayOfMonth: 15 })
    expect(upcomingOccurrences(m, '2026-10-01', 3)).toEqual([
      '2026-10-15',
      '2026-11-15',
      '2026-12-15',
    ])
    expect(nextOccurrence(m, '2026-10-16')).toBe('2026-11-15')

    const q = rule({ frequency: 'QUARTERLY', dayOfMonth: 1 })
    expect(upcomingOccurrences(q, '2026-10-01', 3)).toEqual([
      '2026-10-01',
      '2027-01-01',
      '2027-04-01',
    ])
    expect(nextOccurrence(q, '2026-11-20')).toBe('2027-01-01')
  })

  it('custom every N days from the start', () => {
    const r = rule({ frequency: 'CUSTOM', intervalDays: 10 })
    expect(upcomingOccurrences(r, '2026-10-02', 3)).toEqual([
      '2026-10-11',
      '2026-10-21',
      '2026-10-31',
    ])
  })
})

describe('evaluateAnswer', () => {
  const blank = { result: '' as const, textValue: '', note: '' }
  it('fails readings outside the range', () => {
    const step = { inputType: 'NUMBER' as const, minValue: -25, maxValue: -15 }
    expect(evaluateAnswer(step, { ...blank, numericValue: -18 }).result).toBe('PASS')
    expect(evaluateAnswer(step, { ...blank, numericValue: -9 }).result).toBe('FAIL')
    expect(evaluateAnswer(step, blank).result).toBeNull()
  })
  it('text passes when filled; pass/fail uses the chosen result', () => {
    const text = { inputType: 'TEXT' as const, minValue: null, maxValue: null }
    expect(evaluateAnswer(text, { ...blank, textValue: ' ok ' })).toMatchObject({
      result: 'PASS',
      textValue: 'ok',
    })
    const pf = { inputType: 'PASS_FAIL_NA' as const, minValue: null, maxValue: null }
    expect(evaluateAnswer(pf, { ...blank, result: 'FAIL' }).result).toBe('FAIL')
  })
})
