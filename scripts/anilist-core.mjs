#!/usr/bin/env node
/**
 * Shared AniList plumbing for manhwaindex.com.
 *
 * Two entry points use this:
 *   scripts/ingest-full.mjs   one-time walk of the whole AniList id space
 *   scripts/ingest-daily.mjs  small daily refresh, runs in GitHub Actions
 *
 * AniList facts this file is built around:
 *   - rate limit is 30 requests per minute
 *   - pageInfo.total is clamped at 5000, so it cannot be trusted
 *   - deep pagination dies past 5000 entries ("Page depth exceeds maximum")
 *   - there is no id cursor (id_greater does not exist)
 *   - id_in accepts 50 ids per call, so that is how we walk everything
 */

import { mkdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BLOCKED_MEDIA, dropBlocked, dropBlockedRows } from '../src/lib/blocked.js'
import { slugify } from '../src/lib/slugify.mjs'
import { writeFileAtomic, writeJsonAtomic } from '../src/lib/write-atomic.mjs'
import { canonicalSite } from '../src/lib/platform-aliases.mjs'

// Every catalog write goes through a temporary file and a rename, so a run
// killed mid-write leaves the last whole file, never a torn one. The helpers
// live in src/lib so the slug registry can use them too; they are re-exported
// here for the ingest scripts. slugify moved the same way (reslug.mjs needs it).
export { slugify, writeFileAtomic, writeJsonAtomic }

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const DATA_DIR = join(ROOT, 'data')
export const RAW_DIR = join(DATA_DIR, 'raw')

const API = 'https://graphql.anilist.co'
/** 30 requests per minute is the ceiling. 2.2s per call leaves headroom. */
export const REQUEST_DELAY_MS = 2200
export const IDS_PER_CALL = 50
const MAX_RETRIES = 12

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Staff rows asked for per title. The first four still make the author list,
 * exactly as before; the rest are there so an anime can name its director,
 * writer, designer and composer. See staffOf.
 *
 * AniList's RELEVANCE order is the credit order, and Music sits around row
 * 13-20, so twelve rows missed it. 25 is the most AniList returns here (50
 * came back byte for byte the same, tested 23 Sep 2026). A few long credit
 * lists (Attack on Titan) still put Music past row 25; those pages go without.
 */
const STAFF_PER_TITLE = 25
const AUTHOR_STAFF = 4

/**
 * The anime credits a page names, in the order it names them. AniList role
 * strings carry suffixes ("Director (eps 1-12)"), so the suffix is cut off
 * before the match. "Episode Director" and "Assistant Director" do not match.
 */
