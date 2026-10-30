/**
 * Instagram: the same post on the site's Instagram account, sent right after
 * the Facebook post went through (send.mjs). Facebook stays the main Page:
 * an Instagram failure is written down and said, and never stops or slows
 * the Facebook posts.
 *
 *   IG_POST_ENABLED  repo variable; Instagram is OFF unless it is 'true'.
 *                    'check' finds the account and says what it would post,
 *                    and posts nothing (the first pass after a new token)
 *   IG_USER_ID       secret, optional: the Instagram account's id. When unset
 *                    it is read from the Facebook Page (FB_PAGE_ID), which
 *                    also proves the account is linked to the Page
 *   IG_TOKEN         secret, optional: the FB_PAGE_TOKEN is used when unset
 *                    (it works once it has instagram_basic and
 *                    instagram_content_publish)
 *   IG_POSTS_PER_DAY repo variable: posts in any 24 hours (8 when unset, 25
 *                    at most, Instagram's own limit), spread evenly
 *   IG_POST_TYPES    repo variable, optional: only these kinds go to
 *                    Instagram (classic, where, fanart, reel...); every kind
 *                    Facebook posts when unset
 *
 * How a picture gets there: Instagram fetches a picture by its address, it
 * takes no upload. The picture is made for Instagram (its own "link in bio"
 * wording, fitted inside 4:5 to 1.91:1), kept on the Facebook Page as an
 * unpublished photo (hidden, never in the feed) and Instagram is handed that
 * photo's address.
 *
 * How a reel gets there: the MP4 made for Facebook, sent with the resumable
 * upload (no public address needed): POST /{ig-id}/media with
 * media_type=REELS, upload_type=resumable -> a container id and an upload
 * address on rupload.facebook.com -> the bytes to that address -> wait until
 * the container is FINISHED -> media_publish. Instagram takes reels of 3
 * seconds to 15 minutes; ours are 1080x1920 (9:16).
 *
 * Links in an Instagram caption cannot be clicked, so the line about the
 * first comment becomes "Link in bio".
 *
 * Checked against Meta's docs on 13 Oct 2026 (Instagram Platform, Content
 * Publishing: a container, its status, then media_publish; at most 100
 * posts by the API in 24 hours).
 */
import { graphCaller, GraphError, redact, GRAPH_VERSION, UPLOAD_HOST } from './fb.mjs'
import { settle } from './ledger.mjs'
import { DAY_MS } from './pace.mjs'
import { SITE } from './site.mjs'

export const IG_DEFAULT_PER_DAY = 8
export const IG_MAX_PER_DAY = 25
/** The shapes Instagram takes for a picture post (width / height). */
export const RATIO = { min: 4 / 5, max: 1.91 }
/** The widest picture Instagram keeps. */
const MAX_WIDTH = 1440
/** A post may go a little before its even slot, so the day's cap is reached. */
const EARLY = 0.8
const POLL = { tries: 12, everyMs: 5_000 }
/** Instagram needs a while to make a video ready: every 10 seconds, for up to 10 minutes. */
const REEL_POLL = { tries: 60, everyMs: 10_000 }
/** The pictures a swipe post (carousel) takes. */
export const CAROUSEL_ITEMS = { min: 2, max: 10 }
/** The reel lengths Instagram takes, in seconds. */
export const REEL_SECONDS = { min: 3, max: 15 * 60 }

