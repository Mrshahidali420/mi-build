/**
 * The pace of the Page poster: one post per hourly run, spread evenly over
 * the posting day (the US Eastern day the ledger counts by).
 *
 * The day is cut into `perDay` equal parts and one post is due at the start
 * of each part. A run posts only while the day is behind that line, so a cap
 * of 8 gives a post about every 3 hours (00:00, 03:00, ... 21:00 ET) and a
 * cap of 24 gives one an hour. A run that was late or lost is caught up one
 * post per later run, never in a burst.
 *
 * Pure: the clock is passed in.
 */

export const MINUTES_PER_DAY = 1440
export const POSTING_ZONE = 'America/New_York'

/** Minutes since midnight on the posting clock. */
export function minuteOfDay(ms, timeZone = POSTING_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms))
  const read = (type) => Number(parts.find((p) => p.type === type)?.value || 0)
  return read('hour') * 60 + read('minute')
}

/** How many posts should be out by now when `perDay` are spread evenly. */
export function dueBy(ms, perDay, timeZone = POSTING_ZONE) {
  if (!(perDay > 0)) return 0
  return Math.min(perDay, Math.floor((minuteOfDay(ms, timeZone) * perDay) / MINUTES_PER_DAY) + 1)
}

/** True when a scheduled run should post: the day is behind the even pace. */
export const isBehind = (done, ms, perDay, timeZone = POSTING_ZONE) => done < dueBy(ms, perDay, timeZone)

/** "15:00": when post number `done + 1` falls due, or null when the day is full. */
export function nextDueTime(done, perDay) {
  if (!(perDay > 0) || done >= perDay) return null
  const minute = Math.ceil((done * MINUTES_PER_DAY) / perDay)
  const two = (n) => String(n).padStart(2, '0')
  return `${two(Math.floor(minute / 60))}:${two(minute % 60)}`
}
