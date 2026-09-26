#!/usr/bin/env node
/**
 * Cuts the catalog into small JSON shards under public/d/.
 *
 * The Worker renders a title page on request. It cannot carry the whole
 * catalog (26 MB), so it reads one shard through the ASSETS binding and
 * pulls the single record it needs out of it.
 *
 * Each shard is an object of slug -> record, and every record is stored as
 * a STRING of JSON, not as an object. The Worker then parses only the one
 * record it wants. Measured: that is twice as fast as a plain object shard.
 *
 * Run it:
 *   node scripts/make-shards.mjs      (npm run build does this for you)
 */

import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bucket, titleKey, TITLE_SHARDS, CHARACTER_SHARDS, LIST_SHARDS, listBucket } from '../src/lib/shard-key.js'
import { ROW_SITES_MAX, ROW_ADAPT_MAX, ROW_RECS_MAX, coverFileOf } from '../src/lib/list-row.js'
import { reslugAll, leadAppearance } from '../src/lib/reslug.mjs'
import { displayName } from '../src/lib/names.mjs'
import { groupNamesakes, storyName } from '../src/lib/namesakes.mjs'
import { loadRegistry, registryHash, registrySize } from '../src/lib/slug-registry.mjs'
import { dropBlocked, dropBlockedRows } from '../src/lib/blocked.js'
import { sectionOf, SECTIONS } from '../src/lib/section.mjs'
import { PLATFORMS, FALLBACK } from '../src/lib/platforms.js'
import { buildOverview } from '../src/lib/prose.mjs'
import { hasFreePage, hasLikePage, hasCastPage, hasBuyPage, hasCharacterBuyPage } from '../src/lib/gates.mjs'
import { hubSeasonKeys, seasonKeyOf } from '../src/lib/season-core.mjs'
import { indexAiring, attachEpisodes } from '../src/lib/episodes.mjs'
import { indexWhereLinks, attachWhereLinks } from '../src/lib/where-links.mjs'
import { licensedPools, alikeFor } from '../src/lib/alike.mjs'
import { migrateAliasedLinksAll } from '../src/lib/platform-aliases.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'd')

const read = (name) => JSON.parse(readFileSync(join(ROOT, 'data', name), 'utf8'))

/**
 * The MAL score and cross-site links for one title, folded into its record.
 *
 * This file used to be imported by src/lib/format.js, which the Worker loads
 * on every request. That packs it into the Worker CODE, and Cloudflare allows
 * 3 MB of that in total. At 2,610 enriched titles it was 463 KB; at all
 * 107,036 it would break every deploy. Folding it into the shards instead
 * costs the Worker nothing: the record is already being read.
 */
function attachEnrich(titles) {
  let enrich = {}
  try {
    enrich = read('enrich.json')
  } catch {
    // No pull has run yet. Every page still builds, just without the extras.
    console.log('  no data/enrich.json. Building without MAL extras.')
  }
  let hits = 0
  for (const item of titles) {
    const found = enrich[`${item.kind === 'anime' ? 'anime' : 'comic'}:${item.id}`]
    if (!found) continue
    item.extra = found
    hits++
  }
  return hits
}

// A long-running show can have dozens of songs. The page lists the first of
// each kind; the record stays small.
const THEMES_PER_TYPE = 12

/**
 * Opening and ending songs, from data/themes.json (scripts/sync-animethemes.mjs),
 * folded into each anime record. The file is optional: without it every page
 * still builds, just with no song list.
 */
function attachThemes(anime) {
  let byId = {}
  try {
    byId = read('themes.json').byAnilistId || {}
  } catch {
    console.log('  no data/themes.json. Building without song lists.')
  }
  let hits = 0
  for (const item of anime) {
    const rows = byId[String(item.id)]
    if (!Array.isArray(rows) || !rows.length) continue
    const op = rows.filter((r) => r.type === 'OP').slice(0, THEMES_PER_TYPE)
    const ed = rows.filter((r) => r.type === 'ED').slice(0, THEMES_PER_TYPE)
    item.themes = [...op, ...ed]
    hits++
  }
  return hits
}

/**
 * Episode air dates from data/airing.json (scripts/pull-airing.mjs), indexed
 * by AniList id, or null. The file is optional: without it, or with one that
 * is not an airing file, every page still builds, just with no episode list.
 */
