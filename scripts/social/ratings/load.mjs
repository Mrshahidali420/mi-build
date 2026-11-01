/**
 * Episode ratings on IMDb, for the rating posts (types/rating*.mjs).
 *
 * Once a day (FRESH_MS) the run reads IMDb's daily files (imdb.mjs) for the
 * last TRACK episodes of every popular show airing now, and keeps a dated
 * snapshot of each episode's score and votes in the ledger (branch
 * social-state, key `ratings`), next to the TMDB ids the stills keep. The
 * rest of the day's runs read the snapshot alone. The snapshot is how a
 * change is seen: the score on the day of our rating post against today's.
 *
 * Kept per episode (by IMDb id): { titleId, ep, aired, first, hist: [[day, score, votes], ...] }.
 * An episode is dropped KEEP_DAYS after it aired. IMDb matches of the titles
 * are kept under `imdbIds` (match.mjs).
 */
import { keepMatches } from '../stills/match.mjs'
import { tmdbClient } from '../stills/tmdb.mjs'
import { SITE } from '../site.mjs'
import { dateOf } from '../when.mjs'
import { EPISODES_FILE, RATINGS_FILE, gzLines, readEpisodes, readRatings } from './imdb.mjs'
import { imdbEpisode, imdbMatchOf, keptMatch, lastAiredOf } from './match.mjs'

export const MIN_POPULARITY = 2000
/** The fewest votes an episode needs before its score is posted. */
export const MIN_VOTES = 1000
export const MIN_SCORE = 8.5
/** The smallest change of score that is news. */
export const MOVE = 0.2
/** The files are read at most once in this long. */
export const FRESH_MS = 20 * 3_600_000
/** The last episodes of each show that are followed. */
export const TRACK = 4
export const KEEP_DAYS = 21
const HIST_MAX = 15
const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS
const SAVE_TRIES = 3

/** The shows whose episodes are followed: anime (made from a comic the index lists), popular, airing now, with an episode out. */
export const trackedTitles = (titles) => (titles || []).filter((t) => t.section === 'anime' && t.status === 'RELEASING' && t.popularity >= MIN_POPULARITY && lastAiredOf(t) > 0)

/** When an episode aired: its schedule row, else counted back a week an episode from the next one. */
export function airedAtOf(title, ep, schedule = []) {
  const row = schedule.find((r) => r.mediaId === title.id && r.episode === ep)
  if (row) return row.at * 1000
  return title.nextEpisode?.at ? title.nextEpisode.at - (title.nextEpisode.number - ep) * WEEK_MS : null
}

/**
 * The snapshot after today's read: new episodes added, today's score and
 * votes written (one point a day), old episodes dropped.
 * @param ratings Map imdbId -> { score, votes }
 * @param add [{ id, titleId, ep, aired }]
 */
export function updateSnapshot(prev, { now, ratings, add = [] }) {
  const day = dateOf(now)
  const eps = {}
  for (const [id, ep] of Object.entries(prev?.eps || {})) eps[id] = { ...ep, hist: [...(ep.hist || [])] }
  for (const ep of add) if (!eps[ep.id]) eps[ep.id] = { titleId: ep.titleId, ep: ep.ep, aired: ep.aired, first: now, hist: [] }
  for (const [id, ep] of Object.entries(eps)) {
    if (ep.aired && ep.aired < now - KEEP_DAYS * DAY_MS) {
      delete eps[id]
      continue
    }
    const r = ratings.get(id)
    if (!r) continue
    ep.hist = [...ep.hist.filter(([d]) => d !== day), [day, r.score, r.votes]].slice(-HIST_MAX)
  }
  return { at: now, eps }
}

/** The score an episode had on a day (the last point on or before it), or null. */
export function scoreOn(hist, day) {
  const point = (hist || []).filter(([d]) => d <= day).at(-1)
  return point ? point[1] : null
}

/**
 * The episodes as the rating types read them: [{ id, titleId, ep, aired, score, votes, base }],
 * `base` being the score on the day of our rating post of that episode (null when none).
 * @param entries the ledger's entries
 */
