/**
 * What the Worker is willing to write for one row the page sent.
 *
 * Kept apart from src/worker.js so it can be tested without a Worker: it is a
 * plain function from "what the page said" to "what goes in the database", or
 * null when the row must not be written at all.
 *
 * The page is never trusted. Every field is cut to a sane length here, every
 * kind and every action name comes from a fixed list, and the words of a
 * search are cleaned a second time, because anyone can change a page.
 */
import { normalizeQuery } from './finder-core.js'
import { homeSection, homeSeenDetail } from './home-sections.js'

// The only words allowed in the kind column. Anything else becomes 'other', so
// a made up value can never widen a table or break a count.
//   act    = something done with My list, the For you feed or the 404 page
//   search = a search result picked, or a search that found nothing
export const KINDS = new Set(['view', 'read', 'watch', 'buy', 'other', 'leave', 'missing', 'act', 'search'])

// Every action the page may send. An act or search row with any other name is
// dropped, so a new button can never start writing rows nobody reads.
export const ACT_NAMES = new Set([
  'list_add',
  'list_remove',
  'list_status',
  'list_toggle',
  'list_create',
  'list_rename',
  'list_delete',
  'anilist_import',
  'my_list_view',
  'feed_view',
  'feed_click',
  'miss_next',
  'home_seen',
  'home_click',
])
export const SEARCH_NAMES = new Set(['search_pick', 'search_none'])

// The actions that are about one title. Only these may carry a title id and
// its name. The rest are counts only: a list name or an AniList username can
// never reach the database, even from a page that was changed to send one.
const TITLE_ACTS = new Set(['list_add', 'list_remove', 'list_status', 'list_toggle', 'feed_click', 'home_click'])

// Where an Amazon link sat: the hand-picked Top picks, the BuyBox on a title
// page, the /shop page, the theme songs box, or a membership trial card on the
// shop shelf (Prime Video, Kindle Unlimited).
export const BUY_SOURCES = new Set(['pick', 'buybox', 'shop', 'themes', 'trial'])

// The longest time on page we believe: 30 minutes. A tab left open all night
// must not pull the average up.
export const MAX_DWELL = 1800000
// A row can wait in the tab for a day at most before it is sent.
export const MAX_AGE = 86400000

// The column order of the insert below. cleanRow() returns its values in this
// same order, so the two can never drift apart.
export const COLUMNS = [
  'ts', 'day', 'name', 'kind', 'path', 'page_type', 'label', 'platform', 'shop_kind',
  'target', 'country', 'referrer', 'device', 'visitor', 'session', 'step', 'prev',
  'prev_type', 'dwell', 'campaign', 'item', 'detail', 'pos',
]
export const INSERT_SQL = `INSERT INTO events (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(',')})`

/** Text, one line, cut to a length. */
export const text = (value, max) =>
  String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

/** A whole number we can trust, or zero. */
export const whole = (value, max) => {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || n < 0) return 0
  return n > max ? max : n
}

// A short word: a status, a result code, a surface. Letters, digits, _ and -.
const WORD = /^[A-Za-z0-9_-]{1,40}$/
const word = (value) => {
  const w = text(value, 40)
  return WORD.test(w) ? w : ''
}

// One of our own page addresses. Nothing else is kept as a picked result.
const OWN_PATH = /^\/(?:[a-z0-9][a-z0-9\-/]{0,148})?$/
const ownPath = (value) => {
  const p = text(value, 150)
  return OWN_PATH.test(p) ? p : ''
}

/**
 * The item, detail, pos and label of an act or search row, or null when the
 * row must be dropped.
 */
function actionFields(kind, name, row) {
  if (kind === 'search') {
    if (!SEARCH_NAMES.has(name)) return null
    const surface = row.detail === 'page' ? 'page' : 'dropdown'
    if (name === 'search_none') {
      const words = normalizeQuery(row.item)
      if (!words) return null
      return { item: words, detail: surface, pos: 0, label: '' }
    }
    const path = ownPath(row.item)
    if (!path) return null
    return { item: path, detail: surface, pos: whole(row.pos, 500), label: text(row.label, 120) }
  }

  if (!ACT_NAMES.has(name)) return null
  // The homepage shelves: detail must name only our own shelves, so these
  // two can never become a way to store free text.
  if (name === 'home_seen') {
    const said = word(row.detail)
    const detail = homeSeenDetail(said)
    if (!detail || said.split('-').some((key) => !homeSection(key))) return null
    return { item: '', detail, pos: whole(row.pos, 10), label: '' }
  }
  if (name === 'home_click') {
    const id = whole(row.item, 1e9)
    const detail = homeSection(row.detail)
    if (!id || !detail) return null
    return { item: String(id), detail, pos: whole(row.pos, 50), label: text(row.label, 120) }
  }
  if (name === 'miss_next') {
    const path = ownPath(row.item)
    if (!path) return null
    return { item: path, detail: '', pos: 0, label: '' }
  }
  if (TITLE_ACTS.has(name)) {
    const id = whole(row.item, 1e9)
    if (!id) return null
    return { item: String(id), detail: word(row.detail), pos: whole(row.pos, 500), label: text(row.label, 120) }
  }
  // A count only: never an item, never a label.
  return { item: '', detail: word(row.detail), pos: whole(row.pos, 500), label: '' }
}

/**
 * One row as the database will hold it, as an array in COLUMNS order, or null
 * when the row must not be written.
 */
export function cleanRow(row, country, now) {
  if (!row || typeof row !== 'object') return null
  const said = text(row.kind, 20) || 'view'
  const kind = KINDS.has(said) ? said : 'other'
  const name = text(row.name, 60) || 'page_view'

  let item = ''
  let detail = ''
  let pos = 0
  let label = text(row.label, 120)
  if (kind === 'act' || kind === 'search') {
    const fields = actionFields(kind, name, row)
    if (!fields) return null
    ;({ item, detail, pos, label } = fields)
  } else if (kind === 'buy') {
    detail = BUY_SOURCES.has(row.detail) ? row.detail : ''
  }

  // The tab says how long ago each row happened, so a batch sent at the end
  // still keeps the real order and the real times.
  const ts = now - whole(row.age, MAX_AGE)
  const plain = kind === 'act' || kind === 'search'
  return [
    ts,
    new Date(ts).toISOString().slice(0, 10),
    name,
    kind,
    text(row.path, 200),
    text(row.page_type, 40),
    label,
    plain ? '' : text(row.platform, 60),
    plain ? '' : text(row.shop_kind, 20),
    plain ? '' : text(row.target, 300),
    text(country, 2),
    text(row.referrer, 120),
    text(row.device, 10),
    text(row.visitor, 40),
    text(row.session, 40),
    whole(row.step, 500),
    text(row.prev, 200),
    text(row.prev_type, 40),
    whole(row.dwell, MAX_DWELL),
    text(row.campaign, 120),
    item,
    detail,
    pos,
  ]
}
