#!/usr/bin/env node
/**
 * AniList ingest for manhwaindex.com
 *
 * Pulls comics (manhwa / manhua / manga) and anime into data/*.json.
 * Run this on a schedule. NEVER call AniList from a page request.
 *
 * AniList rate limit is currently degraded to 30 requests/minute, so we
 * pace at REQUEST_DELAY_MS and back off hard on a 429.
 */

import { writeFileSync, mkdirSync, appendFileSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalSite } from '../src/lib/platform-aliases.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = join(ROOT, 'data')

const API = 'https://graphql.anilist.co'
const REQUEST_DELAY_MS = 6500
const MAX_RETRIES = 12
const PER_PAGE = 50

/** How much to pull per country. One page = 50 titles. */
const COMIC_TARGETS = [
  { country: 'KR', pages: 20, label: 'manhwa' },
  { country: 'JP', pages: 20, label: 'manga' },
  { country: 'CN', pages: 10, label: 'manhua' },
]
const ANIME_PAGES = 20

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const MEDIA_FIELDS = `
  id idMal siteUrl format status countryOfOrigin
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
  staff(perPage: 4, sort: RELEVANCE) { edges { role node { name { full } } } }
  streamingEpisodes { title url site }
  relations { edges { relationType node { id type format countryOfOrigin title { romaji english } } } }
  characters(perPage: 10, sort: [ROLE, RELEVANCE]) { edges { role node { id name { full native alternative } image { large } description(asHtml: false) gender age dateOfBirth { month day } } } }
`

const COMIC_QUERY = `query ($page: Int, $country: CountryCode) {
  Page(page: $page, perPage: ${PER_PAGE}) {
    pageInfo { hasNextPage currentPage }
    media(type: MANGA, countryOfOrigin: $country, isAdult: false, sort: POPULARITY_DESC) {
      ${MEDIA_FIELDS}
      staff(perPage: 4, sort: RELEVANCE) { edges { role node { name { full } } } }
    }
  }
}`

const ANIME_QUERY = `query ($page: Int) {
  Page(page: $page, perPage: ${PER_PAGE}) {
    pageInfo { hasNextPage currentPage }
    media(type: ANIME, isAdult: false, sort: POPULARITY_DESC) {
      ${MEDIA_FIELDS}
      streamingEpisodes { title thumbnail url site }
      studios(isMain: true) { nodes { name } }
    }
  }
}`

const CHARACTERS = new Map()

async function gql(query, variables, attempt = 1) {
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
  if (body.errors) throw new Error(`GraphQL: ${JSON.stringify(body.errors).slice(0, 300)}`)
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
]

const isReadLink = (link) =>
  READ_PLATFORMS.some((p) => canonicalSite(link.site || '').toLowerCase() === p.toLowerCase())

const isWatchLink = (link) => link.type === 'STREAMING'

const slugify = (value) =>
  (value || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)


// Bios end on a full sentence, never mid-word. Spoiler blocks ~!...!~ are
// dropped whole, so a cut never lands inside one and leaks it.
const BIO_MAX = 1500
function cutBio(text) {
  const clean = text.replace(/~![\s\S]*?!~/g, '').trim()
  if (clean.length <= BIO_MAX) return clean
  const head = clean.slice(0, BIO_MAX)
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('.\n'), head.lastIndexOf('\n\n'))
  return (end > 200 ? head.slice(0, end + 1) : head).trim()
}

function shape(media, kind) {
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

  return {
    kind, // 'comic' | 'anime'
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
    description: (media.description || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim(),
    startYear: media.startDate?.year ?? null,
    startDate: media.startDate?.year ? [media.startDate.year, media.startDate.month || 1, media.startDate.day || 1] : null,
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
      .map((l) => ({ site: l.site, url: l.url, type: l.type })),
    streamingEpisodes: (media.streamingEpisodes || []).slice(0, 3).map((e) => ({ title: e.title, url: e.url, site: e.site })),
    studios: media.studios?.nodes?.map((s) => s.name) || [],
    authors: (media.staff?.edges || [])
      .filter((e) => /story|art|original/i.test(e.role || ''))
      .map((e) => ({ name: e.node.name.full, role: e.role })),
    relations,
    characters: (media.characters?.edges || []).map((e) => ({
      id: e.node.id,
      slug: slugify(e.node.name.full) + '-' + e.node.id,
      name: e.node.name.full,
      image: e.node.image?.large || null,
      role: e.role,
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
        description: cutBio((e.node.description || '').replace(/<[^>]+>/g, '').trim()),
      },
    })),
  }
}

const RAW_DIR = join(DATA_DIR, "raw")
const PROGRESS_FILE = join(RAW_DIR, "progress.json")

function readProgress() {
  try {
    return JSON.parse(readFileSync(PROGRESS_FILE, 'utf8'))
  } catch {
    return {}
  }
}

// Each page goes to disk the moment it lands. A kill costs one page, not the run.
async function pull({ query, pages, variables = {}, kind, label }) {
  // Build the site from what is already on disk, without touching the API.
  if (process.env.ASSEMBLE_ONLY === '1') return
  mkdirSync(RAW_DIR, { recursive: true })
  const file = join(RAW_DIR, label + '.jsonl')
  const progress = readProgress()
  const done = progress[label] || 0
  if (done >= pages) {
    console.log(`  ${label}: already have ${done}/${pages} pages, skipping`)
    return
  }
  if (done > 0) console.log(`  ${label}: resuming at page ${done + 1}/${pages}`)

  for (let page = done + 1; page <= pages; page++) {
    let data
    try {
      data = await gql(query, { ...variables, page })
    } catch (error) {
      console.warn(`  ${label} page ${page} failed for good: ${error.message}. skipping.`)
      await sleep(REQUEST_DELAY_MS)
      continue
    }
    const media = data?.Page?.media || []
    let lines = ''
    for (const m of media) lines += JSON.stringify(shape(m, kind)) + String.fromCharCode(10)
    appendFileSync(file, lines)
    const now = readProgress()
    now[label] = page
    writeFileSync(PROGRESS_FILE, JSON.stringify(now))
    process.stdout.write(`  ${label} page ${page}/${pages}
`)
    if (!data?.Page?.pageInfo?.hasNextPage) {
      const final = readProgress()
      final[label] = pages
      writeFileSync(PROGRESS_FILE, JSON.stringify(final))
      break
    }
    await sleep(REQUEST_DELAY_MS)
  }
}

