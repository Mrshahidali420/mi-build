/**
 * Which TMDB show and season an anime of the catalog is, kept in the ledger
 * (`tmdbIds`) so the chain never searches for the same title twice.
 *
 * TMDB files a show once and its parts as seasons; the catalog (AniList)
 * files every season on its own. So a title is matched in two steps:
 *
 *   1. /search/tv by its name, its other name and its name without "Season 2"
 *      and the like: an animated show whose name is close enough (NAME_MATCH)
 *   2. that show's seasons: the one whose first air date is within
 *      SEASON_DAYS of the title's own start date; or, when the show itself
 *      started with the title (a long runner such as One Piece, which TMDB
 *      cuts into seasons and AniList does not), the whole show: its stills
 *      are then taken from the season airing now (`whole: true`)
 *   3. a sequel TMDB files inside an earlier season (Blue Box Season 2 as
 *      episodes 26 on of season 1): taken as the whole show too, but only
 *      while it airs and only when TMDB's last aired episode came out the
 *      day the catalog's last one did (within AIRED_DAYS)
 *
 * Only one show and one season may be left; on any doubt there is no match
 * (then Kitsu is asked instead). A miss is tried again after MISS_DAYS.
 */
import { plain } from '../art/load.mjs'
import { baseTitle } from '../story.mjs'

/** Names are the same when their letter pairs overlap at least this much (0 to 1). */
export const NAME_MATCH = 0.8
/** A season is the title's when it started within this many days of the title. */
export const SEASON_DAYS = 45
export const MISS_DAYS = 14
/** TMDB's last aired episode and the catalog's must be this close, in days. */
export const AIRED_DAYS = 2
const WEEK_DAYS = 7
/** Titles remembered: plenty for every airing and well-known show. */
export const CACHE_MAX = 3000
const ANIMATION = 16
const DAY_MS = 86_400_000
const FORMATS = new Set(['TV', 'TV_SHORT', 'ONA'])
const SAVE_TRIES = 4

/** How alike two names are: the share of letter pairs they have in common (Dice). */
export function likeness(a, b) {
  const pairs = (text) => {
    const word = plain(text)
    return Array.from({ length: Math.max(0, word.length - 1) }, (_, i) => word.slice(i, i + 2))
  }
  const x = pairs(a)
  const y = pairs(b)
  if (!x.length || !y.length) return plain(a) === plain(b) && plain(a) ? 1 : 0
  const left = [...y]
  let same = 0
  for (const pair of x) {
    const at = left.indexOf(pair)
    if (at >= 0) {
      same += 1
      left.splice(at, 1)
    }
  }
  return (2 * same) / (x.length + y.length)
}

/** The names a title is searched by. */
export const namesOf = (title) => [...new Set([title.title, title.alt, baseTitle(title.title), title.alt && baseTitle(title.alt), title.native].filter(Boolean))]

const dayGap = (date, start) => Math.abs(Date.parse(date) - start) / DAY_MS

/** The title's start as a time, or null when the catalog does not give the day. */
function startOf(title) {
  const s = title.start
  return s?.year && s.month && s.day ? Date.UTC(s.year, s.month - 1, s.day) : null
}

/** The one season of a show that started with the title, or null. */
export function seasonOf(show, title) {
  const start = startOf(title)
  if (!start) return null
  const near = (show?.seasons || []).filter((s) => s.season_number >= 1 && s.air_date && dayGap(s.air_date, start) <= SEASON_DAYS)
  return near.length === 1 ? near[0] : null
}

const seasonsText = (show) => (show.seasons || []).map((s) => `${s.season_number} ${s.air_date || '?'}`).join(', ')

/** Search TMDB for a title: { id, season } or { id, whole: true } or null. note() hears why a title is not matched. */
export async function findShow(get, title, note = () => {}) {
  if (!FORMATS.has(title.format)) return note(`a ${title.format || 'title of unknown format'}, not a series`), null
  if (!startOf(title)) return note('no start date in the catalog'), null
  const names = namesOf(title)
  const ids = new Set()
  for (const name of names) {
    const found = await get('/search/tv', { query: name })
    for (const show of found?.results || []) {
      const animated = (show.genre_ids || []).includes(ANIMATION)
      if (animated && names.some((n) => likeness(n, show.name) >= NAME_MATCH || likeness(n, show.original_name) >= NAME_MATCH)) ids.add(show.id)
    }
  }
  if (!ids.size) note('no animated TMDB show of that name')
  const matches = []
  for (const id of [...ids].slice(0, 3)) {
    const show = await get(`/tv/${id}`)
    const season = seasonOf(show, title)
    // An airing title whose season is not the one airing now runs on through TMDB's later seasons: the whole show.
    const runsOn = season && title.status === 'RELEASING' && show.last_episode_to_air?.season_number > season.season_number
    if (season && !runsOn) matches.push({ id, season: season.season_number })
    else if (runsOn) matches.push({ id, whole: true })
    else if (show?.first_air_date && dayGap(show.first_air_date, startOf(title)) <= SEASON_DAYS) matches.push({ id, whole: true })
    else if (airsAlong(show, title)) matches.push({ id, whole: true })
    else note(`${show?.name} (${id}) first aired ${show?.first_air_date}; no season near ${new Date(startOf(title)).toISOString().slice(0, 10)} (seasons: ${seasonsText(show || {})})`)
  }
  if (matches.length > 1) note(`${matches.length} TMDB shows fit; none taken`)
  return matches.length === 1 ? matches[0] : null
}

/** The last episode of a season that has aired, by TMDB's show details, or null. */
export const lastAired = (show, season) => (show?.last_episode_to_air?.season_number === season ? show.last_episode_to_air.episode_number : null)

/** True when the title airs now and TMDB's last episode of the show came out when the catalog's last one did. */
export function airsAlong(show, title) {
  const aired = show?.last_episode_to_air?.air_date
  if (title.status !== 'RELEASING' || !title.nextEpisode?.at || !aired) return false
  // The catalog knows the coming episode; the one before it aired about a week earlier.
  return dayGap(aired, title.nextEpisode.at - WEEK_DAYS * DAY_MS) <= AIRED_DAYS
}

/** The kept match of a title: a match, 'miss' (still fresh), or undefined (search again). */
export function cachedMatch(cache, title, now) {
  const hit = cache?.[title.id]
  if (!hit) return undefined
  if (hit.miss) return now - hit.at < MISS_DAYS * DAY_MS ? 'miss' : undefined
  return hit
}

/** Write new matches into the ledger's `tmdbIds`, keeping the newest CACHE_MAX. */
export async function keepMatches(book, found) {
  if (!book || !Object.keys(found).length) return
  for (let i = 0; i < SAVE_TRIES; i += 1) {
    const { data, version } = await book.read()
    const all = Object.entries({ ...(data.tmdbIds || {}), ...found }).sort((x, y) => y[1].at - x[1].at).slice(0, CACHE_MAX)
    if (await book.write({ ...data, tmdbIds: Object.fromEntries(all) }, version, 'TMDB ids')) return
  }
}
