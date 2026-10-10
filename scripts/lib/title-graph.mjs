/**
 * The title graph make-shards.mjs stores inside each record: the reading
 * order (item.chain) and the adaptation on the other side (item.adapt). Moved
 * here from scripts/make-shards.mjs unchanged, to keep that file small.
 */
import { sectionOf as kindOf } from '../../src/lib/section.mjs'

/** The same medium? A comic sequel is a comic, an anime sequel is an anime. */
export const sameMedium = (a, b) => (a.kind === 'anime') === (b.kind === 'anime')

/** One step along the story, in one direction, inside the same medium. */
function step(item, byId, relation) {
  for (const rel of item.relations || []) {
    if (rel.relation !== relation) continue
    const found = byId.get(rel.id)
    if (found && found.id !== item.id && sameMedium(item, found)) return found
  }
  return null
}

/**
 * When an announced title is due. Only what the page needs to say "premieres
 * on 10 Jan" or "announced for Winter 2027": nothing for a title already out.
 */
const premiere = (p) =>
  p.status === 'NOT_YET_RELEASED'
    ? {
        ...(p.startDate ? { startDate: p.startDate } : {}),
        ...(p.startPrecision ? { startPrecision: p.startPrecision } : {}),
        ...(p.season && p.seasonYear ? { season: p.season, seasonYear: p.seasonYear } : {}),
      }
    : {}

const part = (p, self) => ({
  slug: p.slug,
  title: p.title,
  kind: kindOf(p),
  status: p.status,
  chapters: p.chapters || null,
  episodes: p.episodes || null,
  startYear: p.startYear || null,
  ...premiere(p),
  ...(self ? { self: true } : {}),
})

/**
 * The order to read a series in.
 *
 * We walk back through PREQUEL until the story starts, then forward through
 * SEQUEL until it ends. A `seen` set stops a loop, because AniList data does
 * sometimes point in a circle. A single book gets an empty chain.
 */
export function readingChain(item, byId) {
  const seen = new Set([item.id])
  const before = []
  for (let at = step(item, byId, 'PREQUEL'); at && !seen.has(at.id); at = step(at, byId, 'PREQUEL')) {
    seen.add(at.id)
    before.unshift(part(at))
  }
  const after = []
  for (let at = step(item, byId, 'SEQUEL'); at && !seen.has(at.id); at = step(at, byId, 'SEQUEL')) {
    seen.add(at.id)
    after.push(part(at))
  }
  if (before.length + after.length === 0) return null
  return [...before, part(item, true), ...after]
}

export const ADAPT_RELATIONS = new Set(['ADAPTATION', 'SOURCE'])

/**
 * How the anime and the comic line up. For a comic this is every anime made
 * from it; for an anime it is the book it came from. Only titles that are in
 * our own index are used, because we only ever link to a page we hold.
 */
export function adaptationOf(item, byId) {
  const isComic = item.kind !== 'anime'
  const hits = (item.relations || [])
    .filter((rel) => ADAPT_RELATIONS.has(rel.relation))
    .map((rel) => byId.get(rel.id))
    .filter((found) => found && !sameMedium(item, found))

  if (isComic) {
    const shows = hits.map((show) => ({
      slug: show.slug,
      title: show.title,
      format: show.format || 'TV',
      episodes: show.episodes || null,
      status: show.status,
      startYear: show.startYear || null,
      ...premiere(show),
      // The airing clock travels with the show, so a comic page can say when
      // its own anime airs next without loading the anime record.
      nextEpisode: show.nextEpisode || null,
      // Where the anime streams, so a comic with no official link of its own
      // can still say where its story can be watched (src/lib/prose.mjs).
      ...adaptSites(show),
    }))
    shows.sort((a, b) => (a.startYear || 9999) - (b.startYear || 9999))
    return shows.length ? { shows } : null
  }

  const src = hits[0]
  if (!src) return null
  return {
    source: {
      slug: src.slug,
      title: src.title,
      kind: kindOf(src),
      chapters: src.chapters || null,
      status: src.status,
      ...adaptSites(src),
    },
  }
}

const ADAPT_SITES_MAX = 3

/**
 * The first few official platforms of the other side of an adaptation: where
 * the anime streams, or, for the book, where it is read in English. Stored
 * only when there is one, so most records pay nothing for it.
 */
function adaptSites(p) {
  const links = p.kind === 'anime' ? p.watchLinks || [] : (p.readLinks || []).filter((l) => l.language === 'English')
  const sites = [...new Set(links.map((l) => l.site).filter(Boolean))].slice(0, ADAPT_SITES_MAX)
  return sites.length ? { sites } : {}
}
