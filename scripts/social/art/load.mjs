/**
 * The pictures the fan art and cosplay posts can use this hour, matched to
 * titles that have a page on this site (types/art-card.mjs).
 *
 *   fan art   a few lead characters of popular titles, a different few each
 *             hour: each name is looked up as a Danbooru character tag, and
 *             that character's general-rated posts are kept when one of
 *             their series tags is the title's own name
 *   cosplay   one page of Danbooru's general-rated cosplay photos, a
 *             different page each hour, kept when the series it shows is a
 *             title on this site
 *
 * Every picture passes art/safe.mjs. An ecchi-leaning one (safe.mjs
 * ecchiOf) is offered only when none of the last ECCHI_EVERY - 1 art posts
 * was one, so they stay at one art post in four. None the Page has ever posted
 * (ledger `artSeen`: the source id and the md5 of every picture posted, kept
 * beyond the ledger's 90 days) comes back. A source that fails gives no
 * pictures this hour and nothing else.
 */
import { characterPosts, characterTag, cosplayPosts } from './danbooru.mjs'
import { ecchiOf, isSafe } from './safe.mjs'

/** Lead characters looked up each hour, and the titles they come from. */
export const PER_HOUR = 4
/** Cosplay pages taken in turn (100 photos each). */
export const COSPLAY_PAGES = 8
/** At most this many pictures are kept per character. */
const PER_CHARACTER = 3
/** Pictures the Page has posted, remembered by id and md5: plenty for years. */
export const SEEN_MAX = 4000
const HOUR_MS = 3_600_000
const SAVE_TRIES = 4
export const ART_TYPES = new Set(['fanart', 'cosplay'])
/** At most one ecchi-leaning picture in this many art posts. */
export const ECCHI_EVERY = 4

/** True when the last ECCHI_EVERY - 1 art posts of this Page held no ecchi-leaning picture. */
export function ecchiAllowed(ledger, page) {
  const art = (ledger?.entries || []).filter((e) => ART_TYPES.has(e.type) && e.status !== 'dry' && (!page || e.page === page)).sort((x, y) => x.at - y.at)
  return !art.slice(-(ECCHI_EVERY - 1)).some((e) => e.ecchi)
}

/** "Sousou no Frieren", "sousou_no_frieren" and "SOUSOU NO FRIEREN!" are the same name. */
export const plain = (text) => String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/** The ways a title is written (its name and its other name), plain, without short ones. */
const namesOf = (title) => [title.title, title.alt].map(plain).filter((name) => name.length >= 4)

/** True when one of a picture's series tags is this title (or the title is a longer name of it). */
export function sameSeries(series, title) {
  const names = namesOf(title)
  return series.map(plain).some((tag) => tag.length >= 4 && names.some((name) => name === tag || name.startsWith(tag) || tag.startsWith(name)))
}

/** The titles a picture of `series` may link to: the most popular title of the site that is that series. */
export function titleFor(series, titles) {
  return titles.find((title) => sameSeries(series, title)) || null
}

/** Every picture id and md5 the Page has posted: the kept list, and the art posts the ledger still holds. */
export function seenOf(ledger) {
  const seen = new Set(ledger?.artSeen || [])
  for (const e of ledger?.entries || []) if (ART_TYPES.has(e.type) && e.status !== 'dry') for (const key of [e.item, e.hash]) if (key) seen.add(key)
  return seen
}

/** Write the posted pictures into the kept list, so they stay seen after the ledger forgets the post. */
async function keepSeen(book, seen) {
  for (let i = 0; i < SAVE_TRIES; i += 1) {
    const { data, version } = await book.read()
    const known = new Set(data.artSeen || [])
    if ([...seen].every((key) => known.has(key))) return
    if (await book.write({ ...data, artSeen: [...new Set([...(data.artSeen || []), ...seen])].slice(-SEEN_MAX) }, version, 'Art seen')) return
  }
}

const fresh = (seen, ecchi) => (item) => isSafe(item) && !seen.has(item.id) && !seen.has(item.hash) && (ecchi || !ecchiOf(item))

/** The characters whose turn it is this hour: [{ title, member }]. */
export function charactersFor(titles, now, perHour = PER_HOUR) {
  const all = titles.flatMap((title) => (title.cast || []).slice(0, 2).map((member) => ({ title, member })))
  if (!all.length) return []
  const start = (Math.floor(now / HOUR_MS) * perHour) % all.length
  return Array.from({ length: Math.min(perHour, all.length) }, (_, i) => all[(start + i) % all.length])
}

async function fanart(titles, now, { seen, ecchi }, options) {
  const out = []
  for (const { title, member } of charactersFor(titles, now)) {
    // One character the source cannot answer for does not cost the others.
    const tag = await characterTag(member.name, options).catch(() => null)
    if (!tag) continue
    // Only pictures of that character alone: the post is about them, not a crowd they stand in.
    const posts = (await characterPosts(tag, options).catch(() => [])).filter((item) => item.characters.length === 1 && item.characters[0] === tag).filter(fresh(seen, ecchi)).filter((item) => sameSeries(item.series, title))
    for (const item of posts.sort((x, y) => y.score - x.score).slice(0, PER_CHARACTER)) out.push({ ...item, ecchi: ecchiOf(item), title, character: member.name })
  }
  return out
}

async function cosplay(titles, now, { seen, ecchi }, options) {
  const page = (Math.floor(now / HOUR_MS) % COSPLAY_PAGES) + 1
  return (await cosplayPosts({ page, ...options }))
    .filter(fresh(seen, ecchi))
    .map((item) => ({ item, title: titleFor(item.series, titles) }))
    .filter(({ item, title }) => title && item.characters.length === 1)
    .map(({ item, title }) => ({ ...item, ecchi: ecchiOf(item), title, character: null }))
}

/**
 * The pictures of this hour: { fanart: [...], cosplay: [...] }, each item in
 * the common shape with its `title` (a title of this site) and `character`.
 * @param titles the titles a picture may link to, most popular first
 * @param wants which of the two kinds are switched on
 */
export async function loadArt({ book, now, titles, wants, page = null, fetch = globalThis.fetch, say = () => {} }) {
  const out = { fanart: [], cosplay: [] }
  let seen = new Set()
  let ecchi = false
  try {
    const ledger = (await book.read()).data
    seen = seenOf(ledger)
    ecchi = ecchiAllowed(ledger, page)
    await keepSeen(book, seen)
  } catch (error) {
    say(`The list of pictures already posted could not be read (${error.message}). No fan art or cosplay this hour.`)
    return out
  }
  for (const [kind, load] of [['fanart', fanart], ['cosplay', cosplay]]) {
    if (!wants.has(kind)) continue
    try {
      out[kind] = await load(titles, now, { seen, ecchi }, { fetch })
    } catch (error) {
      say(`${kind === 'fanart' ? 'Fan art' : 'Cosplay photos'} could not be read (${error.message}). None this hour.`)
    }
  }
  say(`Pictures this hour: ${out.fanart.length} fan art, ${out.cosplay.length} cosplay (rated general or sensitive, checked for nudity and minors${ecchi ? '' : '; no ecchi-leaning picture until three plain ones have gone out'}).`)
  return out
}