function readAiring() {
  if (!existsSync(join(ROOT, 'data', 'airing.json'))) {
    console.log('  no data/airing.json. Building without episode lists.')
    return null
  }
  try {
    const airing = indexAiring(read('airing.json'))
    if (!airing) console.log('  data/airing.json is not an airing file. Building without episode lists.')
    return airing
  } catch (error) {
    console.log(`  data/airing.json is unreadable (${error.message}). Building without episode lists.`)
    return null
  }
}

/**
 * WhereAnime's live pages from data/where-links.json (scripts/pull-where-links.mjs),
 * or null. Optional like airing.json: without it the pages build with no
 * WhereAnime links.
 */
function readWhereLinks() {
  if (!existsSync(join(ROOT, 'data', 'where-links.json'))) {
    console.log('  no data/where-links.json. Building without WhereAnime links.')
    return null
  }
  try {
    const links = indexWhereLinks(read('where-links.json'))
    if (!links) console.log('  data/where-links.json is not a where-links file. Building without WhereAnime links.')
    return links
  } catch (error) {
    console.log(`  data/where-links.json is unreadable (${error.message}). Building without WhereAnime links.`)
    return null
  }
}

/**
 * How often readers opened a platform from each title page over 30 days,
 * from data/handoff.json (written each night by scripts/plan-home.mjs), or
 * null. Optional: without it the "read something like it" picks rank by
 * AniList popularity instead.
 */
function readHandoff() {
  if (!existsSync(join(ROOT, 'data', 'handoff.json'))) {
    console.log('  no data/handoff.json. "Read something like it" ranks by popularity.')
    return null
  }
  try {
    const handoff = read('handoff.json')
    return handoff && handoff.pages && typeof handoff.pages === 'object' ? handoff : null
  } catch (error) {
    console.log(`  data/handoff.json is unreadable (${error.message}). Ranking by popularity.`)
    return null
  }
}

export const kindOf = sectionOf

/** Write one folder of shards. The count is fixed: see shard-key.js. */
function writeShards(dir, records, count, keyOf) {
  const shards = Array.from({ length: count }, () => [])
  for (const record of records) {
    const key = keyOf(record)
    shards[bucket(key, count)].push([key, JSON.stringify(record)])
  }
  mkdirSync(dir, { recursive: true })
  let bytes = 0
  let biggest = 0
  for (let n = 0; n < count; n++) {
    // One record per line, "key<TAB>json". The Worker finds its line with a
    // plain string search and parses that one record. It never parses the
    // whole shard, so a big shard costs no more than a small one.
    let text = '\n'
    for (const [key, json] of shards[n]) text += `${key}\t${json}\n`
    writeFileSync(join(dir, `${n}.txt`), text)
    bytes += text.length
    biggest = Math.max(biggest, shards[n].length)
  }
  return { count, bytes, biggest }
}

/**
 * Just enough of a title to draw a cover card, and nothing more. The AniList
 * id rides along so the "My list" button on a title page can name the picks
 * next to it as related titles, which the For you feed then ranks higher.
 */
const thin = (p) => ({
  id: p.id,
  slug: p.slug,
  title: p.title,
  cover: p.cover,
  kind: p.kind,
  country: p.country,
  status: p.status,
  readLinks: (p.readLinks || []).slice(0, 6).map((l) => ({ site: l.site })),
  watchLinks: (p.watchLinks || []).slice(0, 6).map((l) => ({ site: l.site })),
})

/**
 * The title page shows "you may also like" and a family tree of prequels and
 * sequels. Both need the whole catalog, which the Worker does not have. So
 * both are worked out here, once, and stored inside the record.
 */
/**
 * How many titles per genre are kept as candidates for "you may also like".
 *
 * This cap is what keeps the build finite. The old code compared every title
 * against every other title of the same kind. At 2,499 comics that was about
 * 5 million steps and took seconds. At 107,036 titles it is about 4 billion
 * steps, and one build ran for 57 minutes without finishing.
 *
 * The candidates are the most popular titles in each genre, so the six picks
 * that survive are the same ones a reader would recognise anyway.
 */
const POOL_PER_GENRE = 300