const STAFF_ROLES = [
  'Original Creator', 'Original Story', 'Director', 'Series Composition',
  'Character Design', 'Chief Animation Director', 'Music',
]
const STAFF_MAX = 8
// Three composers is a real credit; a fourth would crowd the list.
const STAFF_PER_ROLE = 3
const roleKey = (role) => String(role || '').replace(/\s*\(.*$/, '').trim().toLowerCase()
const STAFF_ROLE_BY_KEY = new Map(STAFF_ROLES.map((role) => [role.toLowerCase(), role]))

/** [{ role, name }] for the credits above, deduped, at most STAFF_MAX. */
export function staffOf(edges) {
  const rows = []
  const seen = new Set()
  const perRole = new Map()
  for (const e of edges || []) {
    const role = STAFF_ROLE_BY_KEY.get(roleKey(e.role))
    const name = e.node?.name?.full
    if (!role || !name || seen.has(`${role}|${name}`)) continue
    if ((perRole.get(role) || 0) >= STAFF_PER_ROLE) continue
    seen.add(`${role}|${name}`)
    perRole.set(role, (perRole.get(role) || 0) + 1)
    rows.push({ role, name })
  }
  const order = (row) => STAFF_ROLES.indexOf(row.role)
  return rows.sort((a, b) => order(a) - order(b)).slice(0, STAFF_MAX)
}

/**
 * The cast's voices, every language in one list. AniList cannot be asked for
 * voiceActors twice with an alias (JAPANESE and ENGLISH): tested 23 Sep 2026,
 * both copies came back with the English names, so the Japanese credit turned
 * into the English one. One unfiltered list, split here, is the safe way.
 */
export const VOICE_ROLES = `voiceActorRoles(sort: [RELEVANCE]) { voiceActor { name { full } languageV2 } }`

/** The first voice AniList lists in one language ('Japanese', 'English'), or null. */
export const voiceIn = (roles, language) =>
  (roles || []).find((r) => r.voiceActor?.languageV2 === language)?.voiceActor?.name?.full || null

export const MEDIA_FIELDS = `
  id idMal siteUrl type format status countryOfOrigin updatedAt source(version: 3)
  rankings { rank type allTime year context }
  stats { statusDistribution { status amount } }
  recommendations(perPage: 8, sort: RATING_DESC) {
    nodes { rating mediaRecommendation { id type title { romaji english } } }
  }
  title { romaji english native }
  synonyms
  description(asHtml: false)
  startDate { year month day }
  endDate { year }
  chapters volumes episodes duration season seasonYear
  genres
  averageScore meanScore popularity favourites
  isAdult
  coverImage { extraLarge large color }
  bannerImage
  tags { name rank isMediaSpoiler isAdult }
  externalLinks { site url type language icon color }
  trailer { id site thumbnail }
  nextAiringEpisode { airingAt episode }
  studios(isMain: true) { nodes { name } }
  staff(perPage: ${STAFF_PER_TITLE}, sort: [RELEVANCE]) { edges { role node { name { full } } } }
  streamingEpisodes { title url site }
  relations { edges { relationType node { id type format countryOfOrigin title { romaji english } } } }
  characters(perPage: 10, sort: [ROLE, RELEVANCE]) { edges { role ${VOICE_ROLES} node { id name { full native alternative } image { large } description(asHtml: false) gender age bloodType favourites dateOfBirth { month day } } } }
`

/** Walk the id space. This is the only way to reach every title. */
export const BY_IDS_QUERY = `query ($ids: [Int]) {
  Page(page: 1, perPage: ${IDS_PER_CALL}) {
    media(id_in: $ids, isAdult: false) {
      ${MEDIA_FIELDS}
    }
  }
}`

/** Walk the id space for light and web novels only (the one-time novel fetch). */
export const NOVELS_BY_IDS_QUERY = `query ($ids: [Int]) {
  Page(page: 1, perPage: ${IDS_PER_CALL}) {
    media(id_in: $ids, type: MANGA, format: NOVEL, isAdult: false) {
      ${MEDIA_FIELDS}
    }
  }
}`

/** Newest edits first. The daily job stops as soon as it sees old rows. */
export const RECENT_QUERY = `query ($page: Int, $type: MediaType) {
  Page(page: $page, perPage: ${IDS_PER_CALL}) {
    pageInfo { hasNextPage }
    media(type: $type, isAdult: false, sort: UPDATED_AT_DESC) {
      ${MEDIA_FIELDS}
    }
  }
}`

/** Newest ids first. Catches titles added since the last run. */
export const NEWEST_QUERY = `query ($page: Int, $type: MediaType) {
  Page(page: $page, perPage: ${IDS_PER_CALL}) {
    pageInfo { hasNextPage }
    media(type: $type, isAdult: false, sort: ID_DESC) {
      ${MEDIA_FIELDS}
    }
  }
}`

/**
 * CHEAP PROBES. These ask for two fields, not the whole record.
 * We use them to find out WHAT changed before we pay to fetch it.
 */
export const PROBE_RECENT_QUERY = `query ($page: Int, $type: MediaType) {
  Page(page: $page, perPage: ${IDS_PER_CALL}) {
    pageInfo { hasNextPage }
    media(type: $type, isAdult: false, sort: UPDATED_AT_DESC) { id updatedAt }
  }
}`

export const PROBE_NEW_QUERY = `query ($page: Int, $type: MediaType) {
  Page(page: $page, perPage: ${IDS_PER_CALL}) {
    pageInfo { hasNextPage }
    media(type: $type, isAdult: false, sort: ID_DESC) { id updatedAt }
  }
}`

/** Highest id that exists right now, per media type. */
export const MAX_ID_QUERY = `query ($type: MediaType) {
  Page(page: 1, perPage: 1) { media(type: $type, sort: ID_DESC) { id } }
}`

export const CHARACTERS = new Map()
// slug -> the "appears in" rows a character held in the last catalog on disk.
// AniList only sends a title's top ten cast, and that order moves from day to
// day. Rebuilt from scratch, a character who fell out of every top ten lost
// every row, failed the page gate, and a Google-indexed URL turned into a
// real 404. These rows are merged back in by assembleAndWrite, so a page that
// exists today still exists tomorrow for as long as its title does.
export const PRIOR_ROWS = new Map()


export async function gql(query, variables, attempt = 1) {
  let res
  try {
    res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(60_000),
    })
  } catch (error) {
    // A dropped socket or DNS blip must not end a two-hour run.
    if (attempt > MAX_RETRIES) throw error
    const wait = Math.min(15 * attempt, 90)
    console.warn(`  network error (${error.message}). retrying in ${wait}s (attempt ${attempt})`)
    await sleep(wait * 1000)
    return gql(query, variables, attempt + 1)
  }

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after') || 60)
    if (attempt > MAX_RETRIES) throw new Error('rate limited, gave up')
    console.warn(`  429 rate limited. waiting ${retryAfter}s (attempt ${attempt})`)
    await sleep((retryAfter + 2) * 1000)
    return gql(query, variables, attempt + 1)
  }

  if (!res.ok) {
    if (attempt > MAX_RETRIES) throw new Error(`HTTP ${res.status} after ${MAX_RETRIES} tries`)
    console.warn(`  HTTP ${res.status}, retrying in 15s (attempt ${attempt})`)
    await sleep(15_000)
    return gql(query, variables, attempt + 1)
  }

  let body
  try {
    body = await res.json()
  } catch (error) {
    if (attempt > MAX_RETRIES) throw error
    console.warn(`  bad body (${error.message}). retrying in 15s (attempt ${attempt})`)
    await sleep(15_000)
    return gql(query, variables, attempt + 1)
  }
  if (body.errors) {
    const text = JSON.stringify(body.errors).slice(0, 300)
    // A GraphQL error is usually AniList itself having a bad minute, not a bad
    // query. We ask again with a growing wait before we let the run die.
    if (attempt > MAX_RETRIES) throw new Error(`GraphQL: ${text}`)
    const wait = Math.min(10 * attempt, 60)
    console.warn(`  GraphQL error (${text}). retrying in ${wait}s (attempt ${attempt})`)
    await sleep(wait * 1000)
    return gql(query, variables, attempt + 1)
  }
  return body.data
}

