/**
 * The questions behind the phase 3 views of /my-admin. The rules that turn
 * the rows into lists and sentences are in src/lib/admin-insights.js.
 *
 * Budget: every question here is bounded by day and by a short list of
 * paths, and the one on the Now tab (which reloads itself every minute) is
 * kept for the day in the Worker's cache, so it is asked about once a day.
 */
import { ask, dayKey } from './admin.js'
import { loadTitle } from './runtime.js'
import { threeChanges } from './admin-insights.js'

// Country mixes are read from the raw table, which only keeps 30 days and is
// the expensive one. A week is enough to see who reads a title.
export const COUNTRY_DAYS = 7

/** [{ path, country, n }] of page views in the last 7 days, for these paths. */
export async function countriesForPaths(db, paths, now = Date.now()) {
  const list = [...new Set(paths)].filter(Boolean).slice(0, 40)
  if (!list.length) return []
  return ask(
    db,
    `SELECT path, country, COUNT(*) AS n FROM events
     WHERE day >= ? AND kind = 'view' AND path IN (${list.map(() => '?').join(',')})
     GROUP BY path, country`,
    dayKey(COUNTRY_DAYS - 1, now),
    ...list
  )
}

/**
 * path -> title record, for a few title paths. A shard that does not read
 * gives null for that path: the list still draws, just without a reason.
 */
export async function titlesForPaths(env, paths) {
  const out = new Map()
  await Promise.all(
    [...new Set(paths)].map(async (path) => {
      const [kind, slug] = String(path).split('/').filter(Boolean)
      try {
        out.set(path, (await loadTitle(env, kind, slug)) || null)
      } catch {
        out.set(path, null)
      }
    })
  )
  return out
}

/**
 * Keep one answer per closed day in the Worker's cache (Cache API). Outside
 * the Worker (astro dev) there is no cache and the answer is worked out each
 * time. An empty answer is never kept: the night job may not have closed
 * yesterday yet, and a blank box must not stick for the day.
 */
export async function onceADay(key, day, compute) {
  const store = globalThis.caches?.default
  const url = `https://admin-cache.manhwaindex.local/${key}/${day}`
  if (store) {
    try {
      const hit = await store.match(url)
      if (hit) return await hit.json()
    } catch {
      // A cache that cannot be read is only slower.
    }
  }
  const value = await compute()
  if (store && Array.isArray(value) && value.length) {
    try {
      await store.put(url, new Response(JSON.stringify(value), {
        headers: { 'content-type': 'application/json', 'cache-control': 'max-age=43200' },
      }))
    } catch {
      // Not kept: the next load asks again.
    }
  }
  return value
}

/**
 * Yesterday's three biggest moves against the 7 days before it, in words.
 * Reads daily_pages (at most 300 rows a day) and daily_sources for 8 days.
 */
export async function changesFor(db, { nameOf, sourceOf, now = Date.now() }) {
  const last = dayKey(1, now)
  const from = dayKey(8, now)
  return onceADay('changes', last, async () => {
    const [pages, sources] = await Promise.all([
      ask(db, 'SELECT day, path, label, views FROM daily_pages WHERE day >= ? AND day <= ?', from, last),
      ask(db, 'SELECT day, source, entries FROM daily_sources WHERE day >= ? AND day <= ?', from, last),
    ])
    return threeChanges({ pages, sources, last, nameOf, sourceOf })
  })
}