function precompute(titles, handoff = null) {
  const byId = new Map(titles.map((item) => [item.id, item]))
  // Licensed titles by genre, for pages with no English platform. Built once
  // here, not per title. See src/lib/alike.mjs.
  const licensed = licensedPools(titles)
  // Only the English platforms ride along with each pick, so the marks under
  // its cover are the ones this reader can actually use.
  const alikeThin = (p) => ({
    ...thin(p),
    readLinks: (p.readLinks || []).filter((l) => l.language === 'English').slice(0, 6).map((l) => ({ site: l.site })),
  })
  let alikeCount = 0
  // id -> the ids of the reader picks we also hold, best first. The title
  // record drops recIds below, but the "My list" rows still want them.
  const recsInIndex = new Map()

  const pools = new Map()
  for (const item of titles) {
    const key = kindOf(item)
    if (!pools.has(key)) pools.set(key, [])
    pools.get(key).push(item)
  }
  for (const list of pools.values()) list.sort((a, b) => b.popularity - a.popularity)

  // "kind|genre" -> the most popular titles carrying that genre.
  // Each pool is already popularity-sorted, so taking the first
  // POOL_PER_GENRE of it needs no second sort.
  const byGenre = new Map()
  for (const [kind, list] of pools) {
    for (const item of list) {
      for (const genre of item.genres || []) {
        const key = `${kind}|${genre}`
        let bucketList = byGenre.get(key)
        if (!bucketList) {
          bucketList = []
          byGenre.set(key, bucketList)
        }
        if (bucketList.length < POOL_PER_GENRE) bucketList.push(item)
      }
    }
  }

  for (const item of titles) {
    const kind = kindOf(item)
    // candidate -> the genres it shares with this title. Only titles that
    // share at least one genre are ever looked at, instead of all of them.
    const sharedBy = new Map()
    for (const genre of item.genres || []) {
      for (const candidate of byGenre.get(`${kind}|${genre}`) || []) {
        if (candidate.id === item.id) continue
        let list = sharedBy.get(candidate)
        if (!list) {
          list = []
          sharedBy.set(candidate, list)
        }
        list.push(genre)
      }
    }

    item.similar = [...sharedBy]
      .filter(([, shared]) => shared.length >= 2)
      .sort((a, b) => b[1].length - a[1].length || b[0].popularity - a[0].popularity)
      .slice(0, 6)
      // The "like" page has to say WHY each pick belongs, so the shared
      // genres travel with the pick instead of being worked out again.
      .map(([p, shared]) => ({ ...thin(p), shared: shared.slice(0, 3) }))

    // What real readers picked next, from AniList. This is a human vote, so it
    // beats the genre match above, and every pick that survives is a real
    // internal link to a page we hold. Anything we do not hold is dropped:
    // a link to nothing helps nobody.
    const recHits = (item.recIds || [])
      .map(({ id }) => byId.get(id))
      .filter((p) => p && p.id !== item.id && p.cover)
    item.recs = recHits.slice(0, 6).map(thin)

    // A page with no English platform offers licensed titles like it, so a
    // reader who came from Google has a legal next step.
    const alike = alikeFor(item, licensed, { handoff, thin: alikeThin })
    if (alike.length) {
      item.alike = alike
      alikeCount++
    }
    recsInIndex.set(item.id, recHits.slice(0, ROW_RECS_MAX).map((p) => p.id))
    delete item.recIds

    for (const rel of item.relations || []) {
      const found = byId.get(rel.id)
      rel.hit = found
        ? { kind: found.kind, item: { slug: found.slug, country: found.country, kind: found.kind } }
        : null
    }

    // Computed facts. Both need the whole catalog, so they are worked out
    // here and travel inside the record. See src/lib/computed.mjs.
    item.chain = readingChain(item, byId)
    item.adapt = adaptationOf(item, byId)
  }

  console.log(`  "read something like it" picks on ${alikeCount} unlicensed pages${handoff ? ', ranked by hand-off' : ''}`)

  // The original overview. It is written here, on every build, so a title
  // added tomorrow gets its own prose tomorrow with no extra step.
  writeOverviews(titles, pools)
  return { byId, recsInIndex }
}

/** The same medium? A comic sequel is a comic, an anime sequel is an anime. */
const sameMedium = (a, b) => (a.kind === 'anime') === (b.kind === 'anime')

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
function readingChain(item, byId) {
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

const ADAPT_RELATIONS = new Set(['ADAPTATION', 'SOURCE'])

/**
 * How the anime and the comic line up. For a comic this is every anime made
 * from it; for an anime it is the book it came from. Only titles that are in
 * our own index are used, because we only ever link to a page we hold.
 */
function adaptationOf(item, byId) {
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
    },
  }
}

const noteOf = (site) => (PLATFORMS[site] || FALLBACK).note

