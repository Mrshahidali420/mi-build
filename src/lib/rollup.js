/**
 * The night job.
 *
 * Every page view, click and exit is written to the `events` table as it
 * happens. That table is fast to write and expensive to read: asking it "how
 * did last month go" would walk a few hundred thousand rows every time the
 * dashboard is opened, and Cloudflare's free allowance is 5 million row reads
 * a day. Opened twice a minute on a phone, that allowance is gone by lunch.
 *
 * So once a night, after a day is closed, that day is squeezed into a handful
 * of small tables: one row per page, per country, per platform, per move
 * between sections. Those tables are tiny and are kept forever. The raw rows
 * are then thrown away after 30 days.
 *
 * The result: "today" and "yesterday" are exact and detailed, "last 7 days"
 * and "all time" are exact totals, and nothing ever grows without a limit.
 *
 * It runs from the `scheduled` handler in src/worker.js at 00:10 UTC.
 */
import { CLICK, keptActionsSql, quickExitsSql } from './action-sql.js'

// How long the one-by-one rows are kept. Journeys and "which page sent this
// click" need them; after a month the daily tables carry the story instead.
const KEEP_DAYS = 30

// How many rows one delete pass removes. Kept small so the job never runs long.
const PRUNE_BATCH = 5000

/** 'YYYY-MM-DD' for a day, counted back from now, in UTC. */
export function dayKey(shiftDays = 0, now = Date.now()) {
  return new Date(now - shiftDays * 86400000).toISOString().slice(0, 10)
}

/**
 * Squeeze one closed day into the daily tables.
 *
 * It is written so a day can never be counted twice: the caller only calls it
 * for a day that has no row in `rollup_log`, and the very last thing it does
 * is write that row.
 */
