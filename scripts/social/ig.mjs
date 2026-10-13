/**
 * Instagram: the same post on the site's Instagram account, sent right after
 * the Facebook post went through (send.mjs). Facebook stays the main Page:
 * an Instagram failure is written down and said, and never stops or slows
 * the Facebook posts.
 *
 *   IG_POST_ENABLED  repo variable; Instagram is OFF unless it is 'true'
 *   IG_USER_ID       secret: the Instagram account's id (Business or Creator,
 *                    linked to the Facebook Page)
 *   IG_TOKEN         secret, optional: the FB_PAGE_TOKEN is used when unset
 *                    (it works once it has instagram_basic and
 *                    instagram_content_publish)
 *   IG_POSTS_PER_DAY repo variable: posts in any 24 hours (8 when unset, 50
 *                    at most), spread evenly
 *   IG_POST_TYPES    repo variable, optional: only these kinds go to
 *                    Instagram (classic, where, fanart...); every kind
 *                    Facebook posts when unset. Reels never, for now.
 *
 * How a picture gets there: Instagram fetches a picture by its address, it
 * takes no upload. The picture is made for Instagram (its own "link in bio"
 * wording, fitted inside 4:5 to 1.91:1), kept on the Facebook Page as an
 * unpublished photo (hidden, never in the feed) and Instagram is handed that
 * photo's address.
 *
 * Links in an Instagram caption cannot be clicked, so the line about the
 * first comment becomes "Link in bio".
 *
 * Checked against Meta's docs on 13 Oct 2026 (Instagram Platform, Content
 * Publishing: a container, its status, then media_publish; at most 100
 * posts by the API in 24 hours).
 */
import { graphCaller, GraphError } from './fb.mjs'
import { settle } from './ledger.mjs'
import { DAY_MS } from './pace.mjs'
import { SITE } from './site.mjs'

export const IG_DEFAULT_PER_DAY = 8
export const IG_MAX_PER_DAY = 50
/** The shapes Instagram takes for a picture post (width / height). */
export const RATIO = { min: 4 / 5, max: 1.91 }
/** The widest picture Instagram keeps. */
const MAX_WIDTH = 1440
/** A post may go a little before its even slot, so the day's cap is reached. */
const EARLY = 0.8
const POLL = { tries: 12, everyMs: 5_000 }

