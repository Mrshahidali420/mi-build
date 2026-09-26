/**
 * The bridge from My list, the For you feed, site search and the 404 page to
 * our own counter (the `mi()` queue set up inline in src/layouts/Base.astro).
 *
 * Every row rides the same queue as the page views, so none of this costs a
 * single extra request: the rows leave with the rest of the visit.
 *
 * What may leave the browser is decided by an allow-list of fields, not by the
 * callers. toOwnRow() reads a handful of named keys and nothing else, so a
 * list name, an AniList username or any key added later can never be sent.
 * The Worker checks everything again (src/lib/beacon-rows.js).
 */
import { normalizeQuery } from './finder-core.js'
import { homeSection, homeSeenDetail } from './home-sections.js'

// For each action: which of the caller's keys fills which column. A key not
// named here is never read.
//   item   = the AniList title id
//   detail = one short word (a status, a result, "in" / "out")
//   pos    = one small number (a position, a count)
//   label  = the title's public name, only for actions about one title
const SHAPES = {
  list_add: { item: 'title_id', detail: 'status', label: true },
  list_remove: { item: 'title_id', label: true },
  list_status: { item: 'title_id', detail: 'status', label: true },
  list_toggle: { item: 'title_id', detail: 'in_list', label: true },
  list_create: { pos: 'lists' },
  list_rename: {},
  list_delete: { pos: 'lists' },
  anilist_import: { detail: 'result', pos: 'matched' },
  my_list_view: { pos: 'titles' },
  feed_view: { pos: 'picks' },
  feed_click: { item: 'title_id', detail: 'position', pos: 'position', label: true },
  // The homepage shelves. home_seen is one row per homepage view naming every
  // shelf that was on screen, never one per shelf or per cover; home_click is
  // the title opened, its shelf and its place in it.
  home_seen: { detail: 'sections', pos: 'shown' },
  home_click: { item: 'title_id', detail: 'section', pos: 'slot', label: true },
}

// Opened once is enough to know a person looked. Counting every reload only
// costs database writes and says nothing new.
export const ONCE_PER_VISIT = new Set(['feed_view', 'my_list_view'])

const short = (value, max) =>
  String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

const count = (value) => {
  const n = Math.round(Number(value))
  return Number.isFinite(n) && n > 0 ? Math.min(n, 500) : 0
}

// An AniList id: a whole number, never capped like a count.
const titleId = (value) => {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 && n < 1e9 ? String(n) : ''
}

/** One of the page's own actions as a counter row, or null to send nothing. */
export function toOwnRow(name, params = {}) {
  const shape = SHAPES[name]
  if (!shape) return null
  const p = params && typeof params === 'object' ? params : {}
  let detail = shape.detail ? short(p[shape.detail], 40) : ''
  if (shape.detail === 'in_list') detail = Number(p.in_list) ? 'in' : 'out'
  if (name === 'home_seen') detail = homeSeenDetail(p.sections)
  if (name === 'home_click') detail = homeSection(p.section)
  const row = {
    name,
    kind: 'act',
    item: shape.item ? titleId(p[shape.item]) : '',
    detail,
    pos: shape.pos ? count(p[shape.pos]) : 0,
    label: shape.label ? short(p.title, 120) : '',
  }
  // An action about one title with no title id is a broken call. Drop it.
  if (shape.item && !row.item) return null
  // A homepage row that names none of our shelves says nothing.
  if ((name === 'home_seen' || name === 'home_click') && !row.detail) return null
  return row
}

/** A search result that was picked. `surface` is 'dropdown' or 'page'. */
export function searchPickRow(href, surface, pos, title) {
  let path = ''
  try {
    path = new URL(href, 'https://manhwaindex.com').pathname
  } catch (e) {
    return null
  }
  if (!path || path === '/') return null
  return {
    name: 'search_pick',
    kind: 'search',
    item: path.slice(0, 150),
    detail: surface === 'page' ? 'page' : 'dropdown',
    pos: count(pos),
    label: short(title, 120),
  }
}

/**
 * The homepage shelves a reader saw, gathered while the page is open and sent
 * as ONE row, once per page view. A row per shelf, or per cover, would
 * multiply the database writes by the number of shelves for no extra answer:
 * the planner only needs "this view saw these shelves".
 *   saw(key)  a shelf was on screen long enough; unknown keys are ignored
 *   flush()   send the row now (the page is being left); later calls do nothing
 */
export function seenBatch(send = sendOwn) {
  const seen = new Set()
  let sent = false
  return {
    saw(key) {
      if (!sent && homeSection(key)) seen.add(key)
    },
    flush() {
      if (sent || !seen.size) return null
      sent = true
      const row = toOwnRow('home_seen', { sections: [...seen], shown: seen.size })
      send(row)
      return row
    },
  }
}

/** A search that found nothing, or null when its words must not be sent. */
export function searchNoneRow(query, surface) {
  const words = normalizeQuery(query)
  if (!words) return null
  return { name: 'search_none', kind: 'search', item: words, detail: surface === 'page' ? 'page' : 'dropdown', pos: 0, label: '' }
}

/** A click on one of the 404 page's "where to go next" links. */
export function missNextRow(href) {
  let path = ''
  try {
    path = new URL(href, 'https://manhwaindex.com').pathname
  } catch (e) {
    return null
  }
  return path ? { name: 'miss_next', kind: 'act', item: path.slice(0, 150), detail: '', pos: 0, label: '' } : null
}

/**
 * Hand one row to the page's counter. It never throws: counting must never
 * break a button. A blocker that removed the counter simply means no row.
 */
export function sendOwn(row) {
  if (!row) return
  try {
    if (typeof window === 'undefined' || typeof window.mi !== 'function') return
    if (ONCE_PER_VISIT.has(row.name)) {
      const key = `mi_once_${row.name}`
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
    }
    window.mi(row)
  } catch (e) {
    // Counting must never break the page.
  }
}

/**
 * Watch one search box for searches that find nothing. The words are sent
 * once the person stops typing (1.5 s), leaves the box or submits, and only
 * once per distinct set of words on this page.
 */
export function noneWatcher(surface, wait = 1500) {
  const sent = new Set()
  let timer = null
  let pending = ''
  const flush = () => {
    clearTimeout(timer)
    timer = null
    const words = normalizeQuery(pending)
    pending = ''
    if (!words || sent.has(words)) return
    sent.add(words)
    sendOwn(searchNoneRow(words, surface))
  }
  return {
    // Call with the query after every search: found says whether it matched.
    saw(query, found) {
      clearTimeout(timer)
      if (found) {
        pending = ''
        return
      }
      pending = query
      timer = setTimeout(flush, wait)
    },
    flush,
  }
}