/** AniList site names we treat as an official place to read. */
const READ_PLATFORMS = [
  'WEBTOON', 'Naver Webtoon', 'Naver Series', 'Kakao Webtoon', 'KakaoPage',
  'Tapas', 'Tappytoon', 'Lezhin', 'Piccoma', 'Manta', 'Comikey', 'INKR',
  'MANGA Plus', 'Manga Plus', 'VIZ', 'Yen Press', 'Seven Seas Entertainment',
  'Kodansha', 'Azuki', 'Coolmic', 'WebComics', 'Bomtoon', 'Lalatoon',
  'Toomics', 'Webnovel', 'Pocket Comics', 'NETCOMICS', 'Bilibili Comics',
  'KuaiKan Manhua', 'Tencent Comics', 'Dongman Manhua', 'ONO',
  // Light and web novels.
  'BookWalker', 'BOOK WALKER', 'J-Novel Club', 'Kobo', 'Ridibooks', 'Munpia',
  'Kakao Page', 'Syosetu', 'Kadokawa', 'Cross Infinite World', 'Amazon Kindle',
]

const isReadLink = (link) =>
  READ_PLATFORMS.some((p) => canonicalSite(link.site || '').toLowerCase() === p.toLowerCase())

const isWatchLink = (link) => link.type === 'STREAMING'

