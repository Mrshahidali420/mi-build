/**
 * Manhwa Index's titles for the Facebook Page poster.
 *
 * Data source (decided 12 Oct 2026): the catalog the deploy workflow keeps in
 * the GitHub Actions cache (data/anime.json, data/comics.json, restored by
 * .github/workflows/fb-post.yml with the deploy's exact path list). It is at
 * most six hours old, costs no request to anyone, and the runner never
 * touches the live site (Bot Fight Mode 403s runner fetches) or AniList.
 * When the cache is missing the small committed seed (data/seed/*.json.gz)
 * stands in, so a dry run still shows real samples.
 *
 * Only a title page that is live and indexable is promoted: title pages are
 * never noindexed (src/lib/thin-pages.mjs), blocked titles (data/block.json)
 * and adult records are dropped, and so is any record carrying a tag or
 * genre from BLOCKED_TAGS (Facebook bans adult content). A title also needs
 * a cover and at least one official English or worldwide platform.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { freeSplit } from '../../src/lib/answers.mjs'
import { sectionOf } from '../../src/lib/section.mjs'
import { BLOCKED_TAGS, isBlocked } from '../../src/lib/prose-words.mjs'
import { BLOCKED_MEDIA } from '../../src/lib/blocked.js'
import { shopFinder } from './shop.mjs'
import { storyOf } from './story.mjs'

export { BLOCKED_TAGS }

const DAY_MS = 86_400_000
/** A NEW "airing" item: an episode in the next this-many hours. */
export const AIRING_HOURS = 30
/** A NEW "running" item: AniList touched it in the last this-many days. */
export const RUNNING_DAYS = 3
/** Floors that keep obscure titles off the Page. */
export const MIN_POPULARITY = { airing: 3000, running: 5000, old: 5000 }
const OLD_POOL = 1500
const OLD_TURNS = ['manhwa', 'manga', 'anime', 'manhwa', 'manhua', 'novel']

const COUNTRY = { KR: 'Korean', JP: 'Japanese', CN: 'Chinese', TW: 'Taiwanese' }
const SHOW = { TV: 'TV anime', TV_SHORT: 'short anime', MOVIE: 'anime film', ONA: 'web anime', OVA: 'OVA', SPECIAL: 'anime special' }

function nounOf(item, section) {
  if (section === 'anime') return SHOW[item.format] || 'anime'
  if (section === 'novel') return 'novel'
  return COUNTRY[item.country] ? `${COUNTRY[item.country]} ${section}` : section
}

/** Official sites an English-speaking reader can use, one per site name. */
export function platformsOf(links = []) {
  const seen = new Set()
  const out = []
  for (const link of links) {
    if (!link?.site || !link.url) continue
    if (link.language && !/english/i.test(link.language)) continue
    if (seen.has(link.site)) continue
    seen.add(link.site)
    out.push(link.site)
  }
  return out
}

/**
 * Every official site the title page lists, one per site name, the ones an
 * English speaker can use first: [{ site, language, free }]. `free` is the
 * site's own "free to start" fact (src/lib/answers.mjs freeSplit). The page
 * counts these ("3 legal places · 3 free to start"), so the posts do too.
 */
export function placesOf(links = []) {
  const usable = links.filter((link) => link?.site && link.url)
  const free = new Set(freeSplit(usable).free.map((row) => row.link.site))
  const english = (link) => !link.language || /english/i.test(link.language)
  const bySite = new Map()
  for (const link of [...usable.filter(english), ...usable.filter((l) => !english(l))]) {
    if (!bySite.has(link.site)) bySite.set(link.site, { site: link.site, language: english(link) ? null : link.language, free: free.has(link.site) })
  }
  return [...bySite.values()]
}

export const isSafe = (item) =>
  !item.isAdult && !BLOCKED_MEDIA.has(item.id) && ![...(item.genres || []), ...(item.tags || [])].some((t) => isBlocked(typeof t === 'string' ? t : t?.name))

const startOf = (item) =>
  Array.isArray(item.startDate) && item.startDate[0] ? { year: item.startDate[0], month: item.startDate[1] || null, day: item.startDate[2] || null, precision: item.startPrecision || null } : null

/** The main cast with a real picture (the template posts draw them). */
const castOf = (item) =>
  (item.characters || [])
    .filter((c) => c?.role === 'MAIN' && c.name && c.image && !/\/default\./.test(c.image))
    .map((c) => ({ id: c.id, name: c.name, image: c.image }))

/** The anime made from a comic, when the index holds its page. */
function adaptationOf(item) {
  const anime = (item.animeInIndex || [])[0]
  return anime?.title ? { title: anime.title, episodes: anime.episodes || null } : null
}

/** One catalog record as a candidate, or null when it may not be promoted. */
export function toCandidate(item, shopFor = null) {
  if (!item?.slug || !item.title || !item.cover || !isSafe(item)) return null
  const section = sectionOf(item)
  const verb = section === 'anime' ? 'watch' : 'read'
  const platforms = platformsOf(verb === 'watch' ? item.watchLinks : item.readLinks)
  if (!platforms.length) return null
  const next = item.nextEpisode
  return {
    // Rating, another name, a short synopsis (story.mjs) and the site's shop pick (shop.mjs).
    ...storyOf(item),
    shop: shopFor ? shopFor(item) : null,
    places: placesOf(verb === 'watch' ? item.watchLinks : item.readLinks),
    // Read by the template posts (types/): what the record states, nothing more.
    season: item.season && item.seasonYear ? { name: item.season, year: item.seasonYear } : null,
    start: startOf(item),
    volumes: item.volumes || null,
    ranks: (item.ranks || []).filter((r) => r?.allTime && r.rank > 0).map((r) => ({ rank: r.rank, type: r.type })),
    cast: castOf(item),
    adaptation: adaptationOf(item),
    id: item.id,
    slug: item.slug,
    title: item.title,
    path: `/${section}/${item.slug}`,
    image: item.cover,
    section,
    verb,
    noun: nounOf(item, section),
    year: item.startYear || null,
    endYear: item.endYear || null,
    status: item.status || null,
    chapters: item.chapters || null,
    episodes: item.episodes || null,
    score: item.score || null,
    genres: (item.genres || []).filter((g) => !isBlocked(g)),
    platforms,
    studio: String(item.studios?.[0] || '').trim() || null,
    nextEpisode: next?.at && next?.number ? { number: next.number, at: next.at * 1000 } : null,
    popularity: item.popularity || 0,
    updatedAt: (item.updatedAt || 0) * 1000,
    recIds: (item.recIds || []).map((r) => r.id),
    recs: [],
  }
}