const int = (v) => {
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function igSettingsOf(env) {
  const userId = String(env.IG_USER_ID || '').trim()
  const token = env.IG_TOKEN || env.FB_PAGE_TOKEN || ''
  const types = String(env.IG_POST_TYPES || '')
    .split(/[\s,]+/)
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
  return {
    enabled: env.IG_POST_ENABLED === 'true',
    configured: Boolean(userId && token),
    userId,
    token,
    perDay: Math.min(int(env.IG_POSTS_PER_DAY) || IG_DEFAULT_PER_DAY, IG_MAX_PER_DAY),
    types: types.length ? new Set(types) : null,
  }
}

export function igClient({ userId, token, fetch = globalThis.fetch, version }) {
  if (!userId || !token) throw new Error('igClient needs an Instagram account id and a token')
  const { call } = graphCaller({ token, fetch, version })
  return {
    async username() {
      return (await call('GET', `/${userId}`, { fields: 'username' })).username || ''
    },
    /** A picture post: the container, a wait until Instagram has the picture, then the post. */
    async publish({ imageUrl, caption, sleep, tries = POLL.tries, everyMs = POLL.everyMs }) {
      const { id } = await call('POST', `/${userId}/media`, { image_url: imageUrl, caption })
      if (!id) throw new GraphError('Instagram gave no container id')
      let ready = false
      for (let i = 0; i < tries && !ready; i += 1) {
        const { status_code: code, status } = await call('GET', `/${id}`, { fields: 'status_code,status' })
        if (code === 'ERROR' || code === 'EXPIRED') throw new GraphError(`Instagram could not take the picture: ${status || code}`)
        ready = code === 'FINISHED' || code === 'PUBLISHED'
        if (!ready && sleep) await sleep(everyMs)
      }
      if (!ready) throw new GraphError('Instagram was still preparing the picture when the wait ran out')
      const posted = await call('POST', `/${userId}/media_publish`, { creation_id: id })
      return { mediaId: posted.id }
    },
  }
}

/** The address readers are sent to, without "https://". */
const DOMAIN = SITE.origin.replace(/^https?:\/\//, '')
export const BIO_LINE = `🔗 Link in bio: ${DOMAIN}`

/** The Facebook caption for Instagram: the line about the first comment becomes "Link in bio". */
export function igCaption(caption) {
  return String(caption)
    .split('\n\n')
    .map((part) => (/^👇/.test(part) ? BIO_LINE : part))
    .join('\n\n')
    .replace(/, credited in the first comment\./g, '.')
}

/** The line drawn on a template picture, for Instagram (render/parts.mjs `words`). */
export const igWords = (text) =>
  String(text)
    .replace(/the link is in the first comment/i, 'link in bio')
    .replace(/link in the first comment/i, 'link in bio')

/** The kind of a ledger entry or a plan: 'classic', a type key, or 'reel'. */
const kindOf = ({ type, reel }) => (reel ? 'reel' : type || 'classic')

/** Why this post does not go to Instagram now, or null when it does. */
export function igWhyNot({ settings, history, now, entry }) {
  const kind = kindOf(entry)
  if (kind === 'reel') return 'reels are not sent to Instagram'
  if (settings.types && !settings.types.has(kind)) return `${kind} is not on IG_POST_TYPES`
  const tried = history.filter((e) => e.ig?.at && e.ig.at > now - DAY_MS)
  if (tried.filter((e) => e.ig.id).length >= settings.perDay) return `${settings.perDay} Instagram posts in the last 24 hours`
  const last = Math.max(0, ...tried.map((e) => e.ig.at))
  const spacing = (DAY_MS / settings.perDay) * EARLY
  if (now - last < spacing) return `the last one was ${Math.round((now - last) / 60_000)} minutes ago`
  return null
}

/** The size of the frame a picture of this size is placed in for Instagram, or null when it fits as it is. */
export function frameOf(width, height) {
  const ratio = width / height
  if (ratio < RATIO.min - 1e-3) return { width: Math.ceil(height * RATIO.min), height }
  if (ratio > RATIO.max + 1e-3) return { width, height: Math.ceil(width / RATIO.max) }
  return null
}

/** The picture as a JPEG Instagram takes: whole, on the page colour when it needs room round it, at most MAX_WIDTH wide. */
export async function fitImage(bytes, { sharp, background = '#000000' }) {
  const meta = await sharp(bytes).metadata()
  const frame = frameOf(meta.width, meta.height) || { width: meta.width, height: meta.height }
  const scale = Math.min(1, MAX_WIDTH / frame.width)
  const width = Math.round(frame.width * scale)
  const height = Math.round(frame.height * scale)
  return sharp(bytes).resize({ width, height, fit: 'contain', background }).flatten({ background }).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer()
}

/** The background a picture is fitted on: the site's night colour. */
async function backgroundOf() {
  try {
    return (await import('./theme.mjs')).THEME.color.night
  } catch {
    return '#000000'
  }
}

/** The picture for Instagram: bytes made for it, or the bytes at an address. */
async function bytesOf(image, fetch) {
  if (image.make) return image.make()
  if (image.bytes) return image.bytes
  const res = await fetch(image.url, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`the picture could not be fetched (HTTP ${res.status})`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * Send one post to Instagram, after its Facebook post. Never throws: the
 * outcome is written on the ledger entry (`ig`) and said in the summary.
 * @param ig { settings, client, off } from post.mjs; `off` set means not for the rest of this run
 * @param image { make } (() => the bytes of a picture drawn for Instagram) or { url } (a cover)
 */
export async function crossPost({ ig, graph, book, entry, history, now, out, caption, image, sleep, fetch = globalThis.fetch, loadSharp = defaultSharp }) {
  if (!ig || ig.off) return null
  const why = igWhyNot({ settings: ig.settings, history, now, entry })
  if (why) {
    out.push(`Instagram: not this one (${why}).`, '')
    return null
  }
  try {
    const sharp = await loadSharp()
    const fitted = await fitImage(await bytesOf(image, fetch), { sharp, background: await backgroundOf() })
    const { photoId } = await graph.hostPhoto({ bytes: fitted })
    const imageUrl = await graph.photoUrl(photoId)
    const { mediaId } = await ig.client.publish({ imageUrl, caption: igCaption(caption), sleep })
    await settle(book, entry.key, { ig: { id: mediaId, at: now } })
    out.push(`Instagram: posted ${mediaId}.`, '')
    return mediaId
  } catch (error) {
    await settle(book, entry.key, { ig: { error: error.message, at: now } }).catch(() => null)
    if (error instanceof GraphError && error.isAuth) ig.off = 'the Instagram token was refused'
    out.push(`Instagram: **failed** (${error.message}).${ig.off ? ' No more Instagram posts this run: check IG_USER_ID and the token (docs/facebook-posting.md, Instagram).' : ''} Facebook is not affected.`, '')
    return null
  }
}

/** What a dry run says about Instagram for one post. */
export function igDryLine({ ig, history, now, entry }) {
  if (!ig) return null
  const why = igWhyNot({ settings: ig.settings, history, now, entry })
  return why ? `Instagram: would not post this one (${why}).` : `Instagram: would also post this, with "${BIO_LINE}" in place of the line about the first comment.`
}

const defaultSharp = async () => (await import('sharp')).default
