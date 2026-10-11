/**
 * Spreading internal links across the catalog.
 *
 * "You may also like" picks its six titles from the most popular titles of
 * each genre, so the same few hundred names filled the block on every page.
 * The link count on 10 Oct 2026: /manga/dandadan had 28,142 links in, while
 * 22,118 title pages had no link from any page Google indexes.
 *
 * Two rules here fix both ends. Both are pure, need no clock and no random
 * numbers, and give the same answer on every build for the same catalog, so
 * a page's picks do not reshuffle between builds.
 *
 * 1. THE SPREAD AND THE CAP (spreadRank, capPicks). Among the candidates
 *    that share the same number of genres with a page, the order is no longer
 *    "most read first" for every page alike. Each page draws its own order
 *    from a fixed number worked out from the two ids, weighted so a well read
 *    title still comes up more often. On top of that no title fills a place
 *    on more than SIMILAR_CAP pages: once it has, the place goes to the next
 *    candidate. A pick AniList readers voted for is never dropped, and a page
 *    never shows fewer picks than it has candidates for. Pages are walked in
 *    a fixed order (spotOrder), so the answer is the same on every build.
 *
 * 2. THE QUIET SLOT (lessKnownPicks). A title with fewer than LESS_KNOWN_BELOW
 *    links in is placed on the pages of LESS_KNOWN_HOSTS other titles of its
 *    own kind that share two of its genres (one, when it has only one). A
 *    title with no genre on record goes on pages by the same author or
 *    studio. No host carries more than LESS_KNOWN_PER_HOST, and a title with
 *    nothing in common with any other is left out. Never a random pick.
 *
 * Called by scripts/make-shards.mjs.
 */

export const SIMILAR_SHOWN = 6
export const SIMILAR_CAP = 300
export const LESS_KNOWN_BELOW = 2
export const LESS_KNOWN_HOSTS = 2
export const LESS_KNOWN_PER_HOST = 4

/** A fixed number in [0, 1) for a pair of ids. The same pair, the same number. */
export function pairChance(a, b) {
  let h = (Math.imul(Number(a) | 0, 0x9e3779b1) ^ Math.imul(Number(b) | 0, 0x85ebca6b)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  return h / 4294967296
}

// Every title has a fixed spot on a ring, worked out from its id alone. Pages
// are walked, and hosts are looked for, along that ring, so a title added to
// the catalog later slots in between two others and moves nothing else.
const SPOT_SEED = 0x5bd1e995
const spotOf = (id) => pairChance(id, SPOT_SEED)

/** The titles in their fixed ring order. */
export function spotOrder(titles) {
  return titles
    .map((title) => ({ title, spot: spotOf(title.id) }))
    .sort((a, b) => a.spot - b.spot || a.title.id - b.title.id)
    .map((seat) => seat.title)
}

/**
 * This page's draw for one candidate, in (0, 1]. Higher comes first. A fixed
 * number per pair, pulled towards 1 for a well read title, so across many
 * pages a title turns up more often the more readers it has.
 */
export function spreadDraw(itemId, candidate) {
  const weight = Math.sqrt((candidate.popularity || 0) + 1)
  return Math.pow(pairChance(itemId, candidate.id) || Number.MIN_VALUE, 1 / weight)
}

/**
 * A page's candidates in the order it tries them. `rows` are
 * [candidate, shared] pairs. Readers' suggestions first, then the most genres
 * shared, then this page's own draw.
 */
export function spreadRank(rows, { itemId, recSet = new Set() }) {
  return rows
    .map(([candidate, shared]) => ({
      row: [candidate, shared],
      rec: recSet.has(candidate.id) ? 1 : 0,
      shared: shared.length,
      draw: spreadDraw(itemId, candidate),
    }))
    .sort((x, y) => y.rec - x.rec || y.shared - x.shared || y.draw - x.draw || x.row[0].id - y.row[0].id)
    .map((entry) => entry.row)
}

/**
 * The picks one page shows, from its ranked rows. `usedOf(id)` is how many
 * pages already show the candidate. A candidate at the cap is passed over,
 * unless `always(candidate)` says it is never dropped, or there are not
 * enough others to fill the block. The caller counts the picks it is given.
 */
export function capPicks(ranked, { usedOf, always = () => false, shown = SIMILAR_SHOWN, cap = SIMILAR_CAP }) {
  const kept = new Set()
  const passed = []
  for (const row of ranked) {
    if (kept.size >= shown) break
    if (always(row[0]) || usedOf(row[0].id) < cap) kept.add(row)
    else passed.push(row)
  }
  for (const row of passed) {
    if (kept.size >= shown) break
    kept.add(row)
  }
  // Rank order is kept: a row that came back sits where it ranked.
  return ranked.filter((row) => kept.has(row))
}

/** The genre keys a title is filed under: every pair of its genres, or its one genre. */
export function genreKeys(kind, genres) {
  const list = [...new Set(genres || [])].sort()
  if (list.length === 1) return [`${kind}|${list[0]}`]
  const keys = []
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) keys.push(`${kind}|${list[i]}|${list[j]}`)
  }
  return keys
}