/**
 * Works out where a title stands against its own group, then hands the facts
 * to the prose writer. The rank needs the whole catalog, so it cannot be done
 * in the Worker.
 */
function writeOverviews(titles, pools) {
  const rankOf = new Map()
  for (const [group, list] of pools) {
    const scored = list.filter((p) => p.score).sort((a, b) => b.score - a.score)
    const label = group === 'anime' ? 'anime' : group
    scored.forEach((item, i) => {
      rankOf.set(item.id, { top: Math.max(1, Math.round(((i + 1) / scored.length) * 100)), label })
    })
  }
  for (const item of titles) {
    item.overview = buildOverview(item, kindOf(item), noteOf, rankOf.get(item.id) || null)
  }
}

/**
 * "Other characters named Luna" on every Luna's page. Ten characters can share
 * one name, and a reader who searched it may have landed on the wrong one; the
 * list is the way across, and a real internal link to each namesake. It needs
 * every character page at once, which the Worker never has, so it is worked
 * out here and stored in the record, like `similar` for titles. The rules
 * (how names match, who comes first, when a page counts as the less-known
 * one) live in src/lib/namesakes.mjs, where the tests can reach them.
 *
 * Stored only when there is someone to list, so a unique name costs the shard
 * nothing. `namesakesHigh` is stored only when true, for the same reason.
 */
// The list shows a 46px face, and AniList's medium character image is a
// quarter of the large one's bytes. Only the folder differs; checked 23 Sep
// 2026 on a random sample and on default.jpg.
const smallFace = (url) => String(url || '').replace('/character/large/', '/character/medium/')

function attachNamesakes(pages) {
  const lists = groupNamesakes(pages, {
    nameOf: (person) => displayName(person).primary,
    cardOf: (person, name) => ({
      slug: person.slug,
      name,
      series: storyName(leadAppearance(person)?.title),
      image: smallFace(person.image),
    }),
  })
  let high = 0
  for (const person of pages) {
    const found = lists.get(person.slug)
    if (!found?.namesakes.length) continue
    person.namesakes = found.namesakes
    if (found.lessKnown) {
      person.namesakesHigh = true
      high++
    }
  }
  return { linked: lists.size, high }
}

/*
 * "My list" rows and the "For you" pool.
 *
 * A reader's list lives in their own browser (src/lib/my-list.js). To show a
 * saved title's platforms, its next episode or whether it has finished, the
 * page needs a few live facts about it, and it cannot load the catalog. So
 * each title gets one short row, filed by AniList id into LIST_SHARDS small
 * files. A list page loads only the files its own titles live in.
 *
 * The For you block needs something to recommend FROM. That is one pool
 * file: the most popular titles of every section, with their genres and
 * tags as numbers. Only a reader who has a list ever downloads it.
 *
 * Both are plain static files. Cloudflare serves them without running the
 * Worker, so they cost no Worker requests and no CPU at all.
 */
const FEED_PER_SECTION = 400
const FEED_TOP_TAGS = 150
const FEED_GENRES_PER_TITLE = 4
const FEED_TAGS_PER_TITLE = 6
const FEED_REL_PER_TITLE = 6
const FEED_AIRING_DAYS = 14

const unique = (list) => [...new Set(list)]

/** The official platforms a row names: read links for a comic, watch links for an anime. */
const sitesOf = (item) =>
  unique(((item.kind === 'anime' ? item.watchLinks : item.readLinks) || []).map((l) => l.site))
    .filter(Boolean)
    .slice(0, ROW_SITES_MAX)

/** The anime made from a comic, or the comic behind an anime, as ids we hold. */
const adaptIdsOf = (item, byId) =>
  unique(
    (item.relations || [])
      .filter((rel) => ADAPT_RELATIONS.has(rel.relation))
      .map((rel) => byId.get(rel.id))
      .filter((found) => found && !sameMedium(item, found))
      .map((found) => found.id)
  )

/** One row; the positions are fixed in src/lib/list-row.js. */
function listRowOf(item, byId, recsInIndex, nowSec) {
  const isAnime = item.kind === 'anime'
  const adapt = adaptIdsOf(item, byId)
  // An episode time already in the past is stale data, not a countdown.
  const next = item.nextEpisode && item.nextEpisode.at > nowSec ? item.nextEpisode : null
  return [
    kindOf(item),
    item.slug,
    item.status || '',
    next ? next.at : 0,
    next ? next.number || 0 : 0,
    (isAnime ? item.episodes : item.chapters) || 0,
    sitesOf(item),
    item.popularity || 0,
    isAnime ? adapt[0] || 0 : 0,
    isAnime ? [] : adapt.slice(0, ROW_ADAPT_MAX),
    recsInIndex.get(item.id) || [],
  ]
}

