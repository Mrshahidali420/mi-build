// BUILD TIME ONLY. This module loads the whole catalog (26 MB of JSON), so a
// page that imports it can never be rendered by the Worker. Pages that the
// Worker renders import lib/format.js and lib/runtime.js instead.
// The three files are read with plain Node, NOT with `import ... from
// '*.json'`. An ESM JSON import hands the file to Vite/Rollup, which turns it
// into a JavaScript module and keeps it in the bundle graph. At 2,499 comics
// that was free. At 86,294 comics comics.json is 147 MB and that transform
// alone pushed the build past 50 minutes. readFileSync skips the bundler.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { reslugAll } from './reslug.mjs'
import { loadRegistry } from './slug-registry.mjs'
import { dropBlocked, dropBlockedRows } from './blocked.js'
import { migrateAliasedLinksAll } from './platform-aliases.mjs'

// Resolved from the working directory, not from import.meta.url: this module is
// bundled into dist/_worker.js before the prerender step runs it, so a path
// relative to the file itself would point inside dist. Every build (npm run
// build, and the CI job) starts at the project root.
const readJson = (name) =>
  JSON.parse(readFileSync(join(process.cwd(), 'data', `${name}.json`), 'utf8'))

// A blocked title leaves before anything reads the catalog, so no built page,
// list, hub or sitemap row can name it. See src/lib/blocked.js.
const comicsRaw = dropBlockedRows(dropBlocked(readJson('comics')))
const animeRaw = dropBlockedRows(dropBlocked(readJson('anime')))
const characterData = readJson('characters')

// A record ingested before its site name was recognised (e.g. AniList's
// "Kodansha USA") keeps that raw name in otherLinks forever, because the
// ingest never refetches an unchanged AniList record (it probes updatedAt;
// see scripts/ingest-daily.mjs). Applying the alias here, on every build,
// reaches those already-stored records without a refetch. See
// src/lib/platform-aliases.mjs.
migrateAliasedLinksAll(comicsRaw)
import { characterHasPage, genreSlug } from './format.js'

// Public URLs carry clean slugs, never database ids (see reslug.mjs). The
// slugs come from data/slug-registry.json, which make-redirects.mjs saved at
// the start of this build; frozen, so a built page and a shard can never
// disagree about an address. See make-shards.mjs for REGISTRY_READONLY.
{
  const registry = loadRegistry()
  const frozen = !!registry && process.env.REGISTRY_READONLY !== '1'
  reslugAll(comicsRaw, animeRaw, characterData, { registry, frozen })
}

// Novels ride in comics.json with kind 'novel'. The site keeps them apart.
export const comics = comicsRaw.filter((c) => c.kind !== 'novel')
export const novels = comicsRaw.filter((c) => c.kind === 'novel')
export const anime = animeRaw

// Everything a Worker-rendered page also needs is re-exported, so the pages
// that were already written against catalog.js keep working unchanged.
export * from './format.js'

/** Sort helper: most-read first, which is also what people search for. */
const byPopularity = (a, b) => b.popularity - a.popularity

export const comicsByPopularity = [...comics].sort(byPopularity)
export const animeByPopularity = [...anime].sort(byPopularity)
export const novelsByPopularity = [...novels].sort(byPopularity)

// Memoised on purpose. Every browse page calls this, and there are ~1,500 of
// them. Without the cache each call walks all 86,000 comics again.
const byCountry = new Map()
export const comicsOfCountry = (code) => {
  let list = byCountry.get(code)
  if (!list) {
    list = comicsByPopularity.filter((c) => c.country === code)
    byCountry.set(code, list)
  }
  return list
}

export const findComic = (slug) => comics.find((c) => c.slug === slug)
export const findAnime = (slug) => anime.find((a) => a.slug === slug)

/** AniList media ids are one global space, so one map covers both shelves. */
const itemById = new Map()
for (const c of comics) itemById.set(c.id, { item: c, kind: 'comic' })
for (const a of anime) itemById.set(a.id, { item: a, kind: 'anime' })
for (const n of novels) itemById.set(n.id, { item: n, kind: 'novel' })
export const inIndex = (id) => itemById.get(id)

/** Anime with an episode airing in the next 7 days, soonest first.
 *  The site rebuilds daily, so this list stays honest. */
