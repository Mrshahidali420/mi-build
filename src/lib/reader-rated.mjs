/**
 * "Top rated by readers": the homepage shelf of titles our own readers rated.
 *
 * The numbers come from D1 (rating_totals), but never at request time: the
 * nightly job (scripts/pull-ratings.mjs) copies the totals into
 * data/reader-ratings.json, and the build joins them to the catalog here.
 * Pure: no file, no database, no clock.
 */
import { ratingOf, SHOW_AVERAGE_FROM } from './reviews.mjs'

export const RATED_SECTION = {
  key: 'rated',
  title: 'Top rated by readers',
  why: `Rated by readers of this site, highest average first. A title needs ${SHOW_AVERAGE_FROM} ratings to count.`,
  slots: 12,
  // A shelf of two or three looks broken, so under four it is not drawn.
  floor: 4,
}

/**
 * The totals rows worth keeping, from whatever the file or D1 said: positive
 * integer ids, a sane average, at least SHOW_AVERAGE_FROM votes. Each row is
 * { id, votes, total }; anilist_id is accepted for the id too, so D1's rows
 * pass straight through.
 */
export function cleanRatings(rows) {
  if (!Array.isArray(rows)) return []
  const out = []
  const seen = new Set()
  for (const row of rows) {
    const id = Number(row?.id ?? row?.anilist_id)
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) continue
    const rating = ratingOf(row)
    if (!rating.show) continue
    seen.add(id)
    out.push({ id, votes: rating.votes, total: Number(row.total) })
  }
  return out
}

/** "4.6 from 12 readers": the line under the cover. */
export const ratedBadge = (rating) => `${rating.avg.toFixed(1)} from ${rating.votes} readers`

/**
 * The shelf, ready for CoverGrid, or null when it is not drawn.
 *
 *   rows      totals rows ({ id, votes, total })
 *   lookup    id -> { item } from today's catalog (catalog.js inIndex)
 *   onPage    ids already on the homepage: a cover is never shown twice
 *   keep      the homepage's adult filter, on the catalog record
 *
 * Highest average first, then most votes, then the lower id so the order
 * never wobbles between builds. Each item is a copy of the catalog record
 * carrying the readers' line as its badge, and without the AniList score, so
 * the only number on the card is the one the shelf is about.
 */
export function ratedShelf(rows, { lookup, onPage = new Set(), keep = null, cfg = RATED_SECTION } = {}) {
  const ranked = cleanRatings(rows)
    .map((row) => ({ ...row, rating: ratingOf(row) }))
    .sort((a, b) => b.rating.avg - a.rating.avg || b.votes - a.votes || a.id - b.id)
  const items = []
  for (const row of ranked) {
    if (items.length >= cfg.slots) break
    if (onPage.has(row.id)) continue
    const found = lookup(row.id)
    if (!found?.item) continue
    if (keep && !keep(found.item)) continue
    items.push({ ...found.item, score: null, badge: ratedBadge(row.rating), readerAvg: row.rating.avg, readerVotes: row.votes })
  }
  if (items.length < cfg.floor) return null
  return { key: cfg.key, title: cfg.title, why: cfg.why, items }
}