// Read the page files back, drop duplicates, and rebuild the character map.
function loadRaw(labels) {
  const out = []
  const seen = new Set()
  for (const label of labels) {
    const file = join(RAW_DIR, label + '.jsonl')
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split(String.fromCharCode(10))) {
      if (!line) continue
      let item
      try {
        item = JSON.parse(line)
      } catch {
        continue
      }
      if (seen.has(item.id)) continue
      seen.add(item.id)
      for (const c of item.characters) {
        if (!CHARACTERS.has(c.id)) CHARACTERS.set(c.id, { ...c.body, appearsIn: [] })
        delete c.body
      }
      out.push(item)
    }
  }
  return out
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true })
  const startedAt = Date.now()

  console.log('Pulling comics...')
  for (const target of COMIC_TARGETS) {
    await pull({
      query: COMIC_QUERY,
      pages: target.pages,
      variables: { country: target.country },
      kind: 'comic',
      label: target.label,
    })
  }

  console.log('Pulling anime...')
  await pull({ query: ANIME_QUERY, pages: ANIME_PAGES, kind: 'anime', label: 'anime' })

  console.log('Assembling...')
  const comics = loadRaw(COMIC_TARGETS.map((t) => t.label))
  const anime = loadRaw(['anime'])
  // Cross-link: for every comic, find the anime we actually hold.
  const animeById = new Map(anime.map((a) => [a.id, a]))
  const comicById = new Map(comics.map((c) => [c.id, c]))

  for (const comic of comics) {
    const adaptations = comic.relations
      .filter((r) => r.type === 'ANIME')
      .map((r) => animeById.get(r.id))
      .filter(Boolean)
    comic.hasAnime = comic.relations.some((r) => r.type === 'ANIME')
    comic.animeInIndex = adaptations.map((a) => ({ slug: a.slug, title: a.title, episodes: a.episodes, watchCount: a.watchLinks.length }))
  }

  for (const show of anime) {
    const sources = show.relations
      .filter((r) => r.type === 'MANGA' && /SOURCE|ADAPTATION|PARENT|PREQUEL/i.test(r.relation || ''))
      .map((r) => comicById.get(r.id))
      .filter(Boolean)
    show.comicInIndex = sources.map((c) => ({ slug: c.slug, title: c.title, readCount: c.readLinks.length }))
  }

  // Fill in where each character appears, then keep only the ones worth a page.
  for (const [items, defaultKind] of [[comics, 'comic'], [anime, 'anime']]) {
    for (const item of items) {
      // A title in `comics` can itself be a novel; the appearance carries
      // the title's own kind, never the group's fixed default.
      const kind = item.kind || defaultKind
      for (const ref of item.characters) {
        const person = CHARACTERS.get(ref.id)
        if (!person) continue
        person.appearsIn.push({
          kind,
          slug: item.slug,
          title: item.title,
          cover: item.cover,
          country: item.country,
          role: ref.role,
          popularity: item.popularity || 0,
        })
      }
      item.characters = item.characters.map((r) => ({ slug: r.slug, name: r.name, image: r.image, role: r.role }))
    }
  }
  const characterList = [...CHARACTERS.values()]
    .filter((c) => c.name && c.image && (c.appearsIn.some((a) => a.role === 'MAIN') || c.description))
    .map((c) => ({ ...c, appearsIn: c.appearsIn.sort((x, y) => y.popularity - x.popularity) }))
    .sort((x, y) => (y.appearsIn[0]?.popularity || 0) - (x.appearsIn[0]?.popularity || 0))
  writeFileSync(join(DATA_DIR, 'characters.json'), JSON.stringify(characterList))
  CHARACTERS.clear()

  writeFileSync(join(DATA_DIR, 'comics.json'), JSON.stringify(comics))
  writeFileSync(join(DATA_DIR, 'anime.json'), JSON.stringify(anime))

  const stats = {
    generatedAt: new Date().toISOString(),
    durationSeconds: Math.round((Date.now() - startedAt) / 1000),
    comics: comics.length,
    comicsWithReadLinks: comics.filter((c) => c.readLinks.length > 0).length,
    comicsWithAnime: comics.filter((c) => c.hasAnime).length,
    comicsLinkedToAnimeInIndex: comics.filter((c) => c.animeInIndex.length > 0).length,
    anime: anime.length,
    animeWithWatchLinks: anime.filter((a) => a.watchLinks.length > 0).length,
    animeLinkedToComicInIndex: anime.filter((a) => a.comicInIndex.length > 0).length,
    characters: characterList.length,
    byCountry: comics.reduce((acc, c) => ((acc[c.country] = (acc[c.country] || 0) + 1), acc), {}),
  }
  writeFileSync(join(DATA_DIR, 'stats.json'), JSON.stringify(stats, null, 2))

  console.log('\nDone.')
  console.log(JSON.stringify(stats, null, 2))
}

main().catch((error) => {
  console.error('INGEST FAILED:', error.message)
  process.exit(1)
})
