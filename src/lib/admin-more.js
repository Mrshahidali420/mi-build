/**
 * The numbers behind the newer tabs of /my-admin: This week, Lists, Search,
 * Money and Health.
 *
 * Same rule as src/lib/admin-data.js: a short range reads the raw `events`
 * table, a long range reads the nightly tables for the closed days and adds
 * today from the raw table, and "All time" reads only the nightly tables.
 * The raw questions are the same SQL the night job runs (src/lib/action-sql.js),
 * so today and last week are always counted the same way.
 */
import { ask, askOne, dayKey } from './admin.js'
import { actionRowsSql, quickExitsSql } from './action-sql.js'
import { rawWhere } from './admin-data.js'
import { fillDays } from './admin-chart.js'

const holes = (list) => list.map(() => '?').join(',')

/** Add rows that share a key; n, people and quick_exits are summed. */
function addUp(keyOf, ...lists) {
  const out = new Map()
  for (const list of lists) {
    for (const row of list) {
      const key = keyOf(row)
      const found = out.get(key)
      if (!found) {
        out.set(key, { ...row })
        continue
      }
      for (const field of ['n', 'people', 'quick_exits']) {
        if (row[field] != null) found[field] = (found[field] || 0) + (row[field] || 0)
      }
      if (!found.label && row.label) found.label = row.label
    }
  }
  return [...out.values()]
}

// The promise on /privacy: the words of a search that found nothing are only
// ever shown when two or more different people typed them. The night job
// already drops the rest; this holds the same line for today's raw rows.
const shownPrivately = (row) => row.name !== 'search_none' || (row.people || 0) >= 2

/**
 * Rows of { name, item, detail, label, n, people } for these action names.
 * "people" over more than one day is people per day added up, so the same
 * person on two days counts twice. It is a guide, like the other long ranges.
 */
export async function actionsFor(db, range, names, limit = 500) {
  if (!names.length) return []
  const inNames = `name IN (${holes(names)})`
  let rows
  if (range.mode === 'all') {
    rows = await ask(
      db,
      `SELECT name, item, detail, MAX(label) AS label, SUM(n) AS n, SUM(people) AS people
       FROM daily_actions WHERE ${inNames}
       GROUP BY name, item, detail ORDER BY n DESC LIMIT ?`,
      ...names,
      limit
    )
  } else if (range.mode === 'raw') {
    const where = rawWhere(range)
    rows = await ask(
      db,
      `SELECT * FROM (${actionRowsSql(where.sql)}) WHERE ${inNames} ORDER BY n DESC LIMIT ?`,
      ...where.args,
      ...names,
      limit
    )
  } else {
    const [closed, today] = await Promise.all([
      ask(
        db,
        `SELECT name, item, detail, MAX(label) AS label, SUM(n) AS n, SUM(people) AS people
         FROM daily_actions WHERE day >= ? AND day < ? AND ${inNames}
         GROUP BY name, item, detail`,
        range.fromDay,
        range.toDay,
        ...names
      ),
      ask(db, `SELECT * FROM (${actionRowsSql('day = ?')}) WHERE ${inNames}`, range.toDay, ...names),
    ])
    rows = addUp((r) => `${r.name}|${r.item}|${r.detail}`, closed, today)
      .sort((a, b) => (b.n || 0) - (a.n || 0))
      .slice(0, limit)
  }
  return rows.filter(shownPrivately)
}

/** Add action rows up by one field: { key: { n, people, label } }. */
export function tally(rows, keyOf) {
  const out = new Map()
  for (const row of rows) {
    const key = keyOf(row)
    const found = out.get(key) || { key, n: 0, people: 0, label: '' }
    found.n += row.n || 0
    found.people += row.people || 0
    if (!found.label && row.label) found.label = row.label
    out.set(key, found)
  }
  return [...out.values()].sort((a, b) => b.n - a.n)
}

/** Per page: visits that arrived there, did nothing and left. A Map. */
export async function quickExitsFor(db, range) {
  let rows
  if (range.mode === 'all') {
    rows = await ask(db, `SELECT path, SUM(quick_exits) AS quick_exits FROM daily_pages GROUP BY path`)
  } else if (range.mode === 'raw') {
    const where = rawWhere(range)
    rows = await ask(db, quickExitsSql(where.sql), ...where.args)
  } else {
    const [closed, today] = await Promise.all([
      ask(
        db,
        `SELECT path, SUM(quick_exits) AS quick_exits FROM daily_pages
         WHERE day >= ? AND day < ? GROUP BY path`,
        range.fromDay,
        range.toDay
      ),
      ask(db, quickExitsSql('day = ?'), range.toDay),
    ])
    rows = addUp((r) => r.path, closed, today)
  }
  return new Map(rows.map((row) => [row.path, row.quick_exits || 0]))
}

// ------------------------------------------------------------ week on week

/**
 * The last seven CLOSED days and the seven before them. Both are full days
 * from the nightly tables, so the two weeks are fair to compare: today is
 * only half a day and would always look like a fall.
 */
export function weeks(now = Date.now()) {
  return {
    now: { from: dayKey(7, now), to: dayKey(1, now) },
    before: { from: dayKey(14, now), to: dayKey(8, now) },
  }
}

const WEEK_TOTALS = `SELECT SUM(views) AS views, SUM(sessions) AS visits, SUM(clicks) AS clicks,
    SUM(buys) AS buys, SUM(reads) AS reads, SUM(watches) AS watches,
    SUM(quick_exits) AS quick_exits, SUM(bounces) AS bounces, COUNT(*) AS days
  FROM daily_totals WHERE day >= ? AND day <= ?`

