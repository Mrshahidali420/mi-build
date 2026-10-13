/**
 * Danbooru (danbooru.donmai.us): fan art of one character, and cosplay
 * photos, through its public JSON API. No key. Only posts rated general or
 * sensitive are asked for (`rating:g,s`), and art/safe.mjs checks every one again.
 *
 *   GET /tags.json?search[name_comma]=<a>,<b>&search[category]=4
 *       a character's tag by the ways its name may be written
 *       ("kamado_tanjirou", "tanjirou_kamado"); the alias search times out
 *   GET /posts.json?tags=<character> rating:g,s&limit=N
 *       that character's posts, newest first
 *   GET /posts.json?tags=cosplay_photo rating:g,s&limit=N&page=P
 *       photos of people in costume, each tagged with the character and
 *       the series they play
 *
 * Every post comes back in the common shape of art/ (toItem), with the
 * artist and the original address for the credit line.
 */
export const HOST = 'https://danbooru.donmai.us'
const TIMEOUT_MS = 15_000
/** Danbooru (and its picture host) refuse a request with no user agent. */
export const USER_AGENT = 'page-poster/1.0 (Facebook Page of an anime and manga site)'
const HEADERS = { accept: 'application/json', 'user-agent': USER_AGENT }
/** A character tag with fewer posts than this is too thin (or the wrong person). */
export const MIN_TAG_POSTS = 30
/** Pictures smaller than this on their short side look soft on a 1080 px post. */
export const MIN_SIDE = 700
const PICTURE = /\.(jpe?g|png|webp)$/i
/** The original file is used up to this size; a bigger one is taken as Danbooru's 850 px sample (the host is slow). */
const ORIGINAL_MAX = { bytes: 2_500_000, side: 4000 }

/** "kamado_tanjirou" -> "Kamado Tanjirou", "frieren" -> "Frieren" (a series suffix is dropped). */
export const tagName = (tag) => String(tag || '').replace(/_\([^)]*\)$/, '').split('_').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

const words = (text) => String(text || '').split(' ').filter(Boolean)

/**
 * Where the picture was first posted, as a page a reader can open: a pixiv
 * file address (which pixiv refuses outside its own pages) becomes the
 * artwork's page; anything that is not a web address gives null.
 */
export function originalOf(post) {
  const source = String(post?.source || '')
  if (!/^https?:\/\//.test(source)) return null
  if (/^https?:\/\/i\.pximg\.net\//.test(source)) return post.pixiv_id ? `https://www.pixiv.net/artworks/${post.pixiv_id}` : null
  return source
}

/**
 * Sites an artist posts on, whose links Facebook carries. Any other address
 * (an image board such as yande.re, which Facebook refuses as against its
 * Community Standards, or Danbooru itself) is never linked: the credit is
 * the artist's name alone.
 */
const ARTIST_HOSTS = /^https?:\/\/([a-z0-9-]+\.)*(pixiv\.net|fanbox\.cc|x\.com|twitter\.com|artstation\.com|deviantart\.com|instagram\.com|bsky\.app|reddit\.com|tumblr\.com|skeb\.jp|youtube\.com)(\/|$)/i

/** The original address when Facebook will carry it, else null. */
export const creditUrl = (url) => (url && ARTIST_HOSTS.test(url) ? url : null)

/** One Danbooru post in the common shape, or null when it is not a usable still picture. */
export function toItem(post) {
  if (!post?.id || !post.md5) return null
  const small = (post.file_size || Infinity) <= ORIGINAL_MAX.bytes && Math.max(post.image_width, post.image_height) <= ORIGINAL_MAX.side
  const file = post.file_url && PICTURE.test(post.file_url) && small ? post.file_url : post.large_file_url
  if (!file || !PICTURE.test(file) || Math.min(post.image_width || 0, post.image_height || 0) < MIN_SIDE) return null
  const page = `${HOST}/posts/${post.id}`
  const original = originalOf(post)
  const artist = words(post.tag_string_artist).filter((a) => !/^(banned_artist|artist_request|unknown_artist)$/.test(a))[0]
  return {
    source: 'danbooru',
    id: `danbooru:${post.id}`,
    // The original artwork: the same picture posted twice keeps its source address (and often its md5).
    hash: post.md5,
    original,
    image: file,
    width: post.image_width,
    height: post.image_height,
    rating: post.rating || null,
    flagged: Boolean(post.is_deleted || post.is_banned || post.is_pending || post.is_flagged || post.parent_id),
    tags: [...words(post.tag_string_general), ...words(post.tag_string_meta)],
    text: '',
    characters: words(post.tag_string_character),
    series: words(post.tag_string_copyright),
    artist: artist ? tagName(artist) : null,
    page,
    credit: artist ? { name: tagName(artist), url: creditUrl(original) } : null,
    score: post.score || 0,
  }
}

async function get(path, { fetch = globalThis.fetch } = {}) {
  const res = await fetch(`${HOST}${path}`, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Danbooru answered ${res.status}`)
  const json = await res.json()
  if (!Array.isArray(json)) throw new Error('Danbooru sent something other than a list')
  return json
}

/** The ways a name may be written as a tag: as given, and family name first. */
export function tagVariants(name) {
  const parts = String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').split(/\s+/).filter(Boolean)
  if (!parts.length) return []
  const forward = parts.join('_')
  const reverse = parts.length === 2 ? `${parts[1]}_${parts[0]}` : null
  return [...new Set([forward, reverse].filter(Boolean))]
}

/** A character's tag, or null: the best-used character tag among the ways the name is written. */
export async function characterTag(name, options = {}) {
  const variants = tagVariants(name)
  if (!variants.length) return null
  const tags = await get(`/tags.json?search[name_comma]=${encodeURIComponent(variants.join(','))}&search[category]=4&limit=5`, options)
  const best = tags.filter((tag) => !tag.is_deprecated && tag.post_count >= MIN_TAG_POSTS).sort((x, y) => y.post_count - x.post_count)[0]
  return best?.name || null
}

/** A character's general-rated posts, in the common shape. */
export async function characterPosts(tag, { limit = 40, ...options } = {}) {
  return (await get(`/posts.json?tags=${encodeURIComponent(`${tag} rating:g,s`)}&limit=${limit}`, options)).map(toItem).filter(Boolean)
}

/** One page of general-rated cosplay photos, in the common shape. */
export async function cosplayPosts({ page = 1, limit = 100, ...options } = {}) {
  return (await get(`/posts.json?tags=${encodeURIComponent('cosplay_photo rating:g,s')}&limit=${limit}&page=${page}`, options)).map(toItem).filter(Boolean)
}
