// Names, pictures and site links for every AniList id the guides use.
//
//   npm run guides:media             fetch only ids not in the file yet
//   npm run guides:media -- --refresh   fetch every id again
//
// Run by hand after adding or changing a guide (never part of the build), and
// commit what it writes:
//
//   data/guide-media.json       c<id> / m<id> -> name or title, AniList image
//                                URLs (banner, cover, popularity) and the page
//                                on this site when there is one
//   data/guide-index.json       the guide list (each with its own `banner`,
//                                unique across the whole site) and the
//                                "Featured in" map, small enough for the
//                                Worker-rendered pages to import
//   data/guide-data-banners.json  the same banner assignment for the 7
//                                built-in data guides (src/lib/guides-registry.js)
//
// AniList is asked in batches of 50 ids, one request every ~2.5 seconds, well
// under its limit of about 30 a minute. Images stay on AniList's CDN; nothing
// is downloaded or rehosted.
//
// Every guide gets exactly one wide banner, unique site-wide (src/lib/guides.mjs
// assignBanners): its own hero banner first, then a banner from the same
// franchise (sequels, prequels, side stories, spin-offs, adaptations... up to
// two relations deep), then a banner from one of its own entries, and only
// when every one of those is already taken by a more important guide does it
// fall back to a cover image.
//
// Site links come from data/slug-registry.json, the frozen address of every
// page (see src/lib/slug-registry.mjs). Without the registry the links
// already in the file are kept.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { readGuideFiles } from './guide-files.mjs'
import { collectIds, charKey, mediaKey, buildGuideIndex, assignBanners } from '../src/lib/guides.mjs'
import { loadRegistry } from '../src/lib/slug-registry.mjs'
import { BLOCKED_MEDIA } from '../src/lib/blocked.js'
// From guides-data-content.js directly, not guides-registry.js: that module
// imports data/guide-index.json with an ES import, which plain Node ESM
// (this script) cannot load without an import attribute Astro's bundler
// does not need. guides-data-content.js has no JSON import, so it is safe here.
import { DATA_GUIDES } from '../src/lib/guides-data-content.js'
import { gql, sleep } from './anilist-core.mjs'

const DATA = join(process.cwd(), 'data')
const MEDIA_FILE = join(DATA, 'guide-media.json')
const INDEX_FILE = join(DATA, 'guide-index.json')
const DATA_BANNERS_FILE = join(DATA, 'guide-data-banners.json')
const BATCH = 50
const PAUSE_MS = 2500
const refresh = process.argv.includes('--refresh')

const CHARACTER_QUERY = `query ($ids: [Int]) { Page(perPage: 50) { characters(id_in: $ids) {
  id name { full } image { large }
  media(perPage: 3, sort: POPULARITY_DESC) { nodes { id } } } } }`

// Relations fetched two deep in one call: the root's own relations (depth 1)
// and each of those relations' own relations (depth 2). Every node carries
// enough to rank and render it as a banner candidate.
const MEDIA_FIELDS = `id type format popularity title { english romaji } coverImage { extraLarge large } bannerImage`
const MEDIA_QUERY = `query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids) {
  ${MEDIA_FIELDS}
  relations { edges { relationType node {
    ${MEDIA_FIELDS}
    relations { edges { relationType node { ${MEDIA_FIELDS} } } }
  } } }
} } }`

// The relation kinds and formats a guide's franchise walk follows. A light
// novel or a side one-shot still counts; a completely unrelated CHARACTER or
// STAFF relation (AniList has none on media-to-media, but formats like
// MUSIC do turn up) does not.
const FRANCHISE_RELATIONS = new Set([
  'SEQUEL', 'PREQUEL', 'PARENT', 'SIDE_STORY', 'ALTERNATIVE', 'SPIN_OFF',
  'SOURCE', 'ADAPTATION', 'SUMMARY', 'OTHER',
])
const FRANCHISE_FORMATS = new Set(['TV', 'TV_SHORT', 'MOVIE', 'OVA', 'ONA', 'SPECIAL', 'MANGA', 'ONE_SHOT'])