/** The keys of the people and studios behind a title, for a title with no genre. */
export function makerKeys(kind, title) {
  const names = [...(title.authors || []).map((a) => a && a.name), ...(title.studios || [])]
  return [...new Set(names.filter(Boolean))].sort().map((name) => `${kind}|by|${name}`)
}

/** First index in a spot-sorted list whose spot is not below `spot`. */
function lowerBound(list, spot) {
  let low = 0
  let high = list.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (list[mid].spot < spot) low = mid + 1
    else high = mid
  }
  return low
}

/**
 * Places every weakly linked title on other titles' pages.
 *
 * titles:   every title, each with a numeric id and genres
 * kindOf:   title -> its section (picks never cross sections)
 * inbound:  Map(id -> links in from the other blocks)
 *
 * Returns Map(hostId -> [[title, sharedGenres], ...]), at most `perHost` rows
 * per host. The host is found by its fixed spot, not by its position in a
 * list, so a title added to the catalog tomorrow does not move the picks
 * already placed.
 */
export function lessKnownPicks(
  titles,
  { kindOf, inbound, below = LESS_KNOWN_BELOW, hosts = LESS_KNOWN_HOSTS, perHost = LESS_KNOWN_PER_HOST } = {}
) {
  const byKey = new Map()
  const ordered = [...titles].filter((t) => Number.isFinite(t.id)).sort((a, b) => a.id - b.id)
  const ring = ordered.map((title) => ({ title, spot: spotOf(title.id) })).sort((a, b) => a.spot - b.spot || a.title.id - b.title.id)
  for (const seat of ring) {
    const kind = kindOf(seat.title)
    for (const key of [...genreKeys(kind, seat.title.genres), ...makerKeys(kind, seat.title)]) {
      const list = byKey.get(key)
      if (list) list.push(seat)
      else byKey.set(key, [seat])
    }
  }

  const placed = new Map()
  const load = (id) => placed.get(id)?.length || 0
  const weak = ordered.filter((t) => t.cover && t.slug && (inbound.get(t.id) || 0) < below)
  for (const title of weak) {
    const byGenre = genreKeys(kindOf(title), title.genres)
    const keys = byGenre.length ? byGenre : makerKeys(kindOf(title), title)
    if (!keys.length) continue
    const mine = new Set()
    const want = Math.max(0, hosts - (inbound.get(title.id) || 0))
    for (let n = 0; n < keys.length * 2 && mine.size < want; n++) {
      const key = keys[Math.floor(pairChance(title.id, n) * keys.length)]
      const list = byKey.get(key)
      if (!list || list.length < 2) continue
      const start = lowerBound(list, pairChance(n, title.id))
      for (let step = 0; step < list.length; step++) {
        const host = list[(start + step) % list.length].title
        if (host.id === title.id || mine.has(host.id) || load(host.id) >= perHost) continue
        const parts = key.split('|').slice(1)
        // A maker key carries a name, not genres: [title, [], name].
        const row = parts[0] === 'by' ? [title, [], parts.slice(1).join('|')] : [title, parts]
        if (placed.has(host.id)) placed.get(host.id).push(row)
        else placed.set(host.id, [row])
        mine.add(host.id)
        break
      }
    }
  }
  return placed
}
