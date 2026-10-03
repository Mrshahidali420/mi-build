/**
 * REQUEST TIME. What a title page shows of its readers: the rating totals and
 * the approved reviews, read from D1 while the page is drawn, so an approval
 * on /my-admin shows without a new build.
 *
 * A title page must never fail or hang because of this block. The two reads
 * run side by side and get READ_MS between them; past that, or on any error,
 * the page is drawn with no rating and no reviews and says `ok: false`, and
 * the title page then asks the Worker to keep that copy for a minute only
 * (see EDGE_HEADER), so a slow moment is not frozen into the edge cache.
 */
import { ratingOf, TOTALS_READ, APPROVED_READ } from './reviews.mjs'

// Long enough for a D1 read from the far side of the world, short enough
// that a stuck database costs a reader well under a second.
const READ_MS = 600

// The header a page uses to tell the Worker how long the edge may keep it.
// The Worker reads it, removes it and caps it at its own day (src/worker.js).
export const EDGE_HEADER = 'x-mi-edge'
// A title page carries live numbers now, so it is kept for ten minutes
// instead of a day: a vote or an approval reaches every reader within that.
export const TITLE_EDGE_SECONDS = 600
// A page drawn while the database did not answer is kept for one minute.
export const DEGRADED_EDGE_SECONDS = 60

const EMPTY = Object.freeze({ ok: false, rating: ratingOf(null), reviews: [] })

/** { ok, rating, reviews } for one AniList id. Never throws, never hangs. */
export async function readTitleReviews(db, anilistId, ms = READ_MS) {
  if (!db || !Number.isSafeInteger(anilistId) || anilistId <= 0) return EMPTY
  let timer
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })
  try {
    const both = Promise.all([
      db.prepare(TOTALS_READ).bind(anilistId).first(),
      db.prepare(APPROVED_READ).bind(anilistId).all(),
    ])
    // If the reads fail after the page already gave up on them, the failure
    // has nobody left to tell; this keeps it from being reported as unhandled.
    both.catch(() => {})
    const got = await Promise.race([both, late])
    if (!got) return EMPTY
    const [totals, approved] = got
    const reviews = (approved?.results || []).filter((r) => r && typeof r.body === 'string' && r.body)
    return { ok: true, rating: ratingOf(totals), reviews }
  } catch {
    return EMPTY
  } finally {
    clearTimeout(timer)
  }
}
