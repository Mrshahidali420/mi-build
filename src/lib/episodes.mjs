/**
 * One anime's episode list: each episode number with the date it aired (or
 * is set to air), and its title when AniList's streaming list names it.
 *
 * The dates come from airing.json, written each night by the sister ingest
 * (where-build, scripts/ingest-airing.mjs) to the R2 bucket sister-data.
 * scripts/pull-airing.mjs copies it to data/airing.json before the build,
 * and scripts/make-shards.mjs folds the rows into each anime record. The
 * Worker never fetches anything: the list travels in the shard.
 *
 *   history    every dated episode of a show AniList schedules (airing now,
 *              or finished in the last three years), filled in more each night
 *   schedule   every episode airing within 60 days either side of the run
 *   the record streamingEpisodes ("Episode 4 - The Promise") for titles, and
 *              nextEpisode, the next one due
 *
 * Only dated episodes are listed: a number with a title and no date is left
 * out, and a show with too few dates gets no list at all. Nothing is guessed.
 *
 * Pure: records in, rows out. A row is [number, title, airedAt], with '' for
 * a title nobody named, the shape the shard stores.
 */

// A list of one date reads as a mistake, not as a list.
export const MIN_DATED_EPISODES = 2

/** "Episode 12 - The Promise" -> { number: 12, title: 'The Promise' }; null when it names no number. */
export function parseStreamingTitle(text) {
  const match = /^\s*Episode\s+(\d+)\s*(?:[-–—:]\s*(.*))?$/i.exec(String(text || ''))
  if (!match) return null
  return { number: Number(match[1]), title: (match[2] || '').trim() }
}

const isRow = (row) =>
  row && typeof row === 'object' && Number.isInteger(row.at) && row.at > 0 && Number.isInteger(row.episode) && row.episode > 0

/**
 * airing.json, checked and indexed by AniList id: { history, window } as
 * Map(id -> [{ at, episode }]). Anything malformed is dropped row by row;
 * a file that is not an airing file at all gives null.
 */
export function indexAiring(raw) {
  if (!raw || typeof raw !== 'object') return null
  const hasHistory = raw.history && typeof raw.history === 'object' && !Array.isArray(raw.history)
  const hasSchedule = Array.isArray(raw.schedule)
  if (!hasHistory && !hasSchedule) return null

  const history = new Map()
  if (hasHistory) {
    for (const [id, rows] of Object.entries(raw.history)) {
      const good = Array.isArray(rows) ? rows.filter(isRow) : []
      if (good.length) history.set(Number(id), good)
    }
  }
  const window = new Map()
  if (hasSchedule) {
    for (const row of raw.schedule) {
      if (!isRow(row) || !Number.isInteger(row.mediaId)) continue
      if (!window.has(row.mediaId)) window.set(row.mediaId, [])
      window.get(row.mediaId).push(row)
    }
  }
  return { history, window }
}

/** The first air date of every episode number, from every dated source. */
function datesOf(item, history, window) {
  const dates = new Map()
  const keep = (number, at) => {
    if (!Number.isInteger(number) || number < 1 || !Number.isInteger(at) || at <= 0) return
    const known = dates.get(number)
    // A number seen twice (a rerun, a delayed broadcast) keeps its FIRST date.
    if (!known || at < known) dates.set(number, at)
  }
  for (const row of history || []) keep(row.episode, row.at)
  for (const row of window || []) keep(row.episode, row.at)
  if (item.nextEpisode) keep(item.nextEpisode.number, item.nextEpisode.at)
  return dates
}

/**
 * Titles by this season's own episode number. Platforms often count across
 * seasons (season 3 episode 1 is "Episode 49"), so when every named number
 * runs past the season's last episode, they are shifted down to end on it.
 */
function titlesOf(item, last) {
  const parsed = (item.streamingEpisodes || [])
    .map((stream) => parseStreamingTitle(stream && stream.title))
    .filter((p) => p && p.title)
  const titles = new Map()
  if (!parsed.length) return titles
  const numbers = parsed.map((p) => p.number)
  const high = Math.max(...numbers)
  const low = Math.min(...numbers)
  const offset = last > 0 && low > last && high - last < low ? high - last : 0
  for (const p of parsed) {
    const n = p.number - offset
    if (n >= 1 && !titles.has(n)) titles.set(n, p.title)
  }
  return titles
}

/**
 * The dated rows for one anime, oldest first, or [] when the airing file has
 * too little on it. `history` and `window` are that id's rows from indexAiring.
 */
export function buildEpisodes(item, history = [], window = []) {
  if (!item || item.kind !== 'anime') return []
  // The airing file must know the show itself; nextEpisode alone is one date,
  // and the header already counts down to it.
  if (!(history || []).length && !(window || []).length) return []
  const dates = datesOf(item, history, window)
  // A finished show's own count is the truth; anything past it is a rerun
  // numbering or a data slip. A show still airing may run past its planned count.
  const cap = item.status === 'FINISHED' && item.episodes > 0 ? item.episodes : Infinity
  const numbers = [...dates.keys()].filter((n) => n <= cap).sort((a, b) => a - b)
  const last = item.episodes > 0 ? item.episodes : numbers[numbers.length - 1] || 0
  const titles = titlesOf(item, last)
  const rows = numbers.map((n) => [n, titles.get(n) || '', dates.get(n)])
  return rows.length >= MIN_DATED_EPISODES ? rows : []
}

/**
 * Fold the episode rows into each anime record as `episodeList`. Returns a
 * new array; a record without a list comes back as it was. `airing` is the
 * output of indexAiring, or null when there is no file.
 */
export function attachEpisodes(anime, airing) {
  if (!airing) return { anime, count: 0 }
  let count = 0
  const out = anime.map((item) => {
    const rows = buildEpisodes(item, airing.history.get(item.id), airing.window.get(item.id))
    if (!rows.length) return item
    count++
    return { ...item, episodeList: rows }
  })
  return { anime: out, count }
}

/** Unix seconds -> "7 Apr 2013", in UTC. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function airDate(at) {
  if (!at) return ''
  const d = new Date(at * 1000)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** Unix seconds -> "2013-04-07", for <time datetime>. */
export const isoDate = (at) => (at ? new Date(at * 1000).toISOString().slice(0, 10) : '')
