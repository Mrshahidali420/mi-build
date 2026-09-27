/**
 * What people search for, from our own numbers only. No Google API, no Search
 * Console export: the owner wants the "People are searching for" shelf to
 * run from what the counter already sees.
 *
 * Two signals:
 *   1. Arrivals from a search engine. A page view whose referrer is Google,
 *      Bing, Yandex and so on means somebody searched for that title and
 *      picked us. The page already sends the sending site's host name (see
 *      src/layouts/Base.astro), so this costs no new field on the page.
 *   2. Our own search box. A picked result names the page; a search that
 *      found nothing names the words, and those words sometimes are exactly a
 *      title's name (a synonym the search index does not hold, for example).
 *
 * The engine list is written once here and turned into SQL for the night job
 * (src/lib/rollup.js) and the planner, and into a matcher for tests, so the
 * SQL and the JS can never disagree about what counts as Google.
 */
import { normalizeQuery } from './finder-core.js'

// Host name patterns, in SQL LIKE form (% is any run of characters). Only the
// search pages themselves: mail.google.com or news.google.com is somebody
// clicking a link, not somebody searching. The Google app on Android sends
// its package name instead of a host, and that is search (or Discover, which
// is Google choosing us for a reader, close enough).
export const ENGINES = [
  ['google', ['google.%', 'www.google.%', 'com.google.android.googlequicksearchbox']],
  ['bing', ['bing.com', '%.bing.com']],
  ['yandex', ['yandex.%', '%.yandex.%', 'ya.ru']],
  ['duckduckgo', ['duckduckgo.com', '%.duckduckgo.com']],
  ['yahoo', ['search.yahoo.com', '%.search.yahoo.com']],
  ['ecosia', ['ecosia.org', '%.ecosia.org']],
  ['brave', ['search.brave.com']],
  ['baidu', ['baidu.com', '%.baidu.com']],
  ['naver', ['search.naver.com', '%.search.naver.com']],
  ['qwant', ['qwant.com', '%.qwant.com']],
]

export const ENGINE_NAMES = {
  google: 'Google',
  bing: 'Bing',
  yandex: 'Yandex',
  duckduckgo: 'DuckDuckGo',
  yahoo: 'Yahoo',
  ecosia: 'Ecosia',
  brave: 'Brave Search',
  baidu: 'Baidu',
  naver: 'Naver',
  qwant: 'Qwant',
}

const likeToRegex = (like) =>
  new RegExp(`^${like.split('%').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i')
const MATCHERS = ENGINES.map(([engine, likes]) => [engine, likes.map(likeToRegex)])

/** The engine a referrer host belongs to, or '' for any other site. */
export function engineOf(host) {
  const h = String(host || '').trim()
  if (!h) return ''
  for (const [engine, res] of MATCHERS) if (res.some((re) => re.test(h))) return engine
  return ''
}

/** The same test as SQL, for a column that holds the referrer host. */
export function engineSql(col) {
  const whens = ENGINES.map(
    ([engine, likes]) => `WHEN ${likes.map((l) => `${col} LIKE '${l}'`).join(' OR ')} THEN '${engine}'`
  )
  return `(CASE ${whens.join(' ')} ELSE '' END)`
}

// The answer pages under a title (see SUBPAGE in src/worker.js). Somebody who
// searched "solo leveling characters" and landed on /manhwa/solo-leveling/
// characters was searching for Solo Leveling, so the arrival counts for it.
export const SUBPAGES = ['buy', 'free', 'like', 'characters']

/** A title's own page for any of its answer pages; other paths unchanged. */
export function titlePagePath(path) {
  const p = String(path || '')
  for (const sub of SUBPAGES) {
    const tail = `/${sub}`
    if (p.endsWith(tail) && p.split('/').length === 4) return p.slice(0, -tail.length)
  }
  return p
}

/** titlePagePath() in SQL. Only three-part paths are cut, like the JS. */
export function titlePageSql(col) {
  const whens = SUBPAGES.map(
    (sub) => `WHEN ${col} LIKE '/%/%/${sub}' AND ${col} NOT LIKE '/%/%/%/${sub}' THEN substr(${col}, 1, length(${col}) - ${sub.length + 1})`
  )
  return `(CASE ${whens.join(' ')} ELSE ${col} END)`
}

// The best 300 pages a day, the same cut daily_pages makes. A page one
// person found once is not worth a row forever.
export const ARRIVAL_PAGES_PER_DAY = 300

/**
 * The night job's question: arrivals from each search engine per page, for
 * the days `where` selects. The first value bound is the day to store.
 */
export function arrivalsRollupSql(where) {
  return `SELECT ?, path, engine, COUNT(*),
       COUNT(DISTINCT CASE WHEN visitor <> '' THEN visitor END)
     FROM (SELECT path, visitor, ${engineSql('referrer')} AS engine
           FROM events WHERE ${where} AND kind = 'view' AND referrer <> '' AND path <> '')
     WHERE engine <> ''
     GROUP BY path, engine ORDER BY COUNT(*) DESC LIMIT ${ARRIVAL_PAGES_PER_DAY}`
}

// ------------------------------------------------------------------ our own search box

/** Every name a catalog record goes by, cleaned the way a typed search is. */
export function nameKeys(record) {
  const names = [record?.title, record?.titleEnglish, record?.titleRomaji, ...(record?.synonyms || [])]
  return [...new Set(names.map((n) => normalizeQuery(n)).filter(Boolean))]
}

/**
 * name -> id for exact title matches. A name two titles share is dropped:
 * "Monster" could be either, and a guess would credit the wrong one.
 */
export function buildNameIndex(records) {
  const index = new Map()
  for (const rec of records || []) {
    const id = Number(rec?.id)
    if (!Number.isInteger(id) || id <= 0) continue
    for (const key of nameKeys(rec)) {
      const had = index.get(key)
      index.set(key, had === undefined || had === id ? id : 0)
    }
  }
  for (const [key, id] of index) if (!id) index.delete(key)
  return index
}

/**
 * The title one search row was about, or null.
 *   search_pick: the picked page (or its title, for an answer page)
 *   search_none: the words, when they are exactly one title's name
 * `idOf` is path -> id (old paths too), `names` is buildNameIndex().
 */
export function searchTitleId(row, { idOf, names } = {}) {
  if (!row) return null
  if (row.name === 'search_pick') {
    const id = idOf?.get(titlePagePath(row.item))
    return id === undefined ? null : id
  }
  if (row.name === 'search_none') {
    const id = names?.get(normalizeQuery(row.item))
    return id || null
  }
  return null
}