let lastCall = 0
async function ask(query, ids) {
  const wait = lastCall + PAUSE_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastCall = Date.now()
  return gql(query, { ids })
}

async function inBatches(ids, fn) {
  for (let i = 0; i < ids.length; i += BATCH) await fn(ids.slice(i, i + BATCH))
}

const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback)

/**
 * A check that a record is still in the local catalog file, when that file
 * is here (it is not in git). Read as latin1: ids are plain digits, and one
 * byte per character keeps the 190 MB string cheap.
 */
function catalogCheck(name, needles) {
  const file = join(DATA, `${name}.json`)
  if (!existsSync(file)) return () => true
  let text = null
  return (id) => {
    if (text === null) text = readFileSync(file, 'latin1')
    return needles(id).some((needle) => text.includes(needle))
  }
}

/** AniList media ids embedded in a data guide's own picture URLs, e.g. one
 * cover at .../cover/large/bx105398-xxx.jpg or a banner at
 * .../banner/105398-xxx.jpg. The first is the guide's "hero", the rest its
 * entry candidates, in the order the guide lists them. */
function dataGuideMediaIds(guide) {
  const ids = []
  const take = (src) => {
    const match = /\/(?:cover\/(?:large|medium|extraLarge)\/bx|banner\/)(\d+)/.exec(src || '')
    if (match) ids.push(Number(match[1]))
  }
  take(guide.image)
  for (const pic of guide.pictures || []) take(pic.src)
  return [...new Set(ids)]
}

/** Every id a media record's relations reach, depth 1 and depth 2, filtered
 * to the kinds and formats that count as "the same franchise". */
function relationIdsOf(mediaNode) {
  const out = []
  for (const edge of mediaNode?.relations?.edges || []) {
    const node = edge.node
    if (!node || !FRANCHISE_RELATIONS.has(edge.relationType) || !FRANCHISE_FORMATS.has(node.format)) continue
    out.push(node.id)
    for (const deeper of node.relations?.edges || []) {
      if (deeper.node && FRANCHISE_RELATIONS.has(deeper.relationType) && FRANCHISE_FORMATS.has(deeper.node.format)) {
        out.push(deeper.node.id)
      }
    }
  }
  return [...new Set(out)]
}

/** Flatten a fetched media node (and every relation it carries, any depth)
 * into { id -> { title, type, format, cover, banner, popularity } }. */
function flattenMedia(node, into) {
  if (!node || into.has(node.id)) return
  into.set(node.id, {
    id: node.id,
    title: node.title?.english || node.title?.romaji || null,
    type: node.type,
    format: node.format,
    cover: node.coverImage?.extraLarge || node.coverImage?.large || null,
    banner: node.bannerImage || null,
    popularity: node.popularity || 0,
  })
  for (const edge of node.relations?.edges || []) {
    flattenMedia(edge.node, into)
    for (const deeper of edge.node?.relations?.edges || []) flattenMedia(deeper.node, into)
  }
}