const WEEK = 7 * 86400
const nowSec = Date.now() / 1000
export const airingThisWeek = anime
  .filter((a) => a.nextEpisode && a.nextEpisode.at > nowSec && a.nextEpisode.at < nowSec + WEEK)
  .sort((a, b) => a.nextEpisode.at - b.nextEpisode.at)

/** Genres worth giving their own page: enough titles to be useful. */
export function genreIndex(items, minimum = 12) {
  const map = new Map()
  for (const item of items) {
    for (const genre of item.genres) {
      if (!map.has(genre)) map.set(genre, [])
      map.get(genre).push(item)
    }
  }
  return [...map.entries()]
    .filter(([, list]) => list.length >= minimum)
    .map(([name, list]) => ({
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      items: list.sort(byPopularity),
    }))
    .sort((a, b) => b.items.length - a.items.length)
}

// --- characters -------------------------------------------------------------
export const characters = characterData

export function findCharacter(slug) {
  return characters.find((c) => c.slug === slug)
}

// Most-loved first: the character's own AniList favourites count, then the
// popularity of their biggest title as the tie-break. Sorting by the title
// alone put a whole cast side by side and the wall read as one show, then
// the next.
export const byFavourites = (a, b) =>
  (b.favourites || 0) - (a.favourites || 0) ||
  (b.appearsIn?.[0]?.popularity || 0) - (a.appearsIn?.[0]?.popularity || 0)

export const charactersWithPages = characters.filter(characterHasPage).sort(byFavourites)

// --- genres -----------------------------------------------------------------
// Every genre that appears in the catalog, with counts, biggest first.
export const genres = (() => {
  const tally = new Map()
  for (const item of [...comics, ...novels, ...anime]) {
    for (const g of item.genres || []) {
      const row = tally.get(g) || { name: g, slug: genreSlug(g), comics: 0, novels: 0, anime: 0 }
      if (item.kind === 'anime') row.anime += 1
      else if (item.kind === 'novel') row.novels += 1
      else row.comics += 1
      tally.set(g, row)
    }
  }
  return [...tally.values()].sort((a, b) => b.comics + b.anime - (a.comics + a.anime))
})()

export function ofGenre(name) {
  return {
    comics: comics.filter((c) => (c.genres || []).includes(name)),
    anime: anime.filter((a) => (a.genres || []).includes(name)),
    novels: novels.filter((n) => (n.genres || []).includes(name)),
  }
}

// --- platform hubs ----------------------------------------------------------
/** How many titles a platform must carry before it earns its own page. */
const HUB_MINIMUM = 12

/**
 * One entry per platform that carries enough titles to be worth a page.
 *
 * These hubs answer a search a title page cannot: "what can I read on WEBTOON",
 * "is Tapas free", "what anime is on HIDIVE". The list, the order and the
 * plain-English cost line are our own work, so the page repeats nothing that
 * AniList publishes.
 *
 * Aliases merge by slug. AniList writes both "MANGA Plus" and "Manga Plus";
 * they are one platform and they get one page.
 */
export const platformHubs = (() => {
  const map = new Map()

  const collect = (items, linkKey, bucket) => {
    for (const item of items) {
      // One title counts once per platform, even when it links four editions.
      const seen = new Set()
      for (const link of item[linkKey] || []) {
        if (!link || !link.site) continue
        const slug = genreSlug(link.site)
        if (!slug || seen.has(slug)) continue
        seen.add(slug)
        let row = map.get(slug)
        if (!row) {
          row = { slug, name: link.site, comics: [], novels: [], anime: [] }
          map.set(slug, row)
        }
        row[bucket].push(item)
      }
    }
  }

  collect(comics, 'readLinks', 'comics')
  collect(novels, 'readLinks', 'novels')
  collect(anime, 'watchLinks', 'anime')

  return [...map.values()]
    .filter((row) => row.comics.length + row.novels.length + row.anime.length >= HUB_MINIMUM)
    .map((row) => ({
      ...row,
      comics: row.comics.sort(byPopularity),
      novels: row.novels.sort(byPopularity),
      anime: row.anime.sort(byPopularity),
      total: row.comics.length + row.novels.length + row.anime.length,
    }))
    .sort((a, b) => b.total - a.total)
})()

/** Quick lookup for the "Where to read" ledger, which links to these pages. */
export const hubSlugOf = (() => {
  const bySlug = new Set(platformHubs.map((row) => row.slug))
  return (site) => {
    const slug = genreSlug(site || '')
    return bySlug.has(slug) ? slug : null
  }
})()
