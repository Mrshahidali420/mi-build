/**
 * Where the reading room gets its numbers.
 *
 * There are two stores. The one-by-one `events` table is exact and can draw a
 * journey, but it is expensive to read and only the last 30 days are kept. The
 * nightly `daily_*` tables are tiny and kept forever, but a day only lands
 * there after midnight.
 *
 * So: a short range reads the raw table. A long range reads the nightly tables
 * for the closed days and adds today from the raw table on top. "All time"
 * never touches the raw table at all.
 *
 * Every function here returns plain rows with the same field names, whichever
 * store answered, so a page never has to know where a number came from.
 */
import { ask, askOne, groupSenders } from './admin.js'
import { CLICK } from './action-sql.js'

const SUMS = [
  'views',
  'entries',
  'clicks',
  'buys',
  'reads',
  'watches',
  'dwell_sum',
  'dwell_n',
  'people',
  'sessions',
  'bounces',
  'moves',
]

/** Add two lists of rows together, row by row, on a shared key. */
function merge(keyOf, ...lists) {
  const out = new Map()
  for (const list of lists) {
    for (const row of list) {
      const key = keyOf(row)
      const found = out.get(key)
      if (!found) {
        out.set(key, { ...row })
        continue
      }
      for (const field of SUMS) {
        if (row[field] != null) {
          found[field] = (found[field] || 0) + (row[field] || 0)
        }
      }
      if (!found.label && row.label) found.label = row.label
    }
  }
  return [...out.values()]
}

function biggest(rows, field = 'views', limit = 100) {
  return rows
    .sort((a, b) => (b[field] || 0) - (a[field] || 0))
    .slice(0, limit)
}

// The same shape, counted from the raw table.
const RAW_COUNTS = `
  SUM(kind = 'view') AS views,
  COUNT(DISTINCT CASE WHEN kind = 'view' AND visitor <> '' THEN visitor END) AS people,
  SUM(kind = 'view' AND step = 1) AS entries,
  SUM(${CLICK}) AS clicks,
  SUM(kind = 'buy') AS buys,
  SUM(kind = 'read') AS reads,
  SUM(kind = 'watch') AS watches,
  SUM(CASE WHEN kind = 'leave' THEN dwell ELSE 0 END) AS dwell_sum,
  SUM(kind = 'leave') AS dwell_n`

/**
 * The filter for the raw table, for this range. It always names `day`, the
 * one indexed column (see db/schema.sql), so a question about yesterday never
 * reads the whole month. "Last 24 hours" is two days by index, then cut to
 * the exact hour by the clock.
 */
export function rawWhere(range, todayOnly = false) {
  if (todayOnly) return { sql: 'day = ?', args: [range.toDay] }
  if (range.sinceTs) return { sql: 'day >= ? AND ts > ?', args: [range.fromDay, range.sinceTs] }
  return { sql: 'day >= ?', args: [range.fromDay] }
}

// ------------------------------------------------------------------- headline

export async function totalsFor(db, range) {
  if (range.mode === 'all') {
    const row = await askOne(
      db,
      `SELECT SUM(views) AS views, SUM(sessions) AS sessions, SUM(clicks) AS clicks,
              SUM(buys) AS buys, SUM(reads) AS reads, SUM(watches) AS watches,
              SUM(bounces) AS bounces, SUM(dwell_sum) AS dwell_sum, SUM(dwell_n) AS dwell_n
       FROM daily_totals`
    )
    return row
  }

  const where = rawWhere(range)
  const raw = await askOne(
    db,
    `SELECT ${RAW_COUNTS},
       COUNT(DISTINCT CASE WHEN kind = 'view' AND session <> '' THEN session END) AS sessions
     FROM events WHERE ${where.sql}`,
    ...where.args
  )
  if (range.mode === 'raw') return raw

  const closed = await askOne(
    db,
    `SELECT SUM(views) AS views, SUM(sessions) AS sessions, SUM(clicks) AS clicks,
            SUM(buys) AS buys, SUM(reads) AS reads, SUM(watches) AS watches,
            SUM(bounces) AS bounces, SUM(dwell_sum) AS dwell_sum, SUM(dwell_n) AS dwell_n
     FROM daily_totals WHERE day >= ? AND day < ?`,
    range.fromDay,
    range.toDay
  )
  const today = await askOne(
    db,
    `SELECT ${RAW_COUNTS},
       COUNT(DISTINCT CASE WHEN kind = 'view' AND session <> '' THEN session END) AS sessions
     FROM events WHERE day = ?`,
    range.toDay
  )
  return merge(() => 'one', [closed], [today])[0] || {}
}

// ---------------------------------------------------------------------- pages

