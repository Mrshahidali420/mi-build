/**
 * Dates and times as the Page's readers see them: the US Eastern clock, the
 * same one the ledger counts its day by. Pure: every clock is passed in.
 */
import { POSTING_ZONE } from './pace.mjs'

export const DAY_MS = 86_400_000
export const HOUR_MS = 3_600_000

const fmt = (options, timeZone = POSTING_ZONE) => new Intl.DateTimeFormat('en-US', { timeZone, ...options })

/** "2026-10-12" on the posting clock. */
export const dateOf = (ms, timeZone = POSTING_ZONE) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))

/** "5:00 PM" */
export const timeOf = (ms, timeZone) => fmt({ hour: 'numeric', minute: '2-digit' }, timeZone).format(new Date(ms))
/** "Monday" */
export const weekdayOf = (ms, timeZone) => fmt({ weekday: 'long' }, timeZone).format(new Date(ms))
/** "Mon" */
export const shortWeekdayOf = (ms, timeZone) => fmt({ weekday: 'short' }, timeZone).format(new Date(ms))
/** "12 October" */
export function dayMonthOf(ms, timeZone) {
  const parts = fmt({ day: 'numeric', month: 'long' }, timeZone).formatToParts(new Date(ms))
  const read = (type) => parts.find((p) => p.type === type)?.value || ''
  return `${read('day')} ${read('month')}`
}
/** "12 Oct" */
export function shortDayMonthOf(ms, timeZone) {
  const parts = fmt({ day: 'numeric', month: 'short' }, timeZone).formatToParts(new Date(ms))
  const read = (type) => parts.find((p) => p.type === type)?.value || ''
  return `${read('day')} ${read('month')}`
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** { year, month (1-12), day, weekday (0 = Sunday) } on the posting clock. */
export function partsOf(ms, timeZone = POSTING_ZONE) {
  const [year, month, day] = dateOf(ms, timeZone).split('-').map(Number)
  return { year, month, day, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() }
}

/** The month after this one: { year, month, name }. */
export function nextMonthOf(ms, timeZone) {
  const { year, month } = partsOf(ms, timeZone)
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }
  return { ...next, name: MONTHS[next.month - 1] }
}

/**
 * Next week on the posting clock, Monday to Sunday, as date strings:
 * { from: '2026-10-19', to: '2026-10-25', days: [...7 date strings] }.
 */
export function nextWeekOf(ms, timeZone = POSTING_ZONE) {
  const { year, month, day, weekday } = partsOf(ms, timeZone)
  const toMonday = ((8 - weekday) % 7) || 7
  const days = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(year, month - 1, day + toMonday + i)).toISOString().slice(0, 10))
  return { from: days[0], to: days[6], days }
}

/** "19 Oct" from a "2026-10-19" date string. */
export function labelOfDate(date) {
  const [, month, day] = date.split('-').map(Number)
  return `${day} ${MONTHS[month - 1].slice(0, 3)}`
}

/** "today", "tomorrow", or null when the moment is further away. */
export function nearDay(at, now, timeZone) {
  const day = dateOf(at, timeZone)
  if (day === dateOf(now, timeZone)) return 'today'
  if (day === dateOf(now + DAY_MS, timeZone)) return 'tomorrow'
  return null
}