/** AniList users' recommendations that are themselves promotable. */
/** Turns between two lists, so episode news and running series share the NEW slots. */
export function alternate(a, b) {
  const out = []
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (i < a.length) out.push(a[i])
    if (i < b.length) out.push(b[i])
  }
  return out
}

function attachRecs(candidate, byId) {
  const own = candidate.title.toLowerCase()
  const recs = []
  for (const id of candidate.recIds) {
    const rec = byId.get(id)
    if (!rec) continue
    const t = rec.title.toLowerCase()
    if (t.includes(own) || own.includes(t)) continue
    recs.push({ title: rec.title, image: rec.image, section: rec.section })
    if (recs.length === 3) break
  }
  return { ...candidate, recs }
}

/**
 * NEW: anime with an episode in the next AIRING_HOURS, in turns with comics still
 * running that AniList updated in the last RUNNING_DAYS. OLD: the most
 * popular titles. Each list is in the order the picker should prefer.
 */
export const buildPools = (items, now, shopFor = null) => poolsOf(buildData(items, now, shopFor), now)

/**
 * What the template posts read: every title that may be promoted, most
 * popular first, with its recommendations, and the same list by AniList id.
 */
export function buildData(items, now, shopFor = null) {
  const all = items.map((item) => toCandidate(item, shopFor)).filter(Boolean)
  const byId = new Map(all.map((c) => [c.id, c]))
  const titles = all.map((c) => attachRecs(c, byId)).sort((x, y) => y.popularity - x.popularity)
  return { now, titles, byId: new Map(titles.map((t) => [t.id, t])) }
}

function poolsOf(data, now) {
  const withRecs = data.titles
  const byPop = (x, y) => y.popularity - x.popularity

  const airing = withRecs
    .filter((c) => c.nextEpisode && c.nextEpisode.at > now && c.nextEpisode.at <= now + AIRING_HOURS * 3_600_000 && c.popularity >= MIN_POPULARITY.airing)
    .sort(byPop)
  const airingIds = new Set(airing.map((c) => c.id))
  const running = withRecs
    .filter((c) => c.verb === 'read' && !airingIds.has(c.id) && c.status === 'RELEASING' && c.updatedAt >= now - RUNNING_DAYS * DAY_MS && c.popularity >= MIN_POPULARITY.running)
    .sort(byPop)
  return { new: alternate(airing, running), old: interleave(withRecs.filter((c) => c.popularity >= MIN_POPULARITY.old).sort(byPop)) }
}

/**
 * The OLD pool, most popular first but taken in turns by section, so anime
 * (far more AniList users) does not crowd out the comics this site is about.
 * Manhwa gets two turns in every round.
 */
export function interleave(sorted, turns = OLD_TURNS, size = OLD_POOL) {
  const lists = new Map()
  for (const c of sorted) {
    if (!lists.has(c.section)) lists.set(c.section, [])
    lists.get(c.section).push(c)
  }
  const out = []
  while (out.length < size && turns.some((s) => lists.get(s)?.length)) {
    for (const section of turns) {
      const next = lists.get(section)?.shift()
      if (next) out.push(next)
    }
  }
  return out.slice(0, size)
}

/** The site's shop picks; without the files there is simply no Amazon line. */
function siteShop() {
  try {
    return shopFinder()
  } catch {
    return null
  }
}

function readCatalog(dir, name) {
  const full = join(dir, `${name}.json`)
  if (existsSync(full)) return { items: JSON.parse(readFileSync(full, 'utf8')), from: full }
  const seed = join(dir, 'seed', `${name}.json.gz`)
  if (existsSync(seed)) return { items: JSON.parse(gunzipSync(readFileSync(seed)).toString('utf8')), from: seed }
  return { items: [], from: null }
}

/** The pools from data/, and a line saying where they came from. */
export function loadPools({ dir = join(process.cwd(), 'data'), now = Date.now() } = {}) {
  const anime = readCatalog(dir, 'anime')
  const comics = readCatalog(dir, 'comics')
  const data = buildData([...anime.items, ...comics.items], now, siteShop())
  const seeded = [anime.from, comics.from].some((f) => f && f.endsWith('.gz'))
  const source = `catalog: ${anime.items.length} anime, ${comics.items.length} comics and novels${seeded ? ' (the small seed: the Actions cache was not restored)' : ' (Actions cache)'}`
  return { pools: poolsOf(data, now), data, source }
}

/** The data read once, as a function of the day it is looked at from (samples.mjs). */
export async function dataLoader({ dir = join(process.cwd(), 'data') } = {}) {
  const items = [...readCatalog(dir, 'anime').items, ...readCatalog(dir, 'comics').items]
  const shopFor = siteShop()
  return (now) => buildData(items, now, shopFor)
}
