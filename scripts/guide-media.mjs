// Names, pictures and site links for every AniList id the guides use.
//
//   npm run guides:media             fetch only ids not in the file yet
//   npm run guides:media -- --refresh   fetch every id again
//
// Run by hand after adding or changing a guide (never part of the build), and
// commit what it writes:
//
//   data/guide-media.json  c<id> / m<id> -> name or title, AniList image URLs,
//                          and the page on this site when there is one
//   data/guide-index.json  the guide list and the "Featured in" map, small
//                          enough for the Worker-rendered pages to import
//
// AniList is asked in batches of 50 ids (Page { characters(id_in) } and
// Page { media(id_in) }), one request every ~2.5 seconds, well under its
// limit of about 30 a minute. Images stay on AniList's CDN; nothing is
// downloaded or rehosted.
//
// Site links come from data/slug-registry.json, the frozen address of every
// page (see src/lib/slug-registry.mjs). Without the registry the links
// already in the file are kept.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { readGuideFiles } from './guide-files.mjs'
import { collectIds, charKey, mediaKey, buildGuideIndex } from '../src/lib/guides.mjs'
import { loadRegistry } from '../src/lib/slug-registry.mjs'
import { BLOCKED_MEDIA } from '../src/lib/blocked.js'

const DATA = join(process.cwd(), 'data')
const MEDIA_FILE = join(DATA, 'guide-media.json')
const INDEX_FILE = join(DATA, 'guide-index.json')
const API = 'https://graphql.anilist.co'
const BATCH = 50
const PAUSE_MS = 2500
const refresh = process.argv.includes('--refresh')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const CHARACTER_QUERY = `query ($ids: [Int]) { Page(perPage: 50) { characters(id_in: $ids) {
  id name { full } image { large }
  media(perPage: 3, sort: POPULARITY_DESC) { nodes { id } } } } }`

const MEDIA_QUERY = `query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids) {
  id type format title { english romaji } coverImage { extraLarge large } bannerImage } } }`

let lastCall = 0
async function ask(query, ids, tries = 4) {
  const wait = lastCall + PAUSE_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastCall = Date.now()
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables: { ids } }),
  })
  if (res.status === 429 && tries > 0) {
    const after = Number(res.headers.get('retry-after')) || 60
    console.log(`  AniList asks for a pause: ${after}s`)
    await sleep(after * 1000)
    return ask(query, ids, tries - 1)
  }
  if (!res.ok) throw new Error(`AniList answered ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = await res.json()
  if (json.errors) throw new Error(`AniList error: ${JSON.stringify(json.errors).slice(0, 300)}`)
  return json.data.Page
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

async function main() {
  const guides = readGuideFiles()
  const { characters, media } = collectIds(guides)
  const store = readJson(MEDIA_FILE, {})
  console.log(`${guides.length} guides, ${characters.length} characters, ${media.length} titles named`)

  const missingChars = characters.filter((id) => refresh || !store[charKey(id)])
  await inBatches(missingChars, async (ids) => {
    const page = await ask(CHARACTER_QUERY, ids)
    for (const c of page.characters) {
      store[charKey(c.id)] = {
        ...(store[charKey(c.id)] || {}),
        id: c.id,
        name: c.name.full,
        image: c.image?.large || null,
        media: c.media.nodes.map((n) => n.id),
      }
    }
    const gone = ids.filter((id) => !page.characters.some((c) => c.id === id))
    if (gone.length) console.warn(`  not on AniList (check the ids): characters ${gone.join(', ')}`)
  })

  // Titles named by a guide, plus the top title of every character, so a
  // card can always name and link its series.
  const allMedia = new Set(media)
  for (const id of characters) for (const m of store[charKey(id)]?.media || []) allMedia.add(m)
  const missingMedia = [...allMedia].filter((id) => refresh || !store[mediaKey(id)])
  await inBatches(missingMedia, async (ids) => {
    const page = await ask(MEDIA_QUERY, ids)
    for (const m of page.media) {
      store[mediaKey(m.id)] = {
        ...(store[mediaKey(m.id)] || {}),
        id: m.id,
        title: m.title.english || m.title.romaji,
        type: m.type,
        format: m.format,
        cover: m.coverImage?.extraLarge || m.coverImage?.large || null,
        banner: m.bannerImage || null,
      }
    }
    const gone = ids.filter((id) => !page.media.some((m) => m.id === id))
    if (gone.length) console.warn(`  not on AniList (check the ids): media ${gone.join(', ')}`)
  })
  console.log(`fetched ${missingChars.length} characters and ${missingMedia.length} titles`)

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
  const index = buildGuideIndex(guides, sorted)
  writeFileSync(INDEX_FILE, `${JSON.stringify(index, null, 1)}\n`)
  console.log(`wrote ${MEDIA_FILE} and ${INDEX_FILE}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