async function main() {
  const guides = readGuideFiles()
  const { characters, media } = collectIds(guides)
  const store = readJson(MEDIA_FILE, {})
  console.log(`${guides.length} guides, ${characters.length} characters, ${media.length} titles named`)

  const missingChars = characters.filter((id) => refresh || !store[charKey(id)])
  await inBatches(missingChars, async (ids) => {
    const page = await ask(CHARACTER_QUERY, ids)
    for (const c of page.Page.characters) {
      store[charKey(c.id)] = {
        ...(store[charKey(c.id)] || {}),
        id: c.id,
        name: c.name.full,
        image: c.image?.large || null,
        media: c.media.nodes.map((n) => n.id),
      }
    }
    const gone = ids.filter((id) => !page.Page.characters.some((c) => c.id === id))
    if (gone.length) console.warn(`  not on AniList (check the ids): characters ${gone.join(', ')}`)
  })

  // Every guide's hero media and entry media (the character entries resolve
  // to the character's own top title), for written guides and the 7 data
  // guides alike. These are the "root" ids whose franchise relations get
  // walked two deep for banner candidates.
  const heroMediaOf = (hero = {}) => hero.media || (hero.character ? store[charKey(hero.character)]?.media?.[0] : null)
  const entryMediaOf = (entry) => entry.media || (entry.character ? store[charKey(entry.character)]?.media?.[0] : null)

  const candidateGuides = []
  for (const g of guides) {
    const heroMedia = heroMediaOf(g.hero || {})
    const entryMedia = [...new Set((g.entries || []).map(entryMediaOf).filter(Boolean))].filter((id) => id !== heroMedia)
    candidateGuides.push({ slug: g.slug, isData: false, heroMedia, entryMedia })
  }
  for (const g of DATA_GUIDES) {
    const [heroMedia, ...rest] = dataGuideMediaIds(g)
    candidateGuides.push({ slug: g.slug, isData: true, heroMedia: heroMedia || null, entryMedia: rest })
  }

  // Titles named by a guide, plus the top title of every character, so a
  // card can always name and link its series; this is also every "root" id
  // the franchise walk fetches relations for.
  const allMedia = new Set(media)
  for (const id of characters) for (const m of store[charKey(id)]?.media || []) allMedia.add(m)
  for (const g of candidateGuides) {
    if (g.heroMedia) allMedia.add(g.heroMedia)
    for (const id of g.entryMedia) allMedia.add(id)
  }

  const relationsOf = new Map() // root id -> franchise ids reachable (depth 1-2)
  const fetchedMedia = new Map() // every id seen in any response, flattened
  const missingMedia = [...allMedia].filter((id) => refresh || !store[mediaKey(id)])
  await inBatches(missingMedia, async (ids) => {
    const page = await ask(MEDIA_QUERY, ids)
    for (const m of page.Page.media) {
      flattenMedia(m, fetchedMedia)
      relationsOf.set(m.id, relationIdsOf(m))
      store[mediaKey(m.id)] = {
        ...(store[mediaKey(m.id)] || {}),
        id: m.id,
        title: m.title.english || m.title.romaji,
        type: m.type,
        format: m.format,
        cover: m.coverImage?.extraLarge || m.coverImage?.large || null,
        banner: m.bannerImage || null,
        popularity: m.popularity || 0,
      }
    }
    const gone = ids.filter((id) => !page.Page.media.some((m) => m.id === id))
    if (gone.length) console.warn(`  not on AniList (check the ids): media ${gone.join(', ')}`)
  })
  console.log(`fetched ${missingChars.length} characters and ${missingMedia.length} titles`)

  // A root fetched on an earlier run (cached, so skipped above) still needs
  // its relations for this run's banner assignment.
  const unresolvedRoots = [...allMedia].filter((id) => !relationsOf.has(id) && store[mediaKey(id)])
  await inBatches(unresolvedRoots, async (ids) => {
    const page = await ask(MEDIA_QUERY, ids)
    for (const m of page.Page.media) {
      flattenMedia(m, fetchedMedia)
      relationsOf.set(m.id, relationIdsOf(m))
    }
  })

  const registry = loadRegistry()
  if (registry) {
    // Character rows open with their id; title rows with their kind, then the id.
    const hasCharacter = catalogCheck('characters', (id) => [`{"id":${id},`])
    const hasAnime = catalogCheck('anime', (id) => [`"kind":"anime","id":${id},`])
    const hasComic = catalogCheck('comics', (id) => [`"kind":"comic","id":${id},`, `"kind":"novel","id":${id},`])
    let linked = 0
    for (const [key, row] of Object.entries(store)) {
      const isChar = key.startsWith('c')
      const hit = registry.entries[`${isChar ? 'c' : 't'}:${row.id}`]
      let path = null
      if (hit && isChar && hasCharacter(row.id)) path = `/character/${hit.slug}`
      if (hit && !isChar && !BLOCKED_MEDIA.has(row.id)) {
        const present = hit.ns === 'anime' ? hasAnime(row.id) : hasComic(row.id)
        if (present) path = `/${hit.ns}/${hit.slug}`
      }
      row.path = path
      if (path) linked++
    }
    console.log(`site pages found for ${linked} of ${Object.keys(store).length} records`)
  } else {
    console.warn('no data/slug-registry.json here: site links left as they were')
  }

  const sorted = Object.fromEntries(Object.keys(store).sort().map((k) => [k, store[k]]))
  writeFileSync(MEDIA_FILE, `${JSON.stringify(sorted, null, 1)}\n`)

  // --- banners: every guide, written and data, gets exactly one, unique ---

  // Importance: within guides that share a franchise (by hero media), the
  // slug that reads as the series' main ranking goes first; otherwise file
  // order (readGuideFiles is already sorted by slug, which is stable and
  // matches the order guides were added). Data guides are less important
  // than every written guide: they are the hub's own generated pages, not
  // the keyword-targeted rankings.
  const franchiseOf = (heroMedia) => {
    if (!heroMedia) return null
    // Walk PARENT/SOURCE/ADAPTATION once toward the original work, so a
    // guide about the anime and a guide about the manga of the same story
    // still land in the same group.
    const rels = relationsOf.get(heroMedia) || []
    const parent = rels.find((id) => fetchedMedia.get(id)?.type !== fetchedMedia.get(heroMedia)?.type)
    return parent ?? heroMedia
  }
  const isMainSlug = (slug) => /-strongest-characters$|-power-rankings$/.test(slug)
  const groupOrder = new Map()
  let nextGroup = 0
  const written = candidateGuides.filter((g) => !g.isData)
  for (const g of written) {
    const key = franchiseOf(g.heroMedia) ?? g.slug
    if (!groupOrder.has(key)) groupOrder.set(key, nextGroup++)
  }
  written.forEach((g, i) => {
    const key = franchiseOf(g.heroMedia) ?? g.slug
    const group = groupOrder.get(key)
    g.importance = group * 1000 + (isMainSlug(g.slug) ? 0 : 1) * 100 + i
  })
  const dataGuideList = candidateGuides.filter((g) => g.isData)
  dataGuideList.forEach((g, i) => {
    g.importance = 1_000_000 + i
  })

  const mediaForBanners = Object.fromEntries(fetchedMedia)
  const bannerInput = candidateGuides.map((g) => ({
    slug: g.slug,
    heroMedia: g.heroMedia,
    franchiseMedia: g.heroMedia ? relationsOf.get(g.heroMedia) || [] : [],
    entryMedia: g.entryMedia,
    importance: g.importance,
  }))
  const banners = assignBanners(bannerInput, mediaForBanners)
  const bannerBySlug = new Map(banners.map((b) => [b.slug, b]))

  let own = 0
  let franchise = 0
  let entry = 0
  let fallback = 0
  for (const g of candidateGuides) {
    const b = bannerBySlug.get(g.slug)
    if (!b || !b.banner) continue
    if (b.isFallbackCover) fallback++
    else if (g.heroMedia && mediaForBanners[g.heroMedia]?.banner === b.banner) own++
    else if (g.entryMedia.some((id) => mediaForBanners[id]?.banner === b.banner)) entry++
    else franchise++
  }
  console.log(`banners: ${own} own, ${franchise} franchise, ${entry} entry, ${fallback} fallback cover`)

  const index = buildGuideIndex(guides, sorted)
  for (const row of index.guides) {
    const b = bannerBySlug.get(row.slug)
    if (b?.banner) {
      row.image = b.banner
      row.wide = !b.isFallbackCover
      row.isFallbackCover = b.isFallbackCover
    }
  }
  writeFileSync(INDEX_FILE, `${JSON.stringify(index, null, 1)}\n`)

  const dataBanners = Object.fromEntries(
    dataGuideList.map((g) => {
      const b = bannerBySlug.get(g.slug)
      return [g.slug, b?.banner ? { banner: b.banner, isFallbackCover: !!b.isFallbackCover } : null]
    }),
  )
  writeFileSync(DATA_BANNERS_FILE, `${JSON.stringify(dataBanners, null, 1)}\n`)

  console.log(`wrote ${MEDIA_FILE}, ${INDEX_FILE} and ${DATA_BANNERS_FILE}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
