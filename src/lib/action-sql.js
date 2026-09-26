/**
 * The questions that are asked of the raw `events` table in two places: by
 * the night job (src/lib/rollup.js), which keeps the answer for a closed day,
 * and by the dashboard (src/lib/admin-data.js), which asks the same thing of
 * today. Written once here, so "today" and "last week" can never be counted
 * two different ways.
 *
 * Each builder takes the WHERE part for `events` (for example 'day = ?') and
 * returns SQL. The caller binds the values.
 */

// What a click out is. Only these four. A 404 (kind 'missing'), a list action
// or a search is not a click, and counting them as one was a bug until
// September 2026.
export const CLICK = "kind IN ('buy','read','watch','other')"

// Anything a reader DID on a page: a click out, a list action, a search.
// home_seen is only "these shelves were on screen", sent by the homepage on
// its own, so it must not turn a homepage quick exit into a visit that did
// something.
export const DID = "(kind IN ('buy','read','watch','other','act','search') AND name <> 'home_seen')"

// How many rows of each action are kept per day. The long tail of one-off
// titles says nothing and costs a written row each.
export const ACTIONS_PER_NAME = 200

/**
 * One row per action, item and detail, with how many times and how many
 * people. Amazon clicks are folded in as the action 'buy', by page (item),
 * by where the link sat (detail) and by shop kind (label).
 */
//
// One more row per surface, 'search_none_all', counts every search that found
// nothing WITHOUT its words. The words of a one-off search are dropped at
// night, and without this total the dashboard would undercount searches.
export function actionRowsSql(where) {
  return `WITH src AS (
       SELECT CASE WHEN kind = 'buy' THEN 'buy' ELSE name END AS name,
              CASE WHEN kind = 'buy' THEN path ELSE item END AS item,
              -- Missing words are grouped across both search boxes, so two
              -- people count as two even when one used the full page.
              CASE WHEN name = 'search_none' THEN '' ELSE detail END AS detail,
              detail AS surface,
              CASE WHEN kind = 'buy' THEN shop_kind ELSE label END AS label,
              visitor
       FROM events WHERE ${where} AND kind IN ('act','search','buy'))
     SELECT name, item, detail, MAX(label) AS label, COUNT(*) AS n,
       COUNT(DISTINCT CASE WHEN visitor <> '' THEN visitor END) AS people
     FROM src GROUP BY name, item, detail
     UNION ALL
     SELECT 'search_none_all', '', surface, '', COUNT(*),
       COUNT(DISTINCT CASE WHEN visitor <> '' THEN visitor END)
     FROM src WHERE name = 'search_none' GROUP BY surface`
}

/**
 * The same rows, cut for keeping: the top ACTIONS_PER_NAME per action, and a
 * search that found nothing only when two or more different people typed it
 * (the promise made on /privacy). The first value bound is the day.
 */
export function keptActionsSql(where) {
  return `SELECT ?, name, item, detail, label, n, people FROM (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY name ORDER BY n DESC, people DESC, item) AS place
       FROM (${actionRowsSql(where)}))
     WHERE place <= ${ACTIONS_PER_NAME} AND NOT (name = 'search_none' AND people < 2)`
}

/**
 * Per page: visits that arrived on it, opened nothing else, did nothing and
 * left. A "bounce" only says one page was seen; this also says nothing was
 * clicked, saved or searched, which is the real sign a page missed.
 */
export function quickExitsSql(where) {
  return `SELECT path, COUNT(*) AS quick_exits FROM (
       SELECT session, MAX(CASE WHEN kind = 'view' THEN path END) AS path
       FROM events WHERE ${where} AND session <> ''
       GROUP BY session
       HAVING SUM(kind = 'view') = 1 AND SUM(kind = 'view' AND step = 1) = 1
          AND SUM(${DID}) = 0)
     GROUP BY path`
}
