/**
 * The phase 3 views of /my-admin, as pure functions: dead-end pages and why,
 * money per page, the country mix per title, and the daily "3 things changed"
 * box. The queries live in src/lib/admin-extra.js; nothing here reads D1, the
 * catalog or the clock, so the tests call it with plain rows.
 *
 * Every rule has a floor. A page with a handful of views swings from 0 to 100
 * percent on one click, and a list built on those swings points the owner at
 * noise.
 */
import { factsFor } from './platform-facts.js'
import { needsAlike } from './alike.mjs'

// Title pages only: /manhwa/<slug>, not /manhwa/<slug>/free.
const TITLE_TYPES = new Set(['manhwa', 'manga', 'manhua', 'novel', 'anime'])
export const isTitlePath = (path) => {
  const parts = String(path || '').split('/').filter(Boolean)
  return parts.length === 2 && TITLE_TYPES.has(parts[0])
}

const rateOf = (clicks, views) => (views > 0 ? (Number(clicks) || 0) / views : 0)

// ------------------------------------------------------------ dead-end pages

// A page needs this many arrivals before its missing clicks are worth a row.
export const DEAD_MIN_ENTRIES = 10
// Title pages with fewer views than this do not set the site's usual rate.
export const DEAD_RATE_FLOOR = 20

/** The middle hand-off rate of title pages with enough views: the bar. */
export function usualRate(rows, floor = DEAD_RATE_FLOOR) {
  const rates = rows
    .filter((r) => isTitlePath(r.path) && (Number(r.views) || 0) >= floor)
    .map((r) => rateOf(r.clicks, r.views))
    .sort((a, b) => a - b)
  if (!rates.length) return 0
  const mid = Math.floor(rates.length / 2)
  return rates.length % 2 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2
}

/**
 * Title pages that collect arrivals and send few of them on, worst first.
 * lost = arrivals x how far the page's hand-off rate falls short of the
 * usual one: the clicks out a normal page would have made from the same
 * readers. Clicks here are every click out, Amazon included, the same number
 * the rest of the Pages tab uses.
 */
export function deadEnds(rows, { minEntries = DEAD_MIN_ENTRIES, limit = 12, usual = usualRate(rows) } = {}) {
  return rows
    .filter((r) => isTitlePath(r.path) && (Number(r.entries) || 0) >= minEntries)
    .map((r) => {
      const views = Number(r.views) || 0
      const rate = rateOf(r.clicks, views)
      const lost = Math.round((Number(r.entries) || 0) * Math.max(0, usual - rate))
      return { ...r, rate, lost }
    })
    .filter((r) => r.lost > 0)
    .sort((a, b) => b.lost - a.lost || (a.path < b.path ? -1 : 1))
    .slice(0, limit)
}

// Where each platform works, from src/lib/platform-facts.js, as country codes.
// "Some countries" and a platform we hold no facts for say nothing: the reason
// is only given when every platform is known to miss the reader's country.
const REGION_CODES = {
  Worldwide: '*',
  Korea: ['KR'],
  Japan: ['JP'],
  China: ['CN'],
  'US and Canada': ['US', 'CA'],
}

/** The country codes a platform serves, '*' for everywhere, null if unknown. */
export const platformCountries = (site) => REGION_CODES[factsFor(site).region] ?? null

/**
 * Why a dead-end page loses its readers, from the title record and where its
 * arrivals come from. Returns { key, text } or null when the record shows no
 * cause (the page has platforms that work: the layout is the question then).
 *   item: the title record (loadTitle), or null when it could not be read
 *   buys: Amazon clicks on the page in the window
 *   country / countryLabel: where most arrivals came from
 */
export function deadReason(item, { buys = 0, country = '', countryLabel = country } = {}) {
  if (!item) return null
  const isAnime = item.kind === 'anime'
  const links = (isAnime ? item.watchLinks : item.readLinks) || []
  if (!links.length) {
    return buys > 0
      ? { key: 'amazon', text: 'Amazon only: no licence listed, so the shop box is the only way out' }
      : { key: 'licence', text: 'No licence listed: nothing on the page to click through to' }
  }
  if (!isAnime && needsAlike(item)) {
    const langs = [...new Set(links.map((l) => l.language).filter(Boolean))]
    return { key: 'language', text: `Only official in ${langs.join(', ')}: no English platform` }
  }
  if (country) {
    const reach = links.map((l) => platformCountries(l.site))
    const known = reach.every((r) => r !== null)
    const serves = reach.some((r) => r === '*' || (Array.isArray(r) && r.includes(country)))
    if (known && !serves) {
      return { key: 'country', text: `No platform works in ${countryLabel}, where most arrivals come from` }
    }
  }
  return null
}

// ------------------------------------------------------------ countries

/**
 * path -> countries of its views, biggest first, with each one's share.
 * rows: [{ path, country, n }]. Unknown countries are kept and named by the
 * page, so the shares always add up to the whole.
 */