async function rollOneDay(db, day) {
  const D = day

  // The whole day in one row.
  const totals = db
    .prepare(
      `INSERT OR REPLACE INTO daily_totals
         (day, views, people, sessions, bounces, clicks, buys, reads, watches, dwell_sum, dwell_n)
       SELECT ?,
         SUM(kind = 'view'),
         COUNT(DISTINCT CASE WHEN kind = 'view' AND visitor <> '' THEN visitor END),
         COUNT(DISTINCT CASE WHEN kind = 'view' AND session <> '' THEN session END),
         0,
         SUM(${CLICK}),
         SUM(kind = 'buy'), SUM(kind = 'read'), SUM(kind = 'watch'),
         SUM(CASE WHEN kind = 'leave' THEN dwell ELSE 0 END),
         SUM(kind = 'leave')
       FROM events WHERE day = ?`
    )
    .bind(D, D)

  // A "bounce" is a visit that looked at one page and left. Counted on its own
  // because it needs a group inside a group.
  const bounces = db
    .prepare(
      `UPDATE daily_totals SET bounces = (
         SELECT COUNT(*) FROM (
           SELECT session FROM events
           WHERE day = ? AND kind = 'view' AND session <> ''
           GROUP BY session HAVING MAX(step) = 1))
       WHERE day = ?`
    )
    .bind(D, D)

  // Per section: manhwa, manga, manhua, anime, character, shop, home.
  const types = db
    .prepare(
      `INSERT OR REPLACE INTO daily_types
         (day, page_type, views, people, entries, clicks, buys, reads, watches, dwell_sum, dwell_n)
       SELECT ?, page_type,
         SUM(kind = 'view'),
         COUNT(DISTINCT CASE WHEN kind = 'view' AND visitor <> '' THEN visitor END),
         SUM(kind = 'view' AND step = 1),
         SUM(${CLICK}),
         SUM(kind = 'buy'), SUM(kind = 'read'), SUM(kind = 'watch'),
         SUM(CASE WHEN kind = 'leave' THEN dwell ELSE 0 END),
         SUM(kind = 'leave')
       FROM events WHERE day = ? GROUP BY page_type`
    )
    .bind(D, D)

  // The best 300 pages of the day. A page seen once is not worth a row forever.
  const pages = db
    .prepare(
      `INSERT OR REPLACE INTO daily_pages
         (day, path, page_type, label, views, people, entries, clicks, buys, reads, watches, dwell_sum, dwell_n)
       SELECT ?, path,
         MAX(page_type),
         COALESCE(MAX(CASE WHEN kind = 'view' AND label <> '' THEN label END), ''),
         SUM(kind = 'view'),
         COUNT(DISTINCT CASE WHEN kind = 'view' AND visitor <> '' THEN visitor END),
         SUM(kind = 'view' AND step = 1),
         SUM(${CLICK}),
         SUM(kind = 'buy'), SUM(kind = 'read'), SUM(kind = 'watch'),
         SUM(CASE WHEN kind = 'leave' THEN dwell ELSE 0 END),
         SUM(kind = 'leave')
       FROM events WHERE day = ? AND path <> ''
       GROUP BY path ORDER BY SUM(kind = 'view') DESC LIMIT 300`
    )
    .bind(D, D)

  // All time, added up as we go. This is the only place "all time" comes from.
  // first_day is set once, the first night a page shows up, and never moved,
  // so the homepage planner can tell a new title from an old one.
  const totalPages = db
    .prepare(
      `INSERT INTO total_pages
         (path, page_type, label, views, clicks, buys, reads, watches, dwell_sum, dwell_n, last_day, first_day)
       SELECT path, page_type, label, views, clicks, buys, reads, watches, dwell_sum, dwell_n, day, day
       FROM daily_pages WHERE day = ?
       ON CONFLICT(path) DO UPDATE SET
         first_day = COALESCE(total_pages.first_day, excluded.first_day),
         views = total_pages.views + excluded.views,
         clicks = total_pages.clicks + excluded.clicks,
         buys = total_pages.buys + excluded.buys,
         reads = total_pages.reads + excluded.reads,
         watches = total_pages.watches + excluded.watches,
         dwell_sum = total_pages.dwell_sum + excluded.dwell_sum,
         dwell_n = total_pages.dwell_n + excluded.dwell_n,
         label = CASE WHEN excluded.label <> '' THEN excluded.label ELSE total_pages.label END,
         page_type = excluded.page_type,
         last_day = excluded.last_day`
    )
    .bind(D)

  // Pages opened straight from the homepage. A click on our own link is not
  // an event; the next page's view carries prev = '/' instead, so this is the
  // only way to see which homepage titles people actually open.
  const fromHome = db
    .prepare(
      `INSERT OR REPLACE INTO daily_from_home (day, path, views, people)
       SELECT ?, path, COUNT(*),
         COUNT(DISTINCT CASE WHEN visitor <> '' THEN visitor END)
       FROM events WHERE day = ? AND kind = 'view' AND prev = '/' AND path <> ''
       GROUP BY path ORDER BY COUNT(*) DESC LIMIT 300`
    )
    .bind(D, D)

  const countries = db
    .prepare(
      `INSERT OR REPLACE INTO daily_countries (day, country, page_type, views, people, clicks)
       SELECT ?, country, page_type,
         SUM(kind = 'view'),
         COUNT(DISTINCT CASE WHEN kind = 'view' AND visitor <> '' THEN visitor END),
         SUM(${CLICK})
       FROM events WHERE day = ? GROUP BY country, page_type`
    )
    .bind(D, D)

  const clicks = db
    .prepare(
      `INSERT OR REPLACE INTO daily_clicks (day, kind, platform, shop_kind, page_type, clicks, people)
       SELECT ?, kind, platform, shop_kind, page_type, COUNT(*), COUNT(DISTINCT CASE WHEN visitor <> '' THEN visitor END)
       FROM events WHERE day = ? AND ${CLICK}
       GROUP BY kind, platform, shop_kind, page_type`
    )
    .bind(D, D)

  // Where the day's readers came from. A link we tagged ourselves wins over
  // the sending site, because it says more. A blank source is kept too: it
  // means the person typed the address or used a bookmark, and that is most
  // of the traffic on a young site.
  const sources = db
    .prepare(
      `INSERT OR REPLACE INTO daily_sources (day, source, views, entries)
       SELECT ?, CASE WHEN campaign <> '' THEN 'utm:' || campaign ELSE referrer END AS source,
         COUNT(*), SUM(step = 1)
       FROM events
       WHERE day = ? AND kind = 'view'
       GROUP BY source ORDER BY COUNT(*) DESC LIMIT 100`
    )
    .bind(D, D)

  // The shape of a visit, kept forever after the one-by-one rows are gone.
  const edges = db
    .prepare(
      `INSERT OR REPLACE INTO daily_edges (day, from_type, to_type, moves)
       SELECT ?, CASE WHEN prev_type = '' THEN 'entry' ELSE prev_type END, page_type, COUNT(*)
       FROM events WHERE day = ? AND kind = 'view'
       GROUP BY 2, 3`
    )
    .bind(D, D)

  // List, feed and search actions, and Amazon clicks by page and by where the
  // link sat. See src/lib/action-sql.js for what is kept and why.
  const actions = db
    .prepare(
      `INSERT OR REPLACE INTO daily_actions (day, name, item, detail, label, n, people)
       ${keptActionsSql('day = ?')}`
    )
    .bind(D, D)

  // Visits that saw one page, did nothing and left. Needs the day's pages to
  // be written first, so it runs after them in the same batch.
  const quickPages = db
    .prepare(
      `UPDATE daily_pages SET quick_exits = q.quick_exits
       FROM (${quickExitsSql('day = ?')}) AS q
       WHERE daily_pages.day = ? AND daily_pages.path = q.path`
    )
    .bind(D, D)
  const quickTotal = db
    .prepare(
      `UPDATE daily_totals SET quick_exits = (
         SELECT COALESCE(SUM(quick_exits), 0) FROM (${quickExitsSql('day = ?')}))
       WHERE day = ?`
    )
    .bind(D, D)

  await db.batch([
    totals,
    bounces,
    types,
    pages,
    totalPages,
    fromHome,
    countries,
    clicks,
    sources,
    edges,
    actions,
    quickPages,
    quickTotal,
  ])

  const counted = await db
    .prepare('SELECT COUNT(*) AS n FROM events WHERE day = ?')
    .bind(D)
    .first()

  await db
    .prepare('INSERT OR REPLACE INTO rollup_log (day, ran_at, rows) VALUES (?,?,?)')
    .bind(D, Date.now(), counted?.n || 0)
    .run()

  return counted?.n || 0
}

