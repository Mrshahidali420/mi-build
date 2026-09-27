/**
 * The owner's rules, set by tapping a button on /my-admin instead of editing
 * a file. Pure: no database, no clock. Shared by the Worker (which checks
 * and writes a tap, src/lib/admin-actions.js) and the night jobs (which read
 * the rows back, scripts/plan-home.mjs and scripts/ingest-daily.mjs).
 *
 * The tables are in db/migrations/0006-owner-rules.sql.
 */
import { SECTIONS } from './home-plan.mjs'

export const OPS = ['add', 'remove']
export const KINDS = ['ban', 'pin', 'keep']
// AniList ids are positive 32-bit integers; anything past that is not an id.
const MAX_ID = 2147483647
const MAX_NOTE = 120
const KEYS = new Set(['op', 'kind', 'id', 'section', 'note'])

/** A positive whole-number id, or null. Numbers only: "12" is refused. */
export function idOf(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_ID ? value : null
}

/**
 * Check one tap's body. Returns { value } or { error }. Strict on purpose:
 * an unknown key, a wrong type or a section that does not exist is refused,
 * never guessed at, because what passes here is written into the rules the
 * homepage is planned from.
 */
export function checkTap(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'the body must be a JSON object' }
  for (const key of Object.keys(body)) if (!KEYS.has(key)) return { error: `unknown field ${key.slice(0, 20)}` }
  const { op, kind, section = '', note = '' } = body
  if (!OPS.includes(op)) return { error: 'op must be add or remove' }
  if (!KINDS.includes(kind)) return { error: 'kind must be ban, pin or keep' }
  const id = idOf(body.id)
  if (id === null) return { error: 'id must be a positive whole number' }
  if (typeof section !== 'string' || typeof note !== 'string') return { error: 'section and note must be text' }
  // A pin keeps a title in one shelf, so it must name a real one. A ban and a
  // keep have no shelf, and a stray one is a mistake worth refusing.
  const wantsSection = op === 'add' && kind === 'pin'
  if (wantsSection && !Object.hasOwn(SECTIONS, section)) return { error: 'pin needs a known section' }
  if (!wantsSection && section !== '') return { error: 'section is only for adding a pin' }
  // The note is a title's name for the rules list: no control characters, a
  // sane length. Astro escapes it when the tab draws it.
  const clean = note.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  if (clean.length > MAX_NOTE) return { error: 'note is too long' }
  return { value: { op, kind, id, section, note: clean } }
}

// -------------------------------------------------------------------- SQL

export const RULE_UPSERT = `INSERT INTO home_rules (anilist_id, action, section, note, created_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(anilist_id) DO UPDATE SET action = excluded.action, section = excluded.section,
    note = excluded.note, created_at = excluded.created_at`
export const RULE_DELETE = 'DELETE FROM home_rules WHERE anilist_id = ?'
export const KEEP_UPSERT = `INSERT INTO keep_media (anilist_id, note, created_at) VALUES (?, ?, ?)
  ON CONFLICT(anilist_id) DO UPDATE SET note = excluded.note`
export const KEEP_DELETE = 'DELETE FROM keep_media WHERE anilist_id = ?'
export const LOG_INSERT = 'INSERT INTO admin_log (at, action, anilist_id, section, note) VALUES (?, ?, ?, ?, ?)'

// What the night jobs read. Bounded, so a runaway table can never make a
// night job slow; a thousand rules is far past what one owner sets by hand.
export const RULES_READ = 'SELECT anilist_id, action, section FROM home_rules ORDER BY anilist_id LIMIT 1000'
export const KEEP_READ = 'SELECT anilist_id FROM keep_media ORDER BY anilist_id LIMIT 1000'
// What the tabs list.
export const RULES_LIST = 'SELECT anilist_id, action, section, note, created_at FROM home_rules ORDER BY created_at DESC LIMIT 200'
export const KEEP_LIST = 'SELECT anilist_id, note, created_at FROM keep_media ORDER BY created_at DESC LIMIT 200'

/** The statements one checked tap turns into, run together as one batch. */
export function tapStatements(tap, at) {
  const log = [LOG_INSERT, [at, `${tap.op} ${tap.kind}`, tap.id, tap.section, tap.note]]
  if (tap.kind === 'keep') {
    return tap.op === 'add'
      ? [[KEEP_UPSERT, [tap.id, tap.note, at]], log]
      : [[KEEP_DELETE, [tap.id]], log]
  }
  // Undo removes the title's rule whichever it was: one rule per title.
  return tap.op === 'add'
    ? [[RULE_UPSERT, [tap.id, tap.kind, tap.section, tap.note, at]], log]
    : [[RULE_DELETE, [tap.id]], log]
}

/** The answer the tab shows after a tap. */
export function savedLine(tap) {
  if (tap.kind === 'keep') {
    return tap.op === 'add'
      ? "Saved. The title is fetched at tonight's update."
      : "Removed. Applies at tonight's update."
  }
  return tap.op === 'add' ? "Saved. Applies at tonight's update." : "Undone. Applies at tonight's update."
}

// ------------------------------------------------------------ night jobs

const ids = (list) => (Array.isArray(list) ? list : []).map(Number).filter((n) => idOf(n) !== null)

/**
 * data/home-rules.json plus the rows from home_rules, as one rules object in
 * the shape planHome() already takes. The file keeps working: its bans and
 * pins are kept, the buttons add to them. A ban wins over a pin from either
 * place, because keeping a title off is the safer mistake. A pin is only a
 * request: planHome() still refuses it for anything adult or blocked.
 */
export function mergeRules(fileRules = {}, rows = []) {
  const ban = new Set(ids(fileRules.ban))
  const pin = {}
  for (const [key, list] of Object.entries(fileRules.pin || {})) pin[key] = ids(list)
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = idOf(Number(row?.anilist_id))
    if (id === null) continue
    if (row.action === 'ban') ban.add(id)
    else if (row.action === 'pin' && Object.hasOwn(SECTIONS, row.section)) {
      pin[row.section] = [...new Set([...(pin[row.section] || []), id])]
    }
  }
  for (const key of Object.keys(pin)) pin[key] = pin[key].filter((id) => !ban.has(id))
  return { ...fileRules, ban: [...ban].sort((a, b) => a - b), pin }
}

/** The keep list's media ids plus the ones kept from the Search tab. */
export function mergeKeep(keep, rows = []) {
  const extra = (Array.isArray(rows) ? rows : []).map((r) => idOf(Number(r?.anilist_id))).filter((n) => n !== null)
  return { ...keep, media: [...new Set([...(keep.media || []), ...extra])] }
}