export function countriesByPath(rows, top = 3) {
  const by = new Map()
  for (const r of rows) {
    const n = Number(r.n) || 0
    if (!n) continue
    if (!by.has(r.path)) by.set(r.path, [])
    by.get(r.path).push({ country: r.country || '', n })
  }
  const out = new Map()
  for (const [path, list] of by) {
    const total = list.reduce((s, c) => s + c.n, 0)
    list.sort((a, b) => b.n - a.n || (a.country < b.country ? -1 : 1))
    out.set(path, { total, top: list.slice(0, top).map((c) => ({ ...c, share: Math.round((c.n / total) * 100) })) })
  }
  return out
}

// ------------------------------------------------------------ money per page

// Pages under this many views are left out of money per page: one Amazon
// click on 12 views would read as 83 per 1,000 and top the list.
export const MONEY_MIN_VIEWS = 50

/** Amazon clicks per 1,000 views, one decimal. */
export const perThousand = (buys, views) =>
  views > 0 ? Math.round(((Number(buys) || 0) / views) * 10000) / 10 : 0

/** Rows with views and buys, as { ..., per1k }, best first, over the floor. */
export function moneyPer(rows, { floor = MONEY_MIN_VIEWS, limit = 15 } = {}) {
  return rows
    .filter((r) => (Number(r.views) || 0) >= floor)
    .map((r) => ({ ...r, per1k: perThousand(r.buys, Number(r.views)) }))
    .sort((a, b) => b.per1k - a.per1k || (Number(b.views) || 0) - (Number(a.views) || 0))
    .slice(0, limit)
}

// ------------------------------------------------------------ 3 things changed

// A change is only news when the bigger side has this many opens or arrivals.
export const CHANGE_MIN = 20
// And when yesterday is this far from the usual day, up or down.
export const CHANGE_UP = 1.5
export const CHANGE_DOWN = 0.6

/**
 * Yesterday against the usual day before it, per key. rows: [{ day, key,
 * label?, n }]. `last` is yesterday; every other day in the rows is the usual.
 */
function movesOf(rows, last) {
  const days = new Set(rows.filter((r) => r.day !== last).map((r) => r.day))
  const baseDays = Math.max(days.size, 1)
  const by = new Map()
  for (const r of rows) {
    const it = by.get(r.key) || { key: r.key, label: '', y: 0, sum: 0 }
    if (r.day === last) it.y += Number(r.n) || 0
    else it.sum += Number(r.n) || 0
    if (!it.label && r.label) it.label = r.label
    by.set(r.key, it)
  }
  const out = []
  for (const it of by.values()) {
    const usual = it.sum / baseDays
    if (Math.max(it.y, usual) < CHANGE_MIN) continue
    const ratio = (it.y + 1) / (usual + 1)
    if (ratio < CHANGE_UP && ratio > CHANGE_DOWN) continue
    out.push({ ...it, usual, ratio, up: ratio >= CHANGE_UP, size: Math.abs(it.y - usual) })
  }
  return out
}

const round = (n) => Math.round(n)
const times = (ratio) => (ratio >= 10 ? Math.round(ratio) : Math.round(ratio * 10) / 10)

/**
 * The three biggest moves of yesterday against the usual day, in plain words:
 * pages that spiked or dropped, and senders (Google, Bing, a site) that sent
 * more or fewer arrivals. Biggest absolute change first; ties by name.
 *   pages:   [{ day, path, label, views }]  from daily_pages
 *   sources: [{ day, source, entries }]      from daily_sources
 *   nameOf(path, label), sourceOf(source): how the tab names them
 */
export function threeChanges({ pages = [], sources = [], last, nameOf = (p) => p, sourceOf = (s) => s }) {
  const pageMoves = movesOf(pages.map((r) => ({ day: r.day, key: r.path, label: r.label, n: r.views })), last).map((m) => ({
    ...m,
    href: m.key,
    text: m.up
      ? `${nameOf(m.key, m.label)}: ${round(m.y)} opens yesterday, ${times(m.ratio)} times its usual ${round(m.usual)} a day.`
      : `${nameOf(m.key, m.label)}: ${round(m.y)} opens yesterday, down from ${round(m.usual)} a day.`,
  }))
  const sourceMoves = movesOf(sources.map((r) => ({ day: r.day, key: r.source, n: r.entries })), last).map((m) => ({
    ...m,
    href: null,
    text: m.up
      ? `${sourceOf(m.key)} sent ${round(m.y)} arrivals yesterday, ${times(m.ratio)} times its usual ${round(m.usual)}.`
      : `${sourceOf(m.key)} sent ${round(m.y)} arrivals yesterday, down from ${round(m.usual)} a day.`,
  }))
  return [...pageMoves, ...sourceMoves]
    .sort((a, b) => b.size - a.size || (String(a.key) < String(b.key) ? -1 : 1))
    .slice(0, 3)
    .map(({ text, up, href }) => ({ text, tone: up ? 'good' : 'bad', href }))
}
