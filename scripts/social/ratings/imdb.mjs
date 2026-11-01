/**
 * IMDb's free daily files (https://datasets.imdbws.com/, tab-separated,
 * gzipped, refreshed once a day):
 *
 *   title.ratings.tsv.gz   tconst, averageRating, numVotes          (~9 MB)
 *   title.episode.tsv.gz   tconst, parentTconst, seasonNumber, episodeNumber (~55 MB)
 *
 * Both are read as a stream, line by line, and only the rows asked for are
 * kept, so the big file never sits in memory whole.
 */
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { createGunzip } from 'node:zlib'

export const IMDB_HOST = 'https://datasets.imdbws.com'
export const RATINGS_FILE = 'title.ratings.tsv.gz'
export const EPISODES_FILE = 'title.episode.tsv.gz'
const TIMEOUT_MS = 180_000

/** The lines of a gzipped file: from a local path when one is given (tests, samples), else from IMDb. */
export async function gzLines(name, { fetch = globalThis.fetch, dir = null } = {}) {
  let raw
  if (dir) raw = createReadStream(`${dir}/${name}`)
  else {
    const res = await fetch(`${IMDB_HOST}/${name}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok || !res.body) throw new Error(`IMDb answered ${res.status} for ${name}`)
    raw = Readable.fromWeb(res.body)
  }
  return createInterface({ input: raw.pipe(createGunzip()), crlfDelay: Infinity })
}

/** Rating and votes of the episodes asked for: Map tconst -> { score, votes }. The header line is skipped. */
export async function readRatings(lines, wanted) {
  const found = new Map()
  for await (const line of lines) {
    const tab = line.indexOf('\t')
    const id = line.slice(0, tab)
    if (!wanted.has(id)) continue
    const [, score, votes] = line.split('\t')
    const s = Number(score)
    const v = Number(votes)
    if (Number.isFinite(s) && Number.isFinite(v)) found.set(id, { score: s, votes: v })
  }
  return found
}

/** The episodes of the series asked for: Map parentTconst -> [{ id, season, episode }]. Rows without numbers are left out. */
export async function readEpisodes(lines, parents) {
  const found = new Map()
  for await (const line of lines) {
    const cut = line.indexOf('\t')
    const rest = line.slice(cut + 1)
    const parent = rest.slice(0, rest.indexOf('\t'))
    if (!parents.has(parent)) continue
    const [id, , season, episode] = line.split('\t')
    const s = Number(season)
    const e = Number(episode)
    if (!Number.isInteger(s) || !Number.isInteger(e)) continue
    if (!found.has(parent)) found.set(parent, [])
    found.get(parent).push({ id, season: s, episode: e })
  }
  return found
}
