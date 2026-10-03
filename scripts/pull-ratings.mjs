/**
 * Copy the readers' rating totals out of D1 for the homepage's "Top rated by
 * readers" shelf.
 *
 *   node scripts/pull-ratings.mjs              the deploy job (Cloudflare API, token in env)
 *   node scripts/pull-ratings.mjs --wrangler   on the owner's PC (wrangler login)
 *   node scripts/pull-ratings.mjs --dry        print what it would write, write nothing
 *
 * One read-only SELECT on rating_totals, nightly, in the deploy job next to
 * scripts/plan-home.mjs. It writes data/reader-ratings.json, which the build
 * joins to the catalog (src/lib/reader-rated.mjs), so the Worker never asks
 * D1 anything for this shelf.
 *
 * It never fails the deploy. When D1 cannot be read or the answer makes no
 * sense, the file is left exactly as it was (the last good copy comes back
 * from the Actions cache), a warning is printed, and it exits 0.
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeJsonAtomic } from '../src/lib/write-atomic.mjs'
import { queryD1, queryD1Wrangler } from '../src/lib/d1-api.mjs'
import { SHOW_AVERAGE_FROM } from '../src/lib/reviews.mjs'
import { cleanRatings } from '../src/lib/reader-rated.mjs'

// Only titles whose average a title page would print. Bounded by the floor,
// so the answer stays small however many titles get one stray vote.
export const RATINGS_QUERY = 'SELECT anilist_id, votes, total FROM rating_totals WHERE votes >= ? ORDER BY anilist_id'

/**
 * One run. `query(sql, params)` returns rows or throws. Returns
 * { ok, reason?, data? }. Never throws for a D1 problem.
 */
export async function runRatings({ query, dataDir = join(process.cwd(), 'data'), night, dry = false, say = console.log }) {
  let rows
  try {
    rows = await query(RATINGS_QUERY, [SHOW_AVERAGE_FROM])
  } catch (error) {
    say(`::warning::reader ratings skipped: ${String(error.message || error).slice(0, 120)}`)
    return { ok: false, reason: 'D1 unreadable' }
  }
  if (!Array.isArray(rows)) {
    say('::warning::reader ratings skipped: D1 answer was malformed')
    return { ok: false, reason: 'malformed' }
  }
  const titles = cleanRatings(rows)
  const data = { night, min: SHOW_AVERAGE_FROM, titles }
  say(`reader ratings for ${night}: ${titles.length} titles with ${SHOW_AVERAGE_FROM}+ ratings`)
  if (!dry) writeJsonAtomic(join(dataDir, 'reader-ratings.json'), data, 2)
  return { ok: true, data }
}

async function main() {
  const args = process.argv.slice(2)
  const dry = args.includes('--dry')
  const query = args.includes('--wrangler') ? queryD1Wrangler : queryD1
  const night = new Date().toISOString().slice(0, 10)
  try {
    await runRatings({ query, night, dry })
  } catch (error) {
    // Anything unexpected still must not stop the deploy.
    console.log(`::warning::reader ratings crashed: ${error.message}`)
  }
  process.exit(0)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main()
