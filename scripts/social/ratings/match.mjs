/**
 * From an AniList title to its episodes on IMDb, through TMDB (the stills
 * already match titles to TMDB shows: stills/match.mjs).
 *
 *   GET /tv/<id>/external_ids                         the show's IMDb id
 *   GET /tv/<id>/season/<s>/episode/<e>/external_ids  one episode's IMDb id (the anchor)
 *
 * IMDb does not always number seasons the way TMDB does (a long runner may
 * sit in one IMDb season), so the last aired episode is looked up on its own
 * and the IMDb season and number of every other episode are counted from it.
 * Without that anchor, TMDB's season and numbering are taken as IMDb's.
 */
import { cachedMatch, findShow } from '../stills/match.mjs'

/** How long a match is kept before it is looked up again, and a miss. */
export const MATCH_DAYS = 7
export const MISS_DAYS = 3
const DAY_MS = 86_400_000

/** The last episode of a title that has aired: the one before its next, or 0. */
export const lastAiredOf = (title) => (title.nextEpisode?.number > 1 ? title.nextEpisode.number - 1 : 0)

/** A kept IMDb match: the match, 'miss' (still fresh), or undefined (look again). */
export function keptMatch(cache, title, now) {
  const hit = cache?.[title.id]
  if (!hit) return undefined
  const days = hit.miss ? MISS_DAYS : MATCH_DAYS
  if (now - hit.at >= days * DAY_MS) return undefined
  return hit.miss ? 'miss' : hit
}

/**
 * Where a title's episodes are on IMDb: { tmdb, series, season, offset, anchor: { ep, id }, at },
 * or { miss: true, at }. `tmdbFound` collects new TMDB matches for the stills' cache.
 */
export async function imdbMatchOf(get, title, { tmdbCache, tmdbFound, now, note = () => {} }) {
  let show = cachedMatch(tmdbCache, title, now)
  if (show === 'miss') return note('no TMDB match (kept)'), { miss: true, at: now }
  if (show === undefined) {
    show = await findShow(get, title, note)
    tmdbFound[title.id] = show ? { ...show, at: now } : { miss: true, at: now }
    if (!show) return { miss: true, at: now }
  }
  const series = (await get(`/tv/${show.id}/external_ids`))?.imdb_id
  if (!series) return note(`TMDB ${show.id} has no IMDb id`), { miss: true, at: now }
  let season = show.season
  let offset = 0
  if (show.whole) {
    const aired = (await get(`/tv/${show.id}`))?.last_episode_to_air
    if (!aired || !title.nextEpisode) return note('a long runner without a coming episode'), { miss: true, at: now }
    season = aired.season_number
    offset = title.nextEpisode.number - 1 - aired.episode_number
  }
  const last = lastAiredOf(title)
  const id = last - offset > 0 ? (await get(`/tv/${show.id}/season/${season}/episode/${last - offset}/external_ids`))?.imdb_id || null : null
  return { tmdb: show.id, series, season, offset, anchor: { ep: last, id }, at: now }
}

/**
 * The IMDb id of one AniList episode, or null.
 * @param rows the IMDb episodes of the series ([{ id, season, episode }], imdb.mjs)
 */
export function imdbEpisode(match, rows, ep) {
  if (!match || match.miss || !rows?.length) return null
  const anchor = match.anchor?.id ? rows.find((row) => row.id === match.anchor.id) : null
  const season = anchor ? anchor.season : match.season
  const number = anchor ? anchor.episode + (ep - match.anchor.ep) : ep - match.offset
  return rows.find((row) => row.season === season && row.episode === number)?.id || null
}
