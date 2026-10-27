/**
 * Watching Facebook's limits, so the daily cap can be found safely.
 *
 * Meta publishes no daily post cap for a Page. The only official limit is a
 * call budget (error code 32, the usage headers). So the poster starts under
 * the 25 a day third parties report, and writes down every sign of a limit
 * in the ledger (`health`), where the owner reads it before raising the cap
 * by hand. Nothing here ever raises a cap.
 *
 *   throttle   the call budget (codes 4, 17, 32, 341, 613, 80000-80014, HTTP
 *              429, or a usage header at 90% and up): back off, doubling the
 *              wait up to an hour
 *   block      Facebook refused the content or the pace (code 368, or a
 *              message about being blocked, spam or going too fast): no more
 *              posts for 24 hours, and the cap drops to 75% of what the Page
 *              had reached. Changing FB_POSTS_PER_DAY by hand lifts the cut
 *
 * `halted` is the note a chain leaves when it stops for the owner (a refused
 * token, too many failures in a row); the watch job reads it and does not
 * start a new chain over it.
 *
 * Pure but for saveHealth(), which writes through the ledger's store.
 */
import { DAY_MS, HOUR_MS, MINUTE_MS } from './pace.mjs'

export const USAGE_HIGH = 90
export const CUT_SHARE = 0.75
const KEEP_SIGNALS = 50
const NOTE_MAX = 160

const THROTTLE_CODES = new Set([4, 17, 32, 341, 613])
const BLOCK_CODES = new Set([368])
const isPageLimit = (code) => code >= 80000 && code <= 80014
const BLOCK_WORDS = /temporarily blocked|blocked from|has been blocked|spam|abus|misus|restricted from|too fast|community standards/i
const THROTTLE_WORDS = /rate limit|too many calls|request limit|limit reached|reduce the amount/i

const short = (text) => String(text || '').replace(/\s+/g, ' ').slice(0, NOTE_MAX)

/** What a Graph error says about a limit: { kind, code, note }, or null when it says nothing. */
export function signalOf(error) {
  if (!error) return null
  const code = Number(error.code) || 0
  const note = short(error.message)
  if (BLOCK_CODES.has(code) || BLOCK_WORDS.test(note)) return { kind: 'block', code, note }
  if (THROTTLE_CODES.has(code) || isPageLimit(code) || error.status === 429 || THROTTLE_WORDS.test(note)) return { kind: 'throttle', code, note }
  return null
}

/** A usage header near its limit is a throttle signal before any call fails. */
export const usageSignal = (usage) => (usage && usage.pct >= USAGE_HIGH ? { kind: 'throttle', code: 0, note: `${usage.source} at ${usage.pct}%` } : null)

/** The wait after the n-th throttle signal in a row: the gap doubled each time, an hour at most. */
export const backoffMs = (step, gapMinutes) => Math.min(HOUR_MS, gapMinutes * MINUTE_MS * 2 ** Math.max(1, step))

export const emptyHealth = () => ({ signals: [], peak: null, cut: null, blockedUntil: 0, halted: null })

/** The cap in force: the owner's, or the lower one a block left behind while the owner's number is unchanged. */
export const effectiveCap = (health, perDay) => (health?.cut && health.cut.perDay === perDay ? Math.min(perDay, health.cut.cap) : perDay)

/**
 * The health record with one more signal. A block also stops posting for 24
 * hours and cuts the cap to 75% of the posts the Page had reached.
 * @param reached posts in the rolling day when the signal came
 */
export function withSignal(health, signal, { now, reached, perDay, usage = null }) {
  const base = { ...emptyHealth(), ...health }
  const signals = [...base.signals, { at: now, ...signal, reached, usage: usage?.pct ?? null }].slice(-KEEP_SIGNALS)
  if (signal.kind !== 'block') return { ...base, signals }
  const cap = Math.max(1, Math.floor(Math.max(1, reached) * CUT_SHARE))
  return { ...base, signals, blockedUntil: now + DAY_MS, cut: { cap, reached, perDay, at: now } }
}

/** The health record with the highest usage percentage of the last 24 hours. */
export function withPeak(health, usage, now) {
  const base = { ...emptyHealth(), ...health }
  if (!usage || !(usage.pct >= 0)) return base
  const stale = !base.peak || base.peak.at < now - DAY_MS
  return stale || usage.pct > base.peak.pct ? { ...base, peak: { pct: usage.pct, source: usage.source, at: now } } : base
}

export const withHalt = (health, why, now) => ({ ...emptyHealth(), ...health, halted: why ? { why: short(why), at: now } : null })

/** The health record with the last failure of a reel: what Facebook said, for the owner to read. */
/** The same for a share (share.mjs). */
export const withShareFailure = (health, error, now) => ({ ...emptyHealth(), ...health, share: { at: now, code: Number(error?.code) || 0, note: short(error?.message) } })
export const withReelFailure = (health, error, now) => ({ ...emptyHealth(), ...health, reel: { at: now, code: Number(error?.code) || 0, note: short(error?.message) } })

const SAVE_TRIES = 6

/** Change the health record in the ledger (compare-and-swap, like a claim). Returns the new record. */
export async function saveHealth(store, change, message = 'Health') {
  for (let i = 0; i < SAVE_TRIES; i += 1) {
    const { data, version } = await store.read()
    const before = { ...emptyHealth(), ...data.health }
    const after = change(before)
    if (JSON.stringify(after) === JSON.stringify(before)) return after
    if (await store.write({ ...data, health: after }, version, message)) return after
  }
  return null
}