function writeListShards(dir, titles, byId, recsInIndex, nowSec) {
  const shards = Array.from({ length: LIST_SHARDS }, () => ({}))
  for (const item of titles) {
    shards[listBucket(item.id)][item.id] = listRowOf(item, byId, recsInIndex, nowSec)
  }
  mkdirSync(dir, { recursive: true })
  let bytes = 0
  let biggest = 0
  for (let n = 0; n < LIST_SHARDS; n++) {
    const text = JSON.stringify(shards[n])
    writeFileSync(join(dir, `${n}.json`), text)
    bytes += text.length
    biggest = Math.max(biggest, text.length)
  }
  return { count: LIST_SHARDS, bytes, biggest }
}

/** Names most used first, so the commonest genre and tag get the smallest numbers. */
function tallyNames(titles, field) {
  const tally = new Map()
  for (const item of titles) {
    for (const name of item[field] || []) tally.set(name, (tally.get(name) || 0) + 1)
  }
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([name]) => name)
}

function writeFeedPool(file, titles, byId, recsInIndex, nowSec) {
  const genres = tallyNames(titles, 'genres')
  const tags = tallyNames(titles, 'tags').slice(0, FEED_TOP_TAGS)
  const genreAt = new Map(genres.map((name, i) => [name, i]))
  const tagAt = new Map(tags.map((name, i) => [name, i]))

  const bySection = new Map(SECTIONS.map((ns) => [ns, []]))
  for (const item of titles) {
    if (!item.cover) continue
    bySection.get(kindOf(item))?.push(item)
  }

  const items = []
  for (const [ns, list] of bySection) {
    list.sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
    for (const item of list.slice(0, FEED_PER_SECTION)) {
      items.push([
        item.id,
        SECTIONS.indexOf(ns),
        item.slug,
        item.title,
        coverFileOf(item.cover),
        item.score || 0,
        item.popularity || 0,
        (item.genres || []).filter((g) => genreAt.has(g)).slice(0, FEED_GENRES_PER_TITLE).map((g) => genreAt.get(g)),
        (item.tags || []).filter((t) => tagAt.has(t)).slice(0, FEED_TAGS_PER_TITLE).map((t) => tagAt.get(t)),
        unique([...adaptIdsOf(item, byId), ...(recsInIndex.get(item.id) || [])]).slice(0, FEED_REL_PER_TITLE),
      ])
    }
  }

  // Every anime with an episode due in the next two weeks. The homepage
  // crosses this with the reader's list for "Your list this week", so it
  // never has to load the list rows just to say what airs soon.
  const horizon = nowSec + FEED_AIRING_DAYS * 86400
  const airing = titles
    .filter((item) => item.kind === 'anime' && item.nextEpisode)
    .filter((item) => item.nextEpisode.at > nowSec && item.nextEpisode.at <= horizon)
    .sort((a, b) => a.nextEpisode.at - b.nextEpisode.at)
    .map((item) => [item.id, item.nextEpisode.at, item.nextEpisode.number || 0])

  const text = JSON.stringify({ v: 1, builtAt: nowSec, sections: SECTIONS, genres, tags, items, airing })
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
  return { items: items.length, airing: airing.length, bytes: text.length }
}

// Phase timings. A build that crawls must say WHERE it crawls: one run of
// this script took 57 minutes and printed nothing at all until it was killed.
let mark = Date.now()
const since = (label) => {
  console.log(`  ${label}: ${((Date.now() - mark) / 1000).toFixed(1)}s`)
  mark = Date.now()
}

/**
 * Refuse to build a site smaller than the one that is live.
 *
 * The catalog only ever grows: the daily job adds and refreshes, it never
 * deletes. So a smaller count means data was lost on the way in, and shipping
 * it would turn thousands of indexed pages into 404s at once. This happened
 * once from the seed copy standing in for a lost cache. Now the build stops
 * and the last good deploy stays up. ALLOW_SHRINK=1 overrides it on purpose.
 */