// Bios end on a full sentence, never mid-word. Spoiler blocks ~!...!~ are
// dropped whole, so a cut never lands inside one and leaks it.
const BIO_MAX = 1500
export function cutBio(text) {
  const clean = text.replace(/~![\s\S]*?!~/g, '').trim()
  if (clean.length <= BIO_MAX) return clean
  const head = clean.slice(0, BIO_MAX)
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('.\n'), head.lastIndexOf('\n\n'))
  return (end > 200 ? head.slice(0, end + 1) : head).trim()
}

/** 'anime', 'novel' (a light or web novel) or 'comic'. */
export const kindOfMedia = (media) =>
  media.type === 'ANIME' ? 'anime' : media.format === 'NOVEL' ? 'novel' : 'comic'

export function shape(media, kind = kindOfMedia(media)) {
  const title = media.title.english || media.title.romaji || media.title.native
  const links = media.externalLinks || []
  const relations = (media.relations?.edges || []).map((e) => ({
    relation: e.relationType,
    id: e.node.id,
    type: e.node.type,
    format: e.node.format,
    country: e.node.countryOfOrigin,
    title: e.node.title.english || e.node.title.romaji,
  }))
  const staff = kind === 'anime' ? staffOf(media.staff?.edges) : []

  return {
    kind, // 'comic' | 'novel' | 'anime'
    id: media.id,
    malId: media.idMal,
    slug: `${slugify(title)}-${media.id}`,
    title,
    titleRomaji: media.title.romaji,
    titleNative: media.title.native,
    synonyms: media.synonyms || [],
    format: media.format,
    status: media.status,
    country: media.countryOfOrigin,
    updatedAt: media.updatedAt ?? null,
    // What the story was made from: a light novel, a game, an original work.
    source: media.source ?? null,
    // AniList's own charts. "#2 most popular manhwa of all time" is a fact a
    // reader cares about and nothing else on the page says.
    ranks: (media.rankings || [])
      .filter((r) => r.rank <= 500)
      .slice(0, 4)
      .map((r) => ({ rank: r.rank, type: r.type, allTime: !!r.allTime, year: r.year ?? null, context: r.context })),
    // How many people are reading it, finished it, or gave up on it.
    readers: Object.fromEntries(
      (media.stats?.statusDistribution || []).map((s) => [s.status.toLowerCase(), s.amount])
    ),
    // "If you liked this, try that." Ids only here; make-shards.mjs throws
    // away the ones we do not hold a page for and swaps the rest for slugs.
    recIds: (media.recommendations?.nodes || [])
      .filter((n) => n.mediaRecommendation?.id)
      .slice(0, 8)
      .map((n) => ({ id: n.mediaRecommendation.id, rating: n.rating || 0 })),
    description: (media.description || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim(),
    startYear: media.startDate?.year ?? null,
    startDate: media.startDate?.year ? [media.startDate.year, media.startDate.month || 1, media.startDate.day || 1] : null,
    // How much of startDate is real. AniList leaves an unknown month or day
    // empty and the line above stores a 1 there, so without this "January
    // 2027" reads as "1 January 2027". Readers: startPrecisionOf() in
    // src/lib/computed.mjs, which also copes with rows fetched before this.
    startPrecision: media.startDate?.year
      ? media.startDate.day ? 'day' : media.startDate.month ? 'month' : 'year'
      : null,
    trailer: media.trailer?.site === 'youtube' ? { id: media.trailer.id, thumb: media.trailer.thumbnail || null } : null,
    nextEpisode: media.nextAiringEpisode ? { at: media.nextAiringEpisode.airingAt, number: media.nextAiringEpisode.episode } : null,
    endYear: media.endDate?.year ?? null,
    chapters: media.chapters ?? null,
    volumes: media.volumes ?? null,
    episodes: media.episodes ?? null,
    season: media.season ?? null,
    seasonYear: media.seasonYear ?? null,
    genres: media.genres || [],
    tags: (media.tags || [])
      .filter((t) => !t.isAdult && !t.isMediaSpoiler && t.rank >= 60)
      .slice(0, 12)
      .map((t) => t.name),
    score: media.averageScore ?? null,
    popularity: media.popularity ?? 0,
    favourites: media.favourites ?? 0,
    cover: media.coverImage?.extraLarge || media.coverImage?.large || null,
    coverColor: media.coverImage?.color || null,
    banner: media.bannerImage || null,
    anilistUrl: media.siteUrl,
    readLinks: links
      .filter(isReadLink)
      .map((l) => ({ site: canonicalSite(l.site), url: l.url, language: l.language || null })),
    watchLinks: links.filter(isWatchLink).map((l) => ({ site: l.site, url: l.url, language: l.language || null })),
    otherLinks: links
      .filter((l) => !isReadLink(l) && !isWatchLink(l))
      // The language rides along (only when AniList gives one) so a page with
      // no English platform can mark an official link "Japanese only" from a
      // fact, not from the address alone. See src/lib/alike.mjs.
      .map((l) => ({ site: l.site, url: l.url, type: l.type, ...(l.language ? { language: l.language } : {}) })),
    streamingEpisodes: (media.streamingEpisodes || []).slice(0, 3).map((e) => ({ title: e.title, url: e.url, site: e.site })),
    studios: media.studios?.nodes?.map((s) => s.name) || [],
    // Only the first four staff rows, as when the query asked for four: the
    // wider list must not drag a "Touch-up Art" credit into the author line.
    authors: (media.staff?.edges || [])
      .slice(0, AUTHOR_STAFF)
      .filter((e) => /story|art|original/i.test(e.role || ''))
      .map((e) => ({ name: e.node.name.full, role: e.role })),
    // Director, writer, designer, composer: the credits an anime page names.
    // A comic keeps no such list, so its record does not grow.
    ...(staff.length ? { staff } : {}),
    relations,
    characters: (media.characters?.edges || []).map((e) => ({
      id: e.node.id,
      slug: slugify(e.node.name.full) + '-' + e.node.id,
      name: e.node.name.full,
      image: e.node.image?.large || null,
      role: e.role,
      // Who speaks this part in the Japanese dub. "Who voices X" is a real
      // search and today we answer it with nothing. Only for anime: a comic
      // has no voices.
      voice: voiceIn(e.voiceActorRoles, 'Japanese'),
      // The English dub's voice, stored only when there is one, so the ~86,000
      // comic records carry no empty key for it.
      ...(voiceIn(e.voiceActorRoles, 'English') ? { voiceEn: voiceIn(e.voiceActorRoles, 'English') } : {}),
      // The full body rides along here and is stripped once it reaches CHARACTERS.
      body: {
        id: e.node.id,
        slug: slugify(e.node.name.full) + '-' + e.node.id,
        name: e.node.name.full,
        native: e.node.name.native || null,
        aliases: (e.node.name.alternative || []).filter(Boolean).slice(0, 3),
        image: e.node.image?.large || null,
        gender: e.node.gender || null,
        age: e.node.age || null,
        birthday: e.node.dateOfBirth?.month ? e.node.dateOfBirth.month + '/' + e.node.dateOfBirth.day : null,
        bloodType: e.node.bloodType || null,
        // How many AniList members picked this character as a favourite. It is
        // the only popularity number a character record carries.
        favourites: e.node.favourites ?? 0,
        description: cutBio((e.node.description || '').replace(/<[^>]+>/g, '').trim()),
      },
    })),
  }
}

/** Move every character body into CHARACTERS and leave a thin reference behind. */
export function harvestCharacters(item) {
  for (const c of item.characters || []) {
    if (c.id == null) continue
    if (c.body) {
      CHARACTERS.set(c.id, { ...c.body, appearsIn: [] })
      delete c.body
    } else if (!CHARACTERS.has(c.id)) {
      CHARACTERS.set(c.id, { id: c.id, slug: c.slug, name: c.name, image: c.image, appearsIn: [] })
    }
  }
}

/**
 * data/seen.json is the memory of the ingest: id -> updatedAt for every title
 * we already hold. Anything in here is never fetched again unless AniList
 * says its updatedAt moved.
 */
export const SEEN_FILE = join(DATA_DIR, 'seen.json')

export function loadSeen() {
  try {
    const raw = JSON.parse(readFileSync(SEEN_FILE, 'utf8'))
    return new Map(Object.entries(raw).map(([id, at]) => [Number(id), at]))
  } catch {
    return new Map()
  }
}

function writeSeen(items) {
  const out = {}
  for (const item of items) out[item.id] = item.updatedAt ?? 0
  writeJsonAtomic(SEEN_FILE, out)
}

/**
 * A missing file is the fallback (a first run). Any other failure is an error.
 * This used to return the fallback for a torn or corrupt file too: the daily
 * job then built on an empty catalog, wrote the empty result back, and the
 * cache handed that loss to every run after it.
 */
export const readJson = (file, fallback) => {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw new Error(`${file} could not be read: ${error.message}`)
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${file} is corrupt: ${error.message}`)
  }
}

// How big the catalog was when loadAssembled read it. assembleAndWrite
// refuses to write anything clearly smaller back (see guardShrink).
let LOADED = null

/**
 * Read the last assembled catalog back into memory.
 * The daily job builds on top of this instead of re-reading the raw dump.
 */
export function loadAssembled() {
  const comics = readJson(join(DATA_DIR, 'comics.json'), [])
  const anime = readJson(join(DATA_DIR, 'anime.json'), [])
  const characters = readJson(join(DATA_DIR, 'characters.json'), [])
  LOADED = { comics: comics.length, anime: anime.length, characters: characters.length }
  CHARACTERS.clear()
  PRIOR_ROWS.clear()
  for (const c of characters) {
    // A record built from a cast entry has no id. Keyed on null they all
    // collided on one Map slot and only the last one survived.
    CHARACTERS.set(c.id ?? c.slug, { ...c, appearsIn: [] })
    if (c.slug && (c.appearsIn || []).length) PRIOR_ROWS.set(c.slug, c.appearsIn)
  }
  return { comics, anime }
}

/** Read raw JSONL page files. A later file overwrites an earlier one. */
export function loadRawFiles(files) {
  const byId = new Map()
  for (const file of files) {
    const path = join(RAW_DIR, file)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line) continue
      let item
      try {
        item = JSON.parse(line)
      } catch {
        continue
      }
      harvestCharacters(item)
      byId.set(item.id, item)
    }
  }
  return [...byId.values()]
}

/**
 * Cross-link comics to anime, build the character index, and write
 * data/comics.json, data/anime.json, data/characters.json, data/stats.json.
 */
export function assembleAndWrite(comics, anime, startedAt = Date.now()) {
  mkdirSync(DATA_DIR, { recursive: true })

  // Blocked titles leave here first, before any link, cast list or stat is
  // built, so nothing downstream can mention them. A character whose only
  // title was blocked is remembered now, because after the filter there is
  // no record left that says where that character came from.
  const blockedCast = new Set()
  if (BLOCKED_MEDIA.size) {
    let dropped = 0
    for (const items of [comics, anime]) {
      for (const item of items) {
        if (!BLOCKED_MEDIA.has(item.id)) continue
        dropped++
        for (const ref of item.characters || []) if (ref.slug) blockedCast.add(ref.slug)
      }
    }
    comics = dropBlockedRows(dropBlocked(comics))
    anime = dropBlockedRows(dropBlocked(anime))
    if (dropped) console.log(`Blocked ${dropped} title(s) named in data/block.json.`)
  }
  const animeById = new Map(anime.map((a) => [a.id, a]))
  const comicById = new Map(comics.map((c) => [c.id, c]))

  for (const comic of comics) {
    const adaptations = (comic.relations || [])
      .filter((r) => r.type === 'ANIME')
      .map((r) => animeById.get(r.id))
      .filter(Boolean)
    comic.hasAnime = (comic.relations || []).some((r) => r.type === 'ANIME')
    comic.animeInIndex = adaptations.map((a) => ({ slug: a.slug, title: a.title, episodes: a.episodes, watchCount: a.watchLinks.length }))
  }

  for (const show of anime) {
    const sources = (show.relations || [])
      .filter((r) => r.type === 'MANGA' && /SOURCE|ADAPTATION|PARENT|PREQUEL/i.test(r.relation || ''))
      .map((r) => comicById.get(r.id))
      .filter(Boolean)
    show.comicInIndex = sources.map((c) => ({ slug: c.slug, title: c.title, kind: c.kind, country: c.country, readCount: c.readLinks.length }))
  }

  // The slug ends in the AniList id, so it is the one key that matches in both
  // the current catalog format and the older one, whose character references
  // carry no id at all.
  const bySlug = new Map()
  for (const person of CHARACTERS.values()) {
    person.appearsIn = []
    if (person.slug) bySlug.set(person.slug, person)
  }

  for (const [items, defaultKind] of [[comics, 'comic'], [anime, 'anime']]) {
    for (const item of items) {
      // A title in `comics` can itself be a novel (see kindOfMedia above), so
      // the appearance carries the title's own kind, never the group's.
      const kind = item.kind || defaultKind
      for (const ref of item.characters || []) {
        // Every title page links to its cast, so a character with no record
        // here became a dead link: about one in four of them. The reference
        // itself carries a name and a face, which is enough for a page, so
        // build the record from it instead of dropping the reader on a 404.
        let person = (ref.id != null && CHARACTERS.get(ref.id)) || bySlug.get(ref.slug)
        if (!person) {
          if (!ref.slug || !ref.name || !ref.image) continue
          person = { id: ref.id ?? null, slug: ref.slug, name: ref.name, image: ref.image, appearsIn: [] }
          CHARACTERS.set(ref.id ?? ref.slug, person)
          bySlug.set(ref.slug, person)
        }
        person.appearsIn.push({
          kind,
          slug: item.slug,
          title: item.title,
          cover: item.cover,
          country: item.country,
          role: ref.role,
          popularity: item.popularity || 0,
          // Only an anime has a voice, so this is null on every comic row.
          voice: ref.voice || null,
          ...(ref.voiceEn ? { voiceEn: ref.voiceEn } : {}),
        })
      }
      // Keep the id: the daily job needs it to rebuild this same link.
      item.characters = (item.characters || []).map((r) => ({
        id: r.id, slug: r.slug, name: r.name, image: r.image, role: r.role, voice: r.voice || null,
        ...(r.voiceEn ? { voiceEn: r.voiceEn } : {}),
      }))
    }
  }

  // A page must never vanish. Every row a character held before is kept, as
  // long as its title is still in the catalog, and that title's own cast list
  // keeps the character too, so a /characters page never shrinks away either.
  // Fresh rows from today's cast lists win; only the missing ones come back.
  const titleByKey = new Map()
  const titleBySlug = new Map()
  for (const [items, defaultKind] of [[comics, 'comic'], [anime, 'anime']]) {
    for (const item of items) {
      const kind = item.kind || defaultKind
      titleByKey.set(`${kind}/${item.slug}`, item)
      titleBySlug.set(item.slug, item)
    }
  }
  let restored = 0
  for (const [slug, rows] of PRIOR_ROWS) {
    const person = bySlug.get(slug)
    if (!person) continue
    const have = new Set(person.appearsIn.map((a) => `${a.kind}/${a.slug}`))
    for (const row of rows) {
      // An old row may still carry the pre-fix kind 'comic' for a title that
      // is really a novel: resolve by slug so the title's own kind wins,
      // never the row's stale one.
      const item = titleByKey.get(`${row.kind}/${row.slug}`) || titleBySlug.get(row.slug)
      if (!item) continue
      const kind = item.kind || row.kind
      const key = `${kind}/${row.slug}`
      if (have.has(key)) continue
      have.add(key)
      person.appearsIn.push({
        ...row,
        kind,
        title: item.title,
        cover: item.cover,
        country: item.country,
        popularity: item.popularity || 0,
      })
      if (!item.characters.some((r) => r.slug === person.slug)) {
        item.characters.push({
          id: person.id ?? null, slug: person.slug, name: person.name, image: person.image, role: row.role, voice: row.voice || null,
          ...(row.voiceEn ? { voiceEn: row.voiceEn } : {}),
        })
      }
      restored++
    }
  }
  if (restored) console.log(`Kept ${restored} cast links that today's top-ten cast lists had dropped.`)

  const characterList = [...CHARACTERS.values()]
    // A name and a face are the whole gate. The old gate also demanded a main
    // role or a written bio, which threw away a quarter of the cast we link to
    // from every title page, and search sends us real traffic for exactly those
    // names. Nothing is fetched twice for this: the record was already in hand.
    .filter((c) => c.name && c.image)
    // A character whose only title was blocked has nothing left to show, and
    // its page would name a work the site refuses to list. Only characters the
    // block itself emptied are dropped; every other empty record is left alone,
    // because a page that already ranks must never vanish.
    .filter((c) => !(blockedCast.has(c.slug) && c.appearsIn.length === 0))
    // Every record leaves here with the same shape. A record built from a cast
    // entry knows only a name and a face, and a page that read the missing
    // alias list straight off the record answered a reader with a 500.
    .map((c) => ({
      ...c,
      aliases: c.aliases || [],
      appearsIn: c.appearsIn.sort((x, y) => y.popularity - x.popularity),
    }))
    // Most-loved character first, biggest title as the tie-break. The wall
    // reads the same order, so a whole cast no longer sits in one clump.
    .sort(
      (x, y) =>
        (y.favourites || 0) - (x.favourites || 0) ||
        (y.appearsIn[0]?.popularity || 0) - (x.appearsIn[0]?.popularity || 0)
    )

  guardShrink({ comics: comics.length, anime: anime.length, characters: characterList.length })

  writeJsonAtomic(join(DATA_DIR, 'characters.json'), characterList)
  writeJsonAtomic(join(DATA_DIR, 'comics.json'), comics)
  writeJsonAtomic(join(DATA_DIR, 'anime.json'), anime)
  writeSeen([...comics, ...anime])

  const stats = {
    generatedAt: new Date().toISOString(),
    durationSeconds: Math.round((Date.now() - startedAt) / 1000),
    comics: comics.filter((c) => c.kind !== 'novel').length,
    novels: comics.filter((c) => c.kind === 'novel').length,
    comicsWithReadLinks: comics.filter((c) => c.readLinks.length > 0).length,
    comicsWithAnime: comics.filter((c) => c.hasAnime).length,
    comicsLinkedToAnimeInIndex: comics.filter((c) => c.animeInIndex.length > 0).length,
    anime: anime.length,
    animeWithWatchLinks: anime.filter((a) => a.watchLinks.length > 0).length,
    animeLinkedToComicInIndex: anime.filter((a) => a.comicInIndex.length > 0).length,
    characters: characterList.length,
    byCountry: comics.filter((c) => c.kind !== 'novel').reduce((acc, c) => ((acc[c.country] = (acc[c.country] || 0) + 1), acc), {}),
  }
  writeJsonAtomic(join(DATA_DIR, 'stats.json'), stats, 2)
  return stats
}

/**
 * The catalog only grows: the ingest adds and refreshes, it never deletes. A
 * result clearly smaller than what loadAssembled read means records were lost
 * on the way (a half-read file, a walk that started from the seed), and
 * writing it would carry the loss into the cache and on to the live site.
 * Throwing leaves the old files on disk untouched. ALLOW_SHRINK=1 lets an
 * intended drop through (a FRESH=1 backfill, a big block list).
 */
const SHRINK_LIMIT = 0.98

function guardShrink(now) {
  if (!LOADED || process.env.ALLOW_SHRINK) return
  for (const name of ['comics', 'anime', 'characters']) {
    if (now[name] >= LOADED[name] * SHRINK_LIMIT) continue
    throw new Error(
      `SHRINK GUARD: ${name} would fall from ${LOADED[name]} to ${now[name]}. ` +
        'Nothing was written. Run with ALLOW_SHRINK=1 if the drop is intended.'
    )
  }
}