export async function pagesFor(db, range, limit = 60) {
  if (range.mode === 'all') {
    return await ask(
      db,
      `SELECT path, page_type, label, views, clicks, buys, reads, watches,
              dwell_sum, dwell_n, 0 AS entries
       FROM total_pages ORDER BY views DESC LIMIT ?`,
      limit * 3
    )
  }

  const where = rawWhere(range)
  const raw = await ask(
    db,
    `SELECT path, MAX(page_type) AS page_type,
            COALESCE(MAX(CASE WHEN kind = 'view' AND label <> '' THEN label END), '') AS label,
            ${RAW_COUNTS}
     FROM events WHERE ${where.sql} AND path <> ''
     GROUP BY path ORDER BY views DESC LIMIT 300`,
    ...where.args
  )
  if (range.mode === 'raw') return raw

  const closed = await ask(
    db,
    `SELECT path, page_type, label, views, people, entries, clicks, buys, reads,
            watches, dwell_sum, dwell_n
     FROM daily_pages WHERE day >= ? AND day < ?`,
    range.fromDay,
    range.toDay
  )
  const today = await ask(
    db,
    `SELECT path, MAX(page_type) AS page_type,
            COALESCE(MAX(CASE WHEN kind = 'view' AND label <> '' THEN label END), '') AS label,
            ${RAW_COUNTS}
     FROM events WHERE day = ? AND path <> '' GROUP BY path`,
    range.toDay
  )
  return biggest(merge((r) => r.path, closed, today), 'views', 300)
}

// ------------------------------------------------------------------- sections

export async function typesFor(db, range) {
  if (range.mode === 'all') {
    return await ask(
      db,
      `SELECT page_type, SUM(views) AS views, SUM(entries) AS entries,
              SUM(clicks) AS clicks, SUM(buys) AS buys, SUM(reads) AS reads,
              SUM(watches) AS watches, SUM(dwell_sum) AS dwell_sum,
              SUM(dwell_n) AS dwell_n
       FROM daily_types GROUP BY page_type ORDER BY views DESC`
    )
  }

  const where = rawWhere(range)
  const raw = await ask(
    db,
    `SELECT page_type, ${RAW_COUNTS} FROM events WHERE ${where.sql}
     GROUP BY page_type ORDER BY views DESC`,
    ...where.args
  )
  if (range.mode === 'raw') return raw

  const closed = await ask(
    db,
    `SELECT page_type, SUM(views) AS views, SUM(people) AS people,
            SUM(entries) AS entries, SUM(clicks) AS clicks, SUM(buys) AS buys,
            SUM(reads) AS reads, SUM(watches) AS watches,
            SUM(dwell_sum) AS dwell_sum, SUM(dwell_n) AS dwell_n
     FROM daily_types WHERE day >= ? AND day < ? GROUP BY page_type`,
    range.fromDay,
    range.toDay
  )
  const today = await ask(
    db,
    `SELECT page_type, ${RAW_COUNTS} FROM events WHERE day = ? GROUP BY page_type`,
    range.toDay
  )
  return biggest(merge((r) => r.page_type, closed, today))
}

// --------------------------------------------------------------------- clicks

export async function clicksFor(db, range) {
  if (range.mode === 'all') {
    return await ask(
      db,
      `SELECT kind, platform, shop_kind, page_type, SUM(clicks) AS clicks
       FROM daily_clicks GROUP BY kind, platform, shop_kind, page_type
       ORDER BY clicks DESC LIMIT 400`
    )
  }

  const where = rawWhere(range)
  const raw = await ask(
    db,
    `SELECT kind, platform, shop_kind, page_type, COUNT(*) AS clicks
     FROM events WHERE ${where.sql} AND ${CLICK}
     GROUP BY kind, platform, shop_kind, page_type ORDER BY clicks DESC LIMIT 400`,
    ...where.args
  )
  if (range.mode === 'raw') return raw

  const closed = await ask(
    db,
    `SELECT kind, platform, shop_kind, page_type, SUM(clicks) AS clicks
     FROM daily_clicks WHERE day >= ? AND day < ?
     GROUP BY kind, platform, shop_kind, page_type`,
    range.fromDay,
    range.toDay
  )
  const today = await ask(
    db,
    `SELECT kind, platform, shop_kind, page_type, COUNT(*) AS clicks
     FROM events WHERE day = ? AND ${CLICK}
     GROUP BY kind, platform, shop_kind, page_type`,
    range.toDay
  )
  return biggest(
    merge((r) => `${r.kind}|${r.platform}|${r.shop_kind}|${r.page_type}`, closed, today),
    'clicks',
    400
  )
}