const SHRINK_LIMIT = 0.02
const LIVE_MANIFEST = 'https://manhwaindex.com/d/manifest.json'
// The deploy job saves the manifest of the last site it shipped here, in its
// own Actions cache entry. It is the source of truth on GitHub: Bot Fight
// Mode challenges a fetch of the live URL from a runner, so that only works
// from a normal machine.
const LIVE_MANIFEST_FILE = join(ROOT, 'data', 'live-manifest.json')

/** The manifest of the site that is live now: the saved file first, then the URL. */
async function readLiveManifest() {
  if (existsSync(LIVE_MANIFEST_FILE)) {
    try {
      return JSON.parse(readFileSync(LIVE_MANIFEST_FILE, 'utf8'))
    } catch (e) {
      console.log(`  saved live manifest unreadable (${e.message})`)
    }
  }
  try {
    const res = await fetch(`${LIVE_MANIFEST}?t=${Date.now()}`, {
      headers: { 'user-agent': 'manhwaindex-build' },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (e) {
    console.log(`  live manifest not fetched (${e.message})`)
    return null
  }
}

async function guardAgainstShrink(manifest) {
  if (process.env.ALLOW_SHRINK) {
    console.log('  ALLOW_SHRINK is set: the shrink guard is off for this build.')
    return
  }
  const live = await readLiveManifest()
  if (!live) {
    console.log('  no live manifest to compare against; shrink guard skipped')
    return
  }
  const checks = [
    ['titles', manifest.titles, live.titles],
    ['character pages', manifest.characterPages, live.characterPages],
  ]
  for (const [label, now, before] of checks) {
    if (!before || now >= before * (1 - SHRINK_LIMIT)) continue
    console.error(`SHRINK GUARD: ${label} fell from ${before} live to ${now} in this build.`)
    console.error('Pages that exist today would 404 tomorrow. Refusing to build.')
    console.error('If the drop is intended, run again with ALLOW_SHRINK=1.')
    process.exit(1)
  }
  console.log(`  shrink guard ok: titles ${live.titles} -> ${manifest.titles}, character pages ${live.characterPages} -> ${manifest.characterPages}`)
}

async function main() {
  // A blocked title never reaches a shard, so the Worker answers 404 for it.
  const comics = dropBlockedRows(dropBlocked(read('comics.json')))
  let anime = dropBlockedRows(dropBlocked(read('anime.json')))
  let characters = read('characters.json')
  // See src/lib/platform-aliases.mjs: a record ingested before its site name
  // was recognised (e.g. "Kodansha USA") keeps the raw name in otherLinks
  // forever, since the ingest never refetches an unchanged record.
  migrateAliasedLinksAll(comics)
  since('read json')
  // Slugs come from the registry make-redirects.mjs just saved. Frozen: a page
  // it did not register is an error here, never a fresh slug of our own.
  // Under REGISTRY_READONLY=1 nothing was saved, so the new pages are worked
  // out again in memory from the same inputs and come out the same.
  const registry = loadRegistry()
  const frozen = !!registry && process.env.REGISTRY_READONLY !== '1'
  reslugAll(comics, anime, characters, { registry, frozen })
  since('reslug')

  const titlesWithExtras = attachEnrich([...comics, ...anime])
  const animeWithThemes = attachThemes(anime)
  const episodes = attachEpisodes(anime, readAiring())
  anime = episodes.anime
  // After reslug: the character rows must already carry their final slugs.
  const where = attachWhereLinks(anime, characters, readWhereLinks())
  anime = where.anime
  characters = where.characters
  since('enrich')

  rmSync(OUT, { recursive: true, force: true })

  // The title page links "Aired: Fall 2025" to that season's hub, but the
  // Worker has no catalog to know whether the hub was built. The same rule the
  // hub builder uses (src/lib/season-core.mjs) marks the anime that have one.
  const hubKeys = hubSeasonKeys(anime)
  for (const item of anime) {
    if (hubKeys.has(seasonKeyOf(item))) item.seasonHub = true
  }

  const titles = [...comics, ...anime]
  const { byId, recsInIndex } = precompute(titles, readHandoff())
  since('precompute')
  const t = writeShards(join(OUT, 't'), titles, TITLE_SHARDS, (item) =>
    titleKey(kindOf(item), item.slug))
  since('title shards')

  const nowSec = Math.floor(Date.now() / 1000)
  const l = writeListShards(join(OUT, 'l'), titles, byId, recsInIndex, nowSec)
  const feed = writeFeedPool(join(OUT, 'feed.v1.json'), titles, byId, recsInIndex, nowSec)
  since('list rows and feed pool')

  // Only characters that earn a page are sharded. The rest are never served.
  const pages = characters.filter((c) => c.image && (c.appearsIn || []).length > 0)
  const namesakes = attachNamesakes(pages)
  console.log(`  namesakes listed on ${namesakes.linked} of ${pages.length} character pages, near the top on ${namesakes.high}`)
  const c = writeShards(join(OUT, 'c'), pages, CHARACTER_SHARDS, (person) => person.slug)

  // The site shell (header and footer) shows two counts and the top genres.
  // The Worker renders the shell on every page, so those few numbers are
  // written to their own tiny file instead of loading the whole catalog.
  const tally = new Map()
  for (const item of titles) {
    for (const g of item.genres || []) tally.set(g, (tally.get(g) || 0) + 1)
  }
  const topGenres = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name]) => ({ name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') }))
  writeFileSync(
    join(ROOT, 'data', 'site-stats.json'),
    JSON.stringify({ comics: comics.length, anime: anime.length, genres: topGenres }, null, 2),
  )

  // Which titles have earned an answer page. A page that cannot answer its
  // own question is a thin page, so the gates are strict and the sitemap
  // only ever lists what passed them. The gates live in src/lib/gates.mjs,
  // and each answer page runs the same gate and answers 404 when it fails,
  // so the sitemap and the Worker can never disagree.
  const answerUrls = { free: [], like: [], buy: [], charBuy: [], cast: [] }
  for (const item of titles) {
    const path = `/${kindOf(item)}/${item.slug}`
    if (hasFreePage(item)) answerUrls.free.push(`${path}/free`)
    if (hasLikePage(item)) answerUrls.like.push(`${path}/like`)
    if (hasCastPage(item)) answerUrls.cast.push(`${path}/characters`)
    if (hasBuyPage(item)) answerUrls.buy.push(`${path}/buy`)
  }
  for (const person of pages) {
    if (hasCharacterBuyPage(person)) answerUrls.charBuy.push(`/character/${person.slug}/buy`)
  }

  writeFileSync(join(ROOT, 'data', 'answer-urls.json'), JSON.stringify(answerUrls))

  const manifest = {
    titleShards: t.count,
    characterShards: c.count,
    titles: titles.length,
    characterPages: pages.length,
    builtAt: Date.now(),
    // Which slug registry this site was built from. scripts/slug-registry.mjs
    // reads it from the saved live manifest: a live site that shipped with a
    // registry, followed by a run that has none, means the registry was lost.
    ...(registry ? { slugs: { entries: registrySize(registry), hash: registryHash(registry) } } : {}),
  }
  await guardAgainstShrink(manifest)
  writeFileSync(join(ROOT, 'data', 'shards.json'), JSON.stringify(manifest, null, 2))
  // The same manifest is published with the site, so the next build can read
  // what is live and refuse to ship a smaller site.
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest))

  const mb = (n) => `${(n / 1048576).toFixed(1)} MB`
  console.log(`titles     ${titles.length} in ${t.count} shards, ${mb(t.bytes)}, biggest ${t.biggest} records`)
  console.log(`MAL extras folded into ${titlesWithExtras} of ${titles.length} records`)
  console.log(`song lists folded into ${animeWithThemes} of ${anime.length} anime`)
  console.log(`episode lists folded into ${episodes.count} of ${anime.length} anime`)
  console.log(`WhereAnime links on ${where.titles} anime and ${where.voices} character voice rows`)
  console.log(`characters ${pages.length} in ${c.count} shards, ${mb(c.bytes)}, biggest ${c.biggest} records`)
  console.log(`list rows  ${titles.length} in ${l.count} shards, ${mb(l.bytes)}, biggest ${(l.biggest / 1024).toFixed(0)} KB`)
  console.log(`feed pool  ${feed.items} titles, ${feed.airing} airing, ${(feed.bytes / 1024).toFixed(0)} KB`)
  console.log(`shard files ${t.count + c.count + l.count + 1}  (the free plan allows 20,000 files in total)`)
  console.log(`answer pages ${answerUrls.free.length} free, ${answerUrls.like.length} like, ${answerUrls.buy.length} buy, ${answerUrls.charBuy.length} character buy, ${answerUrls.cast.length} cast`)
}

main().catch((e) => {
  console.error('MAKE SHARDS FAILED:', e)
  process.exit(1)
})