export function ratingRows(snapshot, entries = []) {
  const posted = new Map()
  for (const e of entries) if (e.type === 'rating' && e.status === 'posted' && (!e.page || e.page === SITE.key)) posted.set(String(e.item), e.at)
  return Object.entries(snapshot?.eps || {})
    .map(([id, ep]) => {
      const last = ep.hist?.at(-1)
      if (!last) return null
      const at = posted.get(id)
      return { id, titleId: ep.titleId, ep: ep.ep, aired: ep.aired, score: last[1], votes: last[2], base: at ? scoreOn(ep.hist, dateOf(at)) : null }
    })
    .filter(Boolean)
}

async function saveState(book, patch) {
  for (let i = 0; i < SAVE_TRIES; i += 1) {
    const { data, version } = await book.read()
    if (await book.write({ ...data, ...patch(data) }, version, 'IMDb ratings')) return true
  }
  return false
}

/** Match the shows to IMDb (kept matches first, TMDB for the rest). */
async function matchAll(titles, { get, cache, tmdbCache, now, say }) {
  const matches = {}
  const tmdbFound = {}
  let looked = 0
  for (const title of titles) {
    const kept = keptMatch(cache, title, now)
    if (kept !== undefined) {
      matches[title.id] = kept === 'miss' ? cache[title.id] : kept
      continue
    }
    if (!get) continue
    try {
      matches[title.id] = await imdbMatchOf(get, title, { tmdbCache, tmdbFound, now })
      looked += 1
    } catch (error) {
      say(`IMDb match for ${title.title} could not be made (${error.message}).`)
    }
  }
  return { matches, tmdbFound, looked }
}

/**
 * The day's ratings: data.ratings = { rows, at }.
 * @param dir a folder holding the two IMDb files (samples, tests); else they are downloaded
 */
export async function loadRatings({ book, now, data, fetch = globalThis.fetch, say = () => {}, key = process.env.TMDB_API_KEY || null, dir = process.env.IMDB_DIR || null, get = null }) {
  let state = {}
  try {
    state = (await book?.read())?.data || {}
  } catch {
    state = {}
  }
  const snap = state.ratings || { at: 0, eps: {} }
  if (now - (snap.at || 0) < FRESH_MS) return { rows: ratingRows(snap, state.entries), at: snap.at }
  try {
    const titles = trackedTitles(data.titles)
    const client = get || (key ? tmdbClient(key, { fetch }) : null)
    const { matches, tmdbFound, looked } = await matchAll(titles, { get: client, cache: state.imdbIds || {}, tmdbCache: state.tmdbIds || {}, now, say })
    const parents = new Set(Object.values(matches).filter((m) => m && !m.miss).map((m) => m.series))
    const episodes = parents.size ? await readEpisodes(await gzLines(EPISODES_FILE, { fetch, dir }), parents) : new Map()
    const add = []
    for (const title of titles) {
      const match = matches[title.id]
      const rows = match && !match.miss ? episodes.get(match.series) : null
      const last = lastAiredOf(title)
      for (let ep = Math.max(1, last - TRACK + 1); ep <= last; ep += 1) {
        const id = imdbEpisode(match, rows, ep)
        if (id) add.push({ id, titleId: title.id, ep, aired: airedAtOf(title, ep, data.schedule) })
      }
    }
    const wanted = new Set([...Object.keys(snap.eps || {}), ...add.map((a) => a.id)])
    const ratings = wanted.size ? await readRatings(await gzLines(RATINGS_FILE, { fetch, dir }), wanted) : new Map()
    const next = updateSnapshot(snap, { now, ratings, add })
    const rated = Object.values(next.eps).filter((e) => e.hist.length).length
    say(`IMDb ratings: ${titles.length} airing shows, ${parents.size} on IMDb (${looked} looked up), ${Object.keys(next.eps).length} episodes followed, ${rated} rated.`)
    const imdbIds = { ...(state.imdbIds || {}), ...matches }
    if (book) {
      await saveState(book, () => ({ ratings: next, imdbIds })).catch((error) => say(`The IMDb ratings could not be kept (${error.message}).`))
      await keepMatches(book, tmdbFound).catch(() => {})
    }
    return { rows: ratingRows(next, state.entries), at: now }
  } catch (error) {
    say(`IMDb ratings could not be read (${error.message}); yesterday's are used.`)
    return { rows: ratingRows(snap, state.entries), at: snap.at }
  }
}

/** The extra the rating types carry (extras.mjs): one read, shared by the three. */
export const ratingsExtra = { name: 'ratings', load: (ctx) => loadRatings(ctx) }