const int = (v) => {
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function igSettingsOf(env) {
  const userId = String(env.IG_USER_ID || '').trim()
  const pageId = String(env.FB_PAGE_ID || '').trim()
  const token = env.IG_TOKEN || env.FB_PAGE_TOKEN || ''
  const types = String(env.IG_POST_TYPES || '')
    .split(/[\s,]+/)
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
  return {
    enabled: env.IG_POST_ENABLED === 'true' || env.IG_POST_ENABLED === 'check',
    checkOnly: env.IG_POST_ENABLED === 'check',
    configured: Boolean((userId || pageId) && token),
    userId,
    pageId,
    token,
    perDay: Math.min(int(env.IG_POSTS_PER_DAY) || IG_DEFAULT_PER_DAY, IG_MAX_PER_DAY),
    types: types.length ? new Set(types) : null,
  }
}

export function igClient({ userId = '', pageId = '', token, fetch = globalThis.fetch, version = GRAPH_VERSION }) {
  if ((!userId && !pageId) || !token) throw new Error('igClient needs an Instagram account id or a Page id, and a token')
  const { call } = graphCaller({ token, fetch, version })
  let igId = userId

  /** Wait until Instagram has made the container ready; `what` names it in the errors. */
  async function waitReady(id, { what, sleep, tries, everyMs }) {
    for (let i = 0; i < tries; i += 1) {
      const { status_code: code, status } = await call('GET', `/${id}`, { fields: 'status_code,status' })
      if (code === 'ERROR' || code === 'EXPIRED') throw new GraphError(`Instagram could not take the ${what}: ${status || code}`)
      if (code === 'FINISHED' || code === 'PUBLISHED') return
      if (sleep) await sleep(everyMs)
    }
    throw new GraphError(`Instagram was still preparing the ${what} when the wait ran out`)
  }

  async function publishContainer(id) {
    const posted = await call('POST', `/${igId}/media_publish`, { creation_id: id })
    if (!posted.id) throw new GraphError('Instagram gave no media id')
    return { mediaId: posted.id }
  }

  /** The video bytes to the upload address. The token goes only to Facebook's upload host. */
  async function upload(id, given, bytes) {
    const safe = (() => {
      try {
        return new URL(given).host === UPLOAD_HOST ? given : null
      } catch {
        return null
      }
    })()
    const url = safe || `https://${UPLOAD_HOST}/ig-api-upload/${version}/${id}`
    let res
    try {
      res = await fetch(url, { method: 'POST', headers: { Authorization: `OAuth ${token}`, offset: '0', file_size: String(bytes.length), 'content-type': 'application/octet-stream' }, body: bytes })
    } catch (error) {
      throw new GraphError(redact(`network error on the Instagram reel upload: ${error.message}`, token))
    }
    const json = await res.json().catch(() => null)
    if (!res.ok || !json || json.error || json.success === false) {
      const e = json?.error || {}
      throw new GraphError(redact(`the Instagram reel upload failed: ${e.message || `HTTP ${res.status}`}`, token), { status: res.status, code: Number(e.code) || 0, subcode: Number(e.error_subcode) || 0, type: e.type || '' })
    }
  }

  return {
    /**
     * The account: { id, username }. With a Page id it is read from the Page
     * (GET /{page-id}?fields=instagram_business_account{id,username}), which
     * also proves the two are linked.
     */
    async account() {
      if (!pageId) return { id: igId, username: (await call('GET', `/${igId}`, { fields: 'username' })).username || '' }
      const linked = (await call('GET', `/${pageId}`, { fields: 'instagram_business_account{id,username}' })).instagram_business_account
      if (!linked?.id) throw new GraphError('no Instagram account is linked to the Facebook Page (instagram_business_account is empty)')
      if (userId && userId !== linked.id) throw new GraphError(`IG_USER_ID (${userId}) is not the account linked to the Page (${linked.id})`)
      igId = linked.id
      return { id: igId, username: linked.username || '' }
    },
    /** A picture post: the container, a wait until Instagram has the picture, then the post. */
    async publish({ imageUrl, caption, sleep, tries = POLL.tries, everyMs = POLL.everyMs }) {
      const { id } = await call('POST', `/${igId}/media`, { image_url: imageUrl, caption })
      if (!id) throw new GraphError('Instagram gave no container id')
      await waitReady(id, { what: 'picture', sleep, tries, everyMs })
      return publishContainer(id)
    },
    /**
     * A swipe post: one container per picture (is_carousel_item), a wait
     * until Instagram has them, the carousel container, then the post.
     */
    async publishCarousel({ imageUrls, caption, sleep, tries = POLL.tries, everyMs = POLL.everyMs }) {
      if (imageUrls.length < CAROUSEL_ITEMS.min || imageUrls.length > CAROUSEL_ITEMS.max) throw new GraphError(`a swipe post takes ${CAROUSEL_ITEMS.min} to ${CAROUSEL_ITEMS.max} pictures, not ${imageUrls.length}`)
      const children = []
      for (const url of imageUrls) {
        const { id } = await call('POST', `/${igId}/media`, { image_url: url, is_carousel_item: 'true' })
        if (!id) throw new GraphError('Instagram gave no container id for a slide')
        children.push(id)
      }
      for (const id of children) await waitReady(id, { what: 'picture', sleep, tries, everyMs })
      const { id } = await call('POST', `/${igId}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption })
      if (!id) throw new GraphError('Instagram gave no container id for the swipe post')
      await waitReady(id, { what: 'swipe post', sleep, tries, everyMs })
      return publishContainer(id)
    },
    /** A reel by resumable upload: the container, the bytes, a wait until Instagram has the video, then the post. */
    async publishReel({ bytes, caption, sleep, tries = REEL_POLL.tries, everyMs = REEL_POLL.everyMs }) {
      if (!bytes?.length) throw new GraphError('publishReel needs the video bytes')
      const made = await call('POST', `/${igId}/media`, { media_type: 'REELS', upload_type: 'resumable', caption, share_to_feed: 'true' })
      if (!made.id) throw new GraphError('Instagram gave no container id')
      await upload(made.id, made.uri, bytes)
      await waitReady(made.id, { what: 'video', sleep, tries, everyMs })
      return publishContainer(made.id)
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

/** Why a reel of this length cannot go to Instagram, or null when it can. */
export function reelLengthProblem(seconds) {
  if (!Number.isFinite(seconds)) return null
  if (seconds < REEL_SECONDS.min) return `the reel is ${seconds} s; Instagram needs at least ${REEL_SECONDS.min} s`
  if (seconds > REEL_SECONDS.max) return `the reel is ${Math.round(seconds / 60)} min; Instagram takes 15 min at most`
  return null
}

/**
 * Send one post to Instagram, after its Facebook post. Never throws: the
 * outcome is written on the ledger entry (`ig`) and said in the summary.
 * @param ig { settings, client, off } from post.mjs; `off` set means not for the rest of this run
 * @param image { make } (() => the bytes of a picture drawn for Instagram) or { url } (a cover)
 * @param video { bytes, seconds }: a reel, sent in place of a picture
 * @param slides { make } (() => the JPEGs of a swipe post, hook first, or null): sent in place of the picture when it gives some
 */
export async function crossPost({ ig, graph, book, entry, history, now, out, caption, image, video = null, slides = null, sleep, fetch = globalThis.fetch, loadSharp = defaultSharp }) {
  if (!ig || ig.off) return null
  const why = igWhyNot({ settings: ig.settings, history, now, entry }) || (video ? reelLengthProblem(video.seconds) : null)
  if (why) {
    out.push(`Instagram: not this one (${why}).`, '')
    return null
  }
  if (ig.settings.checkOnly) {
    out.push(`Instagram: check only (IG_POST_ENABLED is 'check'): would post this ${video ? 'reel' : 'post'} now. Nothing was sent.`, '')
    return null
  }
  // The slides are drawn first: a swipe post that cannot be drawn goes as one picture, as before.
  const jpegs = slides ? await slides.make().catch((error) => (out.push(`Instagram: the swipe post could not be drawn (${error.message}); one picture instead.`, ''), null)) : null
  try {
    const sendSlides = async () => {
      const imageUrls = []
      for (const bytes of jpegs) imageUrls.push(await graph.photoUrl((await graph.hostPhoto({ bytes })).photoId))
      return ig.client.publishCarousel({ imageUrls, caption: igCaption(caption), sleep })
    }
    const sendPicture = async () => {
      const sharp = await loadSharp()
      const fitted = await fitImage(await bytesOf(image, fetch), { sharp, background: await backgroundOf() })
      const { photoId } = await graph.hostPhoto({ bytes: fitted })
      const imageUrl = await graph.photoUrl(photoId)
      return ig.client.publish({ imageUrl, caption: igCaption(caption), sleep })
    }
    const swipe = jpegs?.length >= CAROUSEL_ITEMS.min
    const { mediaId } = video ? await ig.client.publishReel({ bytes: video.bytes, caption: igCaption(caption), sleep }) : swipe ? await sendSlides() : await sendPicture()
    await settle(book, entry.key, { ig: { id: mediaId, at: now, ...(swipe ? { slides: jpegs.length } : {}) } })
    out.push(`Instagram: posted ${video ? 'reel ' : swipe ? `swipe post (${jpegs.length} slides) ` : ''}${mediaId}.`, '')
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
  if (why) return `Instagram: would not post this one (${why}).`
  return `Instagram: would also post this${entry.reel ? ' reel' : ''}, with "${BIO_LINE}" in place of the line about the first comment.`
}

const defaultSharp = async () => (await import('sharp')).default