/** Throw away raw rows older than KEEP_DAYS. Returns how many went. */
// By day, not by the clock: `day` is the only indexed column (see
// db/schema.sql), so this finds the old rows without reading the new ones.
async function prune(db, now = Date.now()) {
  const cutoff = dayKey(KEEP_DAYS, now)
  let gone = 0
  for (let pass = 0; pass < 20; pass += 1) {
    const out = await db
      .prepare(
        `DELETE FROM events WHERE id IN (
           SELECT id FROM events WHERE day < ? ORDER BY id LIMIT ${PRUNE_BATCH})`
      )
      .bind(cutoff)
      .run()
    const changes = out?.meta?.changes || 0
    gone += changes
    if (changes < PRUNE_BATCH) break
  }
  return gone
}

/**
 * The whole night job. It rolls up yesterday, and also any of the three days
 * before it that were missed, so one failed night heals itself.
 */
export async function runRollup(db, now = Date.now()) {
  if (!db) return { ok: false, reason: 'no database' }

  const wanted = [1, 2, 3, 4].map((shift) => dayKey(shift, now))
  const done = await db
    .prepare(
      `SELECT day FROM rollup_log WHERE day IN (?,?,?,?)`
    )
    .bind(...wanted)
    .all()
  const already = new Set((done.results || []).map((row) => row.day))

  const rolled = []
  // Oldest first, so total_pages is added up in the order the days happened.
  for (const day of [...wanted].reverse()) {
    if (already.has(day)) continue
    try {
      const rows = await rollOneDay(db, day)
      rolled.push({ day, rows })
    } catch (e) {
      rolled.push({ day, error: String(e && e.message ? e.message : e) })
    }
  }

  let pruned = 0
  try {
    pruned = await prune(db, now)
  } catch (e) {
    // A failed prune is not worth failing the night for. It retries tomorrow.
  }

  return { ok: true, rolled, pruned }
}
