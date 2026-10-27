/**
 * The pace of the Page poster (owner decision, 12 Oct 2026: as many posts as
 * is safe, under Facebook's daily limit, never closer than five minutes).
 *
 * Three rules decide when the next post may go, all read from the ledger's
 * own timestamps, so no run, retry or day boundary can get round them:
 *
 *   the gap    never closer than FB_MIN_GAP_MINUTES to the post before it
 *              (5 by default, and never less than 5)
 *   the cap    never more than FB_POSTS_PER_DAY posts in any 24 hours. The
 *              day is ROLLING, counted back from now, so midnight cannot
 *              open the door to a burst. Unset means 24; the ceiling is 288
 *   the pace   with a cap, posts are spread evenly: 24 a day is one an hour
 *
 * A claim, a post and a failure all count; a dry run never does.
 *
 * Reels have a lane of their own (owner decision, 28 Oct 2026): they are not
 * counted in FB_POSTS_PER_DAY and take no post's slot. FB_REELS_PER_DAY reels
 * in any 24 hours, spread evenly over the day the same way, and no post of
 * either lane closer than MIN_GAP_MINUTES to a post of the other (`others`).
 *
 * Pure: the clock is passed in.
 */

/** The clock the audience lives by; every time in a summary is on it. */
export const POSTING_ZONE = 'America/New_York'
export const MINUTE_MS = 60_000
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS
/** The owner's floor: two posts on one Page are never closer than this. */
export const MIN_GAP_MINUTES = 5
const MAX_GAP_MINUTES = 24 * 60
/** Unset means this many a day: under the 25 a day third parties report for business Pages. */
export const DEFAULT_PER_DAY = 24
/** One every five minutes, all day. The cap can be raised to this by hand, never past it. */
export const MAX_PER_DAY = 288

const whole = (value) => {
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) ? n : 0
}

/** FB_MIN_GAP_MINUTES as a number: 5 when unset, and never under 5. */
export const gapMinutesOf = (value) => Math.min(MAX_GAP_MINUTES, Math.max(MIN_GAP_MINUTES, whole(value)))

/** FB_POSTS_PER_DAY as a number: 24 when unset or 0, and never over the ceiling. */
export const perDayOf = (value) => (whole(value) > 0 ? Math.min(whole(value), MAX_PER_DAY) : DEFAULT_PER_DAY)

/** Reels in any 24 hours when FB_REELS_PER_DAY is unset, and the most it can be set to. Facebook's own limit is 30. */
export const DEFAULT_REELS_PER_DAY = 3
export const MAX_REELS_PER_DAY = 10

/** FB_REELS_PER_DAY as a number: 3 when unset, 0 switches reels off, never over 10. */
export const reelsPerDayOf = (value) => (String(value ?? '').trim() === '' || !Number.isFinite(Number.parseInt(value, 10)) ? DEFAULT_REELS_PER_DAY : Math.min(MAX_REELS_PER_DAY, Math.max(0, whole(value))))

/** One Page's entries that count against the pace (everything but a dry run), oldest first. */
export const countedEntries = (ledger, page) => (ledger?.entries || []).filter((e) => e.page === page && e.status !== 'dry').sort((x, y) => x.at - y.at)

/** The two lanes of one Page's entries: the posts (shares too) and the reels. */
export const postLane = (entries) => entries.filter((e) => !e.reel)
export const reelLane = (entries) => entries.filter((e) => e.reel)

/** The entries of the last 24 hours. */
export const inWindow = (entries, now) => entries.filter((e) => e.at > now - DAY_MS)

export const rollingCount = (entries, now) => inWindow(entries, now).length

/** When the last entry was written, or 0. */
export const lastAt = (entries) => entries.reduce((latest, e) => Math.max(latest, e.at || 0), 0)

/** The time between two posts: the day shared out evenly over the cap, and never under the gap. */
export const spacingMs = (cap, gapMinutes) => Math.max(gapMinutes * MINUTE_MS, Math.ceil(DAY_MS / Math.max(1, cap)))

/** When the rolling day has room again: the moment enough of its oldest entries turn 24 hours old. */
function roomAt(entries, now, cap) {
  const window = inWindow(entries, now).sort((x, y) => x.at - y.at)
  return window.length >= cap ? window[window.length - cap].at + DAY_MS : 0
}

/**
 * How long to wait before the next post, and why.
 * @param entries one Page's counted entries (countedEntries)
 * @param blockedUntil no posts before this moment (a block signal from Facebook)
 * @param holdUntil no posts before this moment (a back-off after throttling)
 * @param even false for a manual run, which keeps the gap and the cap but not the even pace
 * @param others the other lane's entries: none may be closer than MIN_GAP_MINUTES
 * @returns {{ ms: number, why: 'due'|'gap'|'pace'|'cap'|'block'|'backoff', at: number }}
 */
export function nextWait({ entries, now, cap, gapMinutes = MIN_GAP_MINUTES, blockedUntil = 0, holdUntil = 0, even = true, others = [] }) {
  const gap = gapMinutes * MINUTE_MS
  const spacing = even ? spacingMs(cap, gapMinutes) : gap
  const last = lastAt(entries)
  const reasons = [
    { at: last ? last + spacing : 0, why: spacing > gap ? 'pace' : 'gap' },
    { at: roomAt(entries, now, cap), why: 'cap' },
    { at: others.length ? lastAt(others) + MIN_GAP_MINUTES * MINUTE_MS : 0, why: 'gap' },
    { at: holdUntil, why: 'backoff' },
    { at: blockedUntil, why: 'block' },
  ]
  const latest = reasons.reduce((worst, reason) => (reason.at >= worst.at ? reason : worst), { at: 0, why: 'due' })
  return latest.at > now ? { ms: latest.at - now, why: latest.why, at: latest.at } : { ms: 0, why: 'due', at: now }
}