// ------------------------------------------------------------------ countries

// A country is only shown when it opened at least one page. A person who
// leaves the site sends one last "leave" row, and that row alone must not put
// a country in the list with zero views next to it.
const withViews = (rows) => rows.filter((row) => (row.views || 0) > 0)

export async function countriesFor(db, range, limit = 15) {
  if (range.mode === 'all') {
    return withViews(await ask(
      db,
      `SELECT country, SUM(views) AS views, SUM(clicks) AS clicks
       FROM daily_countries GROUP BY country ORDER BY views DESC LIMIT ?`,
      limit
    ))
  }

  const where = rawWhere(range)
  const raw = await ask(
    db,
    `SELECT country, ${RAW_COUNTS} FROM events WHERE ${where.sql}
     GROUP BY country ORDER BY views DESC LIMIT ?`,
    ...where.args,
    limit
  )
  if (range.mode === 'raw') return withViews(raw)

  const closed = await ask(
    db,
    `SELECT country, SUM(views) AS views, SUM(people) AS people, SUM(clicks) AS clicks
     FROM daily_countries WHERE day >= ? AND day < ? GROUP BY country`,
    range.fromDay,
    range.toDay
  )
  const today = await ask(
    db,
    `SELECT country, ${RAW_COUNTS} FROM events WHERE day = ? GROUP BY country`,
    range.toDay
  )
  return withViews(biggest(merge((r) => r.country, closed, today), 'views', limit))
}

// -------------------------------------------------------------------- sources

// Every Facebook name (l.facebook.com, fbclid, utm_source=facebook) is added
// up into one sender by groupSenders(), so Facebook is one row, not five.
export async function sourcesFor(db, range, limit = 20) {
  if (range.mode === 'all') {
    const rows = await ask(
      db,
      `SELECT source, SUM(views) AS views, SUM(entries) AS entries
       FROM daily_sources GROUP BY source ORDER BY views DESC LIMIT ?`,
      limit
    )
    return groupSenders(rows)
  }

  const where = rawWhere(range)
  const raw = await ask(
    db,
    `SELECT CASE WHEN campaign <> '' THEN 'utm:' || campaign ELSE referrer END AS source,
            COUNT(*) AS views, SUM(step = 1) AS entries
     FROM events WHERE ${where.sql} AND kind = 'view'
     GROUP BY source ORDER BY views DESC LIMIT ?`,
    ...where.args,
    limit
  )
  if (range.mode === 'raw') return groupSenders(raw)

  const closed = await ask(
    db,
    `SELECT source, SUM(views) AS views, SUM(entries) AS entries
     FROM daily_sources WHERE day >= ? AND day < ? GROUP BY source`,
    range.fromDay,
    range.toDay
  )
  const today = await ask(
    db,
    `SELECT CASE WHEN campaign <> '' THEN 'utm:' || campaign ELSE referrer END AS source,
            COUNT(*) AS views, SUM(step = 1) AS entries
     FROM events WHERE day = ? AND kind = 'view'
     GROUP BY source`,
    range.toDay
  )
  return groupSenders(merge((r) => r.source, closed, today)).slice(0, limit)
}

// ---------------------------------------------------------------------- moves

export async function edgesFor(db, range, limit = 25) {
  if (range.mode === 'all') {
    return await ask(
      db,
      `SELECT from_type, to_type, SUM(moves) AS moves FROM daily_edges
       GROUP BY from_type, to_type ORDER BY moves DESC LIMIT ?`,
      limit
    )
  }

  const where = rawWhere(range)
  const raw = await ask(
    db,
    `SELECT CASE WHEN prev_type = '' THEN 'entry' ELSE prev_type END AS from_type,
            page_type AS to_type, COUNT(*) AS moves
     FROM events WHERE ${where.sql} AND kind = 'view'
     GROUP BY from_type, to_type ORDER BY moves DESC LIMIT ?`,
    ...where.args,
    limit
  )
  if (range.mode === 'raw') return raw

  const closed = await ask(
    db,
    `SELECT from_type, to_type, SUM(moves) AS moves FROM daily_edges
     WHERE day >= ? AND day < ? GROUP BY from_type, to_type`,
    range.fromDay,
    range.toDay
  )
  const today = await ask(
    db,
    `SELECT CASE WHEN prev_type = '' THEN 'entry' ELSE prev_type END AS from_type,
            page_type AS to_type, COUNT(*) AS moves
     FROM events WHERE day = ? AND kind = 'view' GROUP BY from_type, to_type`,
    range.toDay
  )
  return biggest(merge((r) => `${r.from_type}|${r.to_type}`, closed, today), 'moves', limit)
}
