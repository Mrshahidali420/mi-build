/**
 * KEEP LIST. data/keep.json names AniList ids that the daily refresh must
 * always fetch, whatever the probe says.
 *
 *   {
 *     "characters": [1989],   AniList character ids
 *     "media": [855, 33039]   AniList manga / anime ids
 *   }
 *
 * Why it exists: a page that once ranked on Google can drop out of the
 * catalog when AniList trims a cast list, or when a title's own record
 * changes shape. Putting the id here brings the page back on the next run
 * and keeps it there. Titles come back through the normal fetch path; a
 * character is fetched on its own and linked to every title in the catalog
 * that it appears in.
 *
 * Adult media is skipped on both paths. That matches the ingest, which never
 * asks AniList for it.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR, slugify, cutBio, voiceIn, VOICE_ROLES } from './anilist-core.mjs'
import { KEEP_READ, mergeKeep } from '../src/lib/owner-rules.mjs'

export const KEEP_FILE = join(DATA_DIR, 'keep.json')

/** How many media rows one character fetch carries. Enough for any cast. */
const MEDIA_PER_CHARACTER = 25

export const KEEP_CHARACTERS_QUERY = `query ($ids: [Int]) {
  Page(perPage: 50) {
    characters(id_in: $ids) {
      id name { full native alternative } image { large }
      description(asHtml: false) gender age bloodType favourites
      dateOfBirth { month day }
      media(perPage: ${MEDIA_PER_CHARACTER}, sort: [POPULARITY_DESC]) {
        edges {
          characterRole
          ${VOICE_ROLES}
          node { id type isAdult }
        }
      }
    }
  }
}`

const onlyIds = (list) =>
  [...new Set((Array.isArray(list) ? list : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))]

/** The keep list, with bad rows dropped. A missing file means an empty list. */
export function loadKeep() {
  if (!existsSync(KEEP_FILE)) return { characters: [], media: [] }
  let raw
  try {
    raw = JSON.parse(readFileSync(KEEP_FILE, 'utf8'))
  } catch (error) {
    throw new Error(`data/keep.json is not valid JSON: ${error.message}`)
  }
  return { characters: onlyIds(raw.characters), media: onlyIds(raw.media) }
}

/**
 * The keep list plus the ids kept from the Search tab (the keep_media table,
 * db/migrations/0006-owner-rules.sql). `query(sql, params)` is queryD1. The
 * file alone still works: without a token, or when D1 cannot be read, the
 * run says so and goes on with the file, because a missing extra id costs one
 * night while a stopped refresh costs every title.
 */
export async function loadKeepWithD1(query, env = process.env, say = console.warn) {
  const keep = loadKeep()
  if (!env.CLOUDFLARE_D1_TOKEN && !env.CLOUDFLARE_API_TOKEN) return keep
  try {
    const rows = await query(KEEP_READ, [], env)
    const merged = mergeKeep(keep, rows)
    const added = merged.media.length - keep.media.length
    if (added) console.log(`  keep list: ${added} more ids kept from /my-admin.`)
    return merged
  } catch (error) {
    say(`  keep list: the ids kept from /my-admin could not be read (${String(error.message || error).slice(0, 100)}); using data/keep.json only.`)
    return keep
  }
}

/** The ids the probe found plus the ones the keep list insists on. */
export function withKeptMedia(ids, keep) {
  return [...new Set([...ids, ...keep.media])]
}

/**
 * A character record in the same shape shape() builds, so the rest of the
 * pipeline cannot tell it apart from one that rode in on a title.
 */
export function keepCharacterRecord(node) {
  return {
    id: node.id,
    slug: slugify(node.name.full) + '-' + node.id,
    name: node.name.full,
    native: node.name.native || null,
    aliases: (node.name.alternative || []).filter(Boolean).slice(0, 3),
    image: node.image?.large || null,
    gender: node.gender || null,
    age: node.age || null,
    birthday: node.dateOfBirth?.month ? node.dateOfBirth.month + '/' + node.dateOfBirth.day : null,
    bloodType: node.bloodType || null,
    favourites: node.favourites ?? 0,
    description: cutBio((node.description || '').replace(/<[^>]+>/g, '').trim()),
  }
}

/**
 * Link one fetched character to every catalog title it appears in. Returns
 * how many titles gained the link. Titles already carrying the character
 * are left alone, so a rerun changes nothing.
 */
export function linkKeptCharacter(node, record, titleById) {
  let linked = 0
  for (const edge of node.media?.edges || []) {
    const media = edge.node
    if (!media || media.isAdult) continue
    const item = titleById.get(media.id)
    if (!item) continue
    item.characters = item.characters || []
    const isAnime = item.kind === 'anime'
    const voiceEn = isAnime ? voiceIn(edge.voiceActorRoles, 'English') : null
    const held = item.characters.find((c) => c.id === record.id)
    if (held) {
      // Already linked: only an English voice the row lacks is filled in, so a
      // rerun changes nothing else and the link count stays the same.
      if (voiceEn && !held.voiceEn) held.voiceEn = voiceEn
      continue
    }
    item.characters.push({
      id: record.id,
      slug: record.slug,
      name: record.name,
      image: record.image,
      role: edge.characterRole || 'BACKGROUND',
      voice: isAnime ? voiceIn(edge.voiceActorRoles, 'Japanese') : null,
      ...(voiceEn ? { voiceEn } : {}),
    })
    linked++
  }
  return linked
}
