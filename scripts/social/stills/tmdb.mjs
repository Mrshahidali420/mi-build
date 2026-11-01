/**
 * TMDB (themoviedb.org, API v3): the episode stills of an anime. Needs the
 * key in TMDB_API_KEY; without it this source is skipped.
 *
 *   GET /search/tv?query=<name>                    shows by name
 *   GET /tv/<id>                                   its seasons, with their first air dates
 *   GET /tv/<id>/season/<s>/episode/<e>/images     the stills of one episode
 *
 * TMDB allows about 40 requests a second; this file keeps to one request
 * every REQUEST_GAP_MS and waits and tries again when TMDB says "too many"
 * (429). The key goes in the address, so no address is ever put in an
 * error message or a log line.
 */
export const HOST = 'https://api.themoviedb.org/3'
export const IMAGE_HOST = 'https://image.tmdb.org/t/p'
/** A still must be at least this wide at TMDB, and is fetched at this size. */
export const STILL_WIDTH = 1280
/** Wide frames only: 16:9 give or take. */
const RATIO = { min: 1.7, max: 1.8 }
/** At most ten requests a second, a quarter of TMDB's limit. */
export const REQUEST_GAP_MS = 100
const TRIES = 3
const BACKOFF_MS = 1000
const TIMEOUT_MS = 15_000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** A TMDB reader for one key: get(path, params) gives the JSON, or throws (without the address). */
export function tmdbClient(key, { fetch = globalThis.fetch, wait = sleep, gap = REQUEST_GAP_MS } = {}) {
  let last = 0
  return async function get(path, params = {}) {
    const query = new URLSearchParams({ ...params, api_key: key })
    for (let attempt = 1; ; attempt += 1) {
      const pause = last + gap - Date.now()
      if (pause > 0) await wait(pause)
      last = Date.now()
      const res = await fetch(`${HOST}${path}?${query}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (res.ok) return res.json()
      if (res.status === 404) return null
      if ((res.status === 429 || res.status >= 500) && attempt < TRIES) {
        const after = Number(res.headers?.get?.('retry-after')) * 1000
        await wait(after > 0 ? after : BACKOFF_MS * 2 ** (attempt - 1))
        continue
      }
      throw new Error(`TMDB answered ${res.status}`)
    }
  }
}

/** The best still of one episode: wide, at least STILL_WIDTH, without words if it can be; or null. */
export function bestStill(images) {
  const fit = (images?.stills || []).filter((s) => s.file_path && s.width >= STILL_WIDTH && s.aspect_ratio >= RATIO.min && s.aspect_ratio <= RATIO.max)
  const ranked = fit.sort((x, y) => Number(x.iso_639_1 != null) - Number(y.iso_639_1 != null) || y.width - x.width || (y.vote_average || 0) - (x.vote_average || 0))
  return ranked[0] || null
}

/** The address of a still, at the fetch size. */
export const stillUrl = (filePath) => `${IMAGE_HOST}/w${STILL_WIDTH}${filePath}`

/** The stills of these episodes of one season, oldest first: [{ id, number, url }]. */
export async function episodeStills(get, show, numbers) {
  const out = []
  for (const number of numbers) {
    const images = await get(`/tv/${show.id}/season/${show.season}/episode/${number}/images`, { include_image_language: 'null' })
    const still = bestStill(images)
    if (still) out.push({ id: `tmdb:${still.file_path}`, number, url: stillUrl(still.file_path) })
  }
  return out
}
