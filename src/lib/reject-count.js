/**
 * Counting what the counter refuses.
 *
 * The beacon (/_a) and the pass desk (/_p) in src/worker.js turn robots away:
 * no Turnstile pass, nothing is written. That rule stays exactly as it is, so
 * every number on /my-admin is still real people. What was missing is the
 * other side: how much was turned away, and why. A jump there is the first
 * sign of an attack, and it was invisible.
 *
 * The danger is cost. A robot flood is exactly when the refused hits pour in,
 * and writing one row per refused hit would let an attacker spend our D1
 * write allowance for us (the reason the pass exists at all). So:
 *
 *   - Each Worker isolate keeps its own counts in memory, keyed by day,
 *     reason, place and country.
 *   - It writes them at most once every FLUSH_MS, as one D1 batch of UPSERTs
 *     that add to the day's rows. The first hit after a quiet spell is
 *     written at once, so a quiet day loses nothing; a flood of a million
 *     hits in an hour costs each isolate at most 60 writes of at most
 *     MAX_KEYS rows, not a million rows.
 *   - Past MAX_KEYS keys in one window, new countries are folded into '--'
 *     (and past twice that, the place too), so a botnet spread over every
 *     country cannot widen a batch either.
 *   - The table is WITHOUT ROWID, so its primary key is the table itself and
 *     each upsert is one written row, not two (a row plus its index).
 *
 * The price: counts an isolate holds when Cloudflare retires it are lost, up
 * to one window's worth. For a "how many robots and why" card that is fine;
 * the real readers are counted elsewhere and never depend on this.
 *
 * Workers Analytics Engine would do this with no D1 writes at all, but it is
 * not bound to this Worker and reading it back needs an API token in the
 * Worker; this needs nothing new.
 */

export const FLUSH_MS = 60000
export const MAX_KEYS = 20
// D1 takes at most 100 bound values in one statement; 5 per row.
const ROWS_PER_STATEMENT = 20

// Every reason the code can give, with the words /my-admin shows. 'ok' and
// 'pass_ok' are the ones let in, counted the same cheap way so the card can
// say what share was refused.
export const REASONS = {
  ok: 'Let in: a beacon with a good pass',
  pass_ok: 'Let in: Turnstile passed, pass given',
  no_pass: 'Beacon without a pass',
  old_pass: 'Beacon with an expired pass',
  bad_pass: 'Beacon with a forged or broken pass',
  bad_body: 'Beacon empty or too big',
  bad_json: 'Beacon that is not JSON',
  bad_row: 'Row refused by the field checks',
  wrong_method: 'Not a POST (a crawler fetching the address)',
  pass_bad_ask: 'Pass asked for without a Turnstile ticket',
  pass_refused: 'Turnstile said no',
  pass_error: 'Turnstile could not be reached',
}
export const LET_IN = new Set(['ok', 'pass_ok'])

// Where the hit was aimed. For the beacon it is the page type the body names,
// but only from this list: the body is written by whoever sent it.
export const PLACES = new Set([
  'home', 'manhwa', 'manga', 'manhua', 'novel', 'anime', 'character', 'shop', 'genre', 'mood',
  'platform', 'search', 'schedule', 'where-to-watch', 'where-to-read', 'my-list', 'about',
  'privacy', 'contact', 'dmca', 'pass', 'other',
])

export const placeOf = (value) => {
  const p = String(value == null ? '' : value).slice(0, 30)
  return PLACES.has(p) ? p : 'other'
}

/** Cloudflare's two letters (XX unknown, T1 Tor), or '--'. */
export const countryOf = (value) => {
  const c = String(value == null ? '' : value).toUpperCase()
  return /^[A-Z0-9]{2}$/.test(c) ? c : '--'
}

/**
 * One isolate's counts. add() never touches the database; take() hands back
 * the rows to write when a window has passed, or null.
 */
export function rejectCounter({ flushMs = FLUSH_MS, maxKeys = MAX_KEYS } = {}) {
  let pending = new Map()
  let lastTake = 0

  const bump = (key, parts, n) => {
    const found = pending.get(key)
    if (found) found.n += n
    else pending.set(key, { ...parts, n })
  }

  return {
    add(reason, place, country, now = Date.now(), n = 1) {
      if (!REASONS[reason] || !(n > 0)) return
      const day = new Date(now).toISOString().slice(0, 10)
      let parts = { day, reason, place: placeOf(place), country: countryOf(country) }
      let key = `${day}|${reason}|${parts.place}|${parts.country}`
      if (!pending.has(key) && pending.size >= maxKeys) {
        parts = { ...parts, country: '--' }
        key = `${day}|${reason}|${parts.place}|--`
        if (!pending.has(key) && pending.size >= maxKeys * 2) {
          parts = { ...parts, place: 'other' }
          key = `${day}|${reason}|other|--`
        }
      }
      bump(key, parts, n)
    },
    /** The rows to write now, or null while the window is still open. */
    take(now = Date.now()) {
      if (!pending.size || (lastTake && now - lastTake < flushMs)) return null
      lastTake = now
      const rows = [...pending.values()]
      pending = new Map()
      return rows
    },
    size: () => pending.size,
  }
}

/** One UPSERT for up to ROWS_PER_STATEMENT rows. */
export function upsertSql(count) {
  const values = Array.from({ length: count }, () => '(?,?,?,?,?)').join(',')
  return `INSERT INTO daily_rejects (day, reason, place, country, n) VALUES ${values}
     ON CONFLICT(day, reason, place, country) DO UPDATE SET n = n + excluded.n`
}

/** Write taken rows as one D1 batch (one request, however many rows). */
export async function writeRejects(db, rows) {
  if (!db || !rows || !rows.length) return 0
  const statements = []
  for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
    const chunk = rows.slice(i, i + ROWS_PER_STATEMENT)
    const args = chunk.flatMap((r) => [r.day, r.reason, r.place, r.country, r.n])
    statements.push(db.prepare(upsertSql(chunk.length)).bind(...args))
  }
  await db.batch(statements)
  return rows.length
}