/** { now, before } totals for the two weeks. */
export async function weekTotals(db, w = weeks()) {
  const [a, b] = await Promise.all([
    askOne(db, WEEK_TOTALS, w.now.from, w.now.to),
    askOne(db, WEEK_TOTALS, w.before.from, w.before.to),
  ])
  return { now: a, before: b }
}

const WEEK_SOURCES = `SELECT source, SUM(views) AS views, SUM(entries) AS entries
  FROM daily_sources WHERE day >= ? AND day <= ? GROUP BY source ORDER BY entries DESC LIMIT 30`

/** { now, before } lists of senders for the two weeks. */
export async function weekSources(db, w = weeks()) {
  const [a, b] = await Promise.all([
    ask(db, WEEK_SOURCES, w.now.from, w.now.to),
    ask(db, WEEK_SOURCES, w.before.from, w.before.to),
  ])
  return { now: a, before: b }
}

const WEEK_PLATFORMS = `SELECT platform, SUM(clicks) AS clicks FROM daily_clicks
  WHERE day >= ? AND day <= ? AND kind IN ('read','watch') GROUP BY platform`

/** { now, before } read and watch clicks per platform for the two weeks. */
export async function weekPlatforms(db, w = weeks()) {
  const [a, b] = await Promise.all([
    ask(db, WEEK_PLATFORMS, w.now.from, w.now.to),
    ask(db, WEEK_PLATFORMS, w.before.from, w.before.to),
  ])
  return { now: a, before: b }
}

// ------------------------------------------------------------ day by day

// The fields a trend chart can draw. `saves` is list_add from daily_actions.
export const SERIES_FIELDS = ['views', 'visits', 'clicks', 'reads', 'watches', 'buys', 'quick_exits', 'saves']

/**
 * One row per CLOSED day from `from` to `to`, for the trend charts. Only the
 * nightly tables are read: at most one small row per day from each, so a
 * 30-day chart costs about 60 rows read. Quiet days come back as zeros.
 * Today is added by the page with withToday() in src/lib/admin-chart.js,
 * from totals it already has, so the raw table is not read again.
 */
export async function dailySeries(db, from, to) {
  const [totals, saves] = await Promise.all([
    ask(
      db,
      `SELECT day, views, sessions AS visits, clicks, reads, watches, buys, quick_exits
       FROM daily_totals WHERE day >= ? AND day <= ? ORDER BY day`,
      from,
      to
    ),
    ask(
      db,
      `SELECT day, SUM(n) AS saves FROM daily_actions
       WHERE day >= ? AND day <= ? AND name = 'list_add' GROUP BY day`,
      from,
      to
    ),
  ])
  const savesBy = new Map(saves.map((row) => [row.day, row.saves || 0]))
  return totals.map((row) => ({ ...row, saves: savesBy.get(row.day) || 0 }))
}

// How far back "All time" draws its trend. Older days stay in the totals.
export const ALL_TIME_DAYS = 60

/**
 * The closed days of a range, one row each, zeros for quiet days. Today and
 * "last 24 hours" have no closed days worth a line, so they get [].
 * A page adds today's point itself: withToday() in src/lib/admin-chart.js.
 */
export async function closedDaysFor(db, range, now = Date.now()) {
  if (range.mode === 'raw') return []
  const from = range.mode === 'all' ? dayKey(ALL_TIME_DAYS, now) : range.fromDay
  const to = dayKey(1, now)
  return fillDays(await dailySeries(db, from, to), from, to, SERIES_FIELDS)
}

// ------------------------------------------------------------------ health

/** Broken addresses asked for in the last 7 days, where they came from. */
export async function missingFor(db, now = Date.now(), limit = 25) {
  return ask(
    db,
    `SELECT path, COUNT(*) AS hits, MAX(ts) AS last, MAX(referrer) AS referrer, MAX(prev) AS prev
     FROM events WHERE day >= ? AND kind = 'missing'
     GROUP BY path ORDER BY hits DESC, last DESC LIMIT ?`,
    dayKey(6, now),
    limit
  )
}

/** The night job's own record, newest first, and today's raw rows so far. */
export async function counterHealth(db, now = Date.now()) {
  const [log, today] = await Promise.all([
    ask(db, `SELECT day, ran_at, rows FROM rollup_log ORDER BY day DESC LIMIT 8`),
    askOne(db, `SELECT COUNT(*) AS rows FROM events WHERE day = ?`, dayKey(0, now)),
  ])
  return { log, today: today.rows || 0 }
}

// ------------------------------------------------------------------ rising pages

/**
 * Every page with at least `floor` opens in the last 7 closed days, with its
 * opens yesterday, over 7 days and over 30 days, and on how many of the 7
 * days it was seen at all. Closed days only, from daily_pages, so the table
 * reads what the homepage planner reads. Also returns the first day the
 * counter holds, so the "usual" is worked out over the days that exist.
 */
export async function liftsFor(db, now = Date.now(), floor = 30) {
  const last = dayKey(1, now)
  const from7 = dayKey(7, now)
  const from30 = dayKey(30, now)
  const [rows, first] = await Promise.all([
    ask(
      db,
      `SELECT path, MAX(label) AS label,
         SUM(CASE WHEN day = ? THEN views ELSE 0 END) AS opens1,
         SUM(CASE WHEN day >= ? THEN views ELSE 0 END) AS opens7,
         SUM(views) AS opens30,
         COUNT(DISTINCT CASE WHEN day >= ? THEN day END) AS days7
       FROM daily_pages WHERE day >= ? AND day <= ?
       GROUP BY path HAVING opens7 >= ?`,
      last,
      from7,
      from7,
      from30,
      last,
      floor
    ),
    askOne(db, 'SELECT MIN(day) AS day FROM daily_pages'),
  ])
  return { rows, historyStart: first.day || null, night: dayKey(0, now) }
}
