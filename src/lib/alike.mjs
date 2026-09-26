/**
 * "Read something like it, legally, now": the next step on a comic page that
 * has no official English platform.
 *
 * Those pages are found on Google (a reader types the title), and then the
 * page has nothing to click except the Amazon box: /manga/my-fated-mate-is-a-
 * prince had 114 arrivals in a day and 1.6 in 100 clicked out. A reader who
 * cannot read THIS story legally in English can still read one like it, so
 * the page offers four to six titles that share its genres and tags and DO
 * have an English licence.
 *
 * The order: first how close the match is (shared genres, then shared tags),
 * which picks a short list; then, inside that list, how often our own readers
 * actually opened a platform from each title's page (data/handoff.json,
 * written each night by scripts/plan-home.mjs from D1). A title readers leave
 * through is a title that works as a next step. Without that file (a local
 * build, a lost cache) the order falls back to AniList popularity.
 *
 * Worked out once per build in scripts/make-shards.mjs and stored in the
 * record, like `similar`, because the Worker has no catalog at request time.
 * Pure: no disk, no network, so the tests can call it with plain objects.
 */

export const ALIKE_MAX = 6
// Fewer than four and the block is dropped: two covers under a heading that
// promises a choice reads as an afterthought.
export const ALIKE_MIN = 4
// The short list the hand-off order is allowed to reshuffle. Wide enough to
// let a title readers really leave through rise, narrow enough that a weak
// genre match never jumps a close one.
export const SHORT_LIST = 12
// Candidates kept per genre, most popular first. The same cap make-shards
// uses for `similar`, and for the same reason: it keeps the build finite.
export const POOL_PER_GENRE = 300
// A rate from fewer opens than this is noise, so the night job leaves those
// pages out of the file and they rank by popularity.
export const HANDOFF_MIN_OPENS = 30

/** A comic or a novel: an anime is never a "read" suggestion. */
const mediumOf = (item) => (item.kind === 'anime' ? 'anime' : item.kind === 'novel' ? 'novel' : 'comic')

/** An official English platform is what "legally, now" means to this reader. */
export const hasEnglishRead = (item) => (item.readLinks || []).some((link) => link.language === 'English')

/**
 * Does this page need the block? A comic or novel with no official English
 * platform: none at all, or only in languages AniList names and that are not
 * English. A link with no language could be English, so it counts as one:
 * the page must never say "not licensed in English" on a guess.
 */
export const needsAlike = (item) =>
  item.kind !== 'anime' && (item.readLinks || []).every((link) => link.language && link.language !== 'English')

/**
 * medium|genre -> licensed titles carrying that genre, most popular first.
 * Only titles with an English platform go in, so every pick is readable.
 */
export function licensedPools(titles, perGenre = POOL_PER_GENRE) {
  const licensed = titles
    .filter((t) => t.kind !== 'anime' && t.cover && hasEnglishRead(t))
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0) || a.id - b.id)
  const pools = new Map()
  for (const t of licensed) {
    for (const genre of t.genres || []) {
      const key = `${mediumOf(t)}|${genre}`
      let list = pools.get(key)
      if (!list) pools.set(key, (list = []))
      if (list.length < perGenre) list.push(t)
    }
  }
  return pools
}

/** Share of opens that went on to an official platform, or null when unknown. */
export function handoffRate(handoff, id) {
  const row = handoff?.pages?.[id]
  if (!Array.isArray(row)) return null
  const [opens, outs] = row.map(Number)
  if (!(opens >= HANDOFF_MIN_OPENS)) return null
  return Math.min(Math.max(outs, 0) / opens, 1)
}

/**
 * Up to six licensed titles like `item`, each with the genres it shares, or
 * [] when fewer than four qualify. `thin` shapes each pick for the record.
 */
export function alikeFor(item, pools, { handoff = null, thin = (p) => p } = {}) {
  if (!needsAlike(item)) return []
  const genres = item.genres || []
  if (!genres.length) return []
  const tags = new Set((item.tags || []).slice(0, 8))
  // A one-genre title can only ever share one genre.
  const needGenres = Math.min(2, genres.length)
  const medium = mediumOf(item)

  const shared = new Map()
  for (const genre of genres) {
    for (const cand of pools.get(`${medium}|${genre}`) || []) {
      if (cand.id === item.id) continue
      let list = shared.get(cand)
      if (!list) shared.set(cand, (list = []))
      list.push(genre)
    }
  }

  const matchOf = (cand, genresShared) =>
    genresShared.length + 0.5 * (cand.tags || []).filter((t) => tags.has(t)).length
  const short = [...shared]
    .filter(([, g]) => g.length >= needGenres)
    .map(([cand, g]) => ({ cand, g, match: matchOf(cand, g), rate: handoffRate(handoff, cand.id) }))
    .sort((a, b) => b.match - a.match || (b.cand.popularity || 0) - (a.cand.popularity || 0) || a.cand.id - b.cand.id)
    .slice(0, SHORT_LIST)
  if (short.length < ALIKE_MIN) return []

  // Inside the short list: a known hand-off rate first, best first; then the
  // closest match; then popularity. Ties by id, so a build is repeatable.
  short.sort(
    (a, b) =>
      (b.rate ?? -1) - (a.rate ?? -1) ||
      b.match - a.match ||
      (b.cand.popularity || 0) - (a.cand.popularity || 0) ||
      a.cand.id - b.cand.id,
  )
  return short.slice(0, ALIKE_MAX).map(({ cand, g }) => ({ ...thin(cand), shared: g.slice(0, 3) }))
}

// Shops and social accounts are not a place to read, whatever their address.
const NOT_A_READER = /(^|\.)(amazon|rakuten|twitter|x|instagram|facebook|youtube|tiktok)\.co(m|\.jp)?$/i

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Official Japanese pages AniList lists for a title (a publisher page or an
 * official app), for a page with no English platform. Only INFO links count,
 * never social accounts, and only when AniList says the link is Japanese or
 * the address itself is a .jp site: nothing is guessed from the title's
 * country. Each comes back with its host, so the page can say where it goes.
 */
export function japaneseLinks(item, max = 3) {
  if (!needsAlike(item)) return []
  const seen = new Set()
  const out = []
  for (const link of item.otherLinks || []) {
    if (link.type && link.type !== 'INFO') continue
    const host = hostOf(link.url)
    if (!host || NOT_A_READER.test(host) || seen.has(host)) continue
    const japanese = link.language === 'Japanese' || host.endsWith('.jp')
    if (!japanese || !/^https?:\/\//i.test(link.url)) continue
    seen.add(host)
    out.push({ site: link.site || host, url: link.url, host })
    if (out.length >= max) break
  }
  return out
}
