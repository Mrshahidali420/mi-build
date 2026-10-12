/**
 * The Facebook Graph API client for the Page poster. Three calls, nothing else:
 *
 *   GET  /{page-id}?fields=name          token health check
 *   POST /{page-id}/photos  url, caption  a photo post; returns { id, post_id }
 *   POST /{page-id}/photos  source, caption  the same, with the image sent as a
 *                                         multipart file (a template image)
 *   POST /{page-id}/feed    message       a text post (no image); returns { id }
 *   POST /{post-id}/comments message      the link, as the first comment
 *
 * A reel (Reels Publishing API, read 12 Oct 2026) takes three calls:
 *   POST /{page-id}/video_reels upload_phase=start      -> video_id, upload_url
 *   POST rupload.facebook.com/video-upload/{v}/{video-id}  the file, with the
 *        token in an Authorization header (the only place it leaves the body)
 *   POST /{page-id}/video_reels upload_phase=finish, video_state=PUBLISHED,
 *        description
 * and GET /{video-id}?fields=status says when Facebook has finished with it.
 * Facebook allows 30 reels published by API in 24 hours; the poster's own
 * ceiling is far under that (attempt.mjs).
 *
 * Checked against Meta's docs on 12 Oct 2026 (Graph API v26.0, Page Photos,
 * Pages API Posts, Object Comments). `message` on /photos is deprecated in
 * favour of `caption`.
 *
 * Every answer's usage headers (x-app-usage, x-page-usage,
 * x-business-use-case-usage) are read, and the highest percentage seen is
 * kept: usage() hands it to the limit watch (limits.mjs).
 *
 * The token travels in the POST body (or the GET query) and is never logged:
 * every error message is passed through redact() before it leaves this file.
 * `fetch` is injectable so the tests need no network.
 */

/** The one place the Graph API version lives. */
export const GRAPH_VERSION = 'v26.0'
export const GRAPH_HOST = 'https://graph.facebook.com'
/** The only host a reel file, and with it the token in a header, is ever sent to. */
export const UPLOAD_HOST = 'rupload.facebook.com'
const REEL_POLL = { tries: 18, everyMs: 10_000 }

export class GraphError extends Error {
  constructor(message, { status = 0, code = 0, subcode = 0, type = '' } = {}) {
    super(message)
    this.name = 'GraphError'
    this.status = status
    this.code = code
    this.subcode = subcode
    this.type = type
  }

  /** A dead, expired or under-permissioned token: the owner has to act. */
  get isAuth() {
    return this.code === 190 || this.type === 'OAuthException' || this.status === 401
  }
}

const USAGE_HEADERS = ['x-app-usage', 'x-page-usage', 'x-business-use-case-usage']
const USAGE_FIELDS = ['call_count', 'total_cputime', 'total_time']

/** The highest percentage inside one usage header's JSON (a flat object, or lists of them by id). */
function highest(value) {
  if (Array.isArray(value)) return Math.max(0, ...value.map(highest))
  if (!value || typeof value !== 'object') return 0
  const own = USAGE_FIELDS.map((field) => Number(value[field]) || 0)
  const nested = Object.values(value).filter((v) => v && typeof v === 'object').map(highest)
  return Math.max(0, ...own, ...nested)
}

/** How much of the call budget an answer reports: { pct, source }, or null when it sent no usage header. */
export function usageOf(headers) {
  let best = null
  for (const name of USAGE_HEADERS) {
    const raw = headers?.get?.(name)
    if (!raw) continue
    try {
      const pct = highest(JSON.parse(raw))
      if (!best || pct > best.pct) best = { pct, source: name }
    } catch {
      // A header that is not JSON says nothing.
    }
  }
  return best
}

const redact = (text, token) => (token ? String(text).split(token).join('***') : String(text))

export function graphClient({ pageId, token, fetch = globalThis.fetch, version = GRAPH_VERSION }) {
  if (!pageId || !token) throw new Error('graphClient needs a page id and a token')
  const base = `${GRAPH_HOST}/${version}`
  let peak = null

  /** A multipart body: the fields, the token and one file (`source`). */
  function multipart(params, file) {
    const form = new FormData()
    for (const [name, value] of Object.entries({ ...params, access_token: token })) form.append(name, String(value))
    form.append('source', new Blob([file.bytes], { type: file.contentType }), file.filename)
    return form
  }

  async function call(method, path, params = {}, file = null) {
    const body = new URLSearchParams({ ...params, access_token: token })
    const url = method === 'GET' ? `${base}${path}?${body}` : `${base}${path}`
    // fetch sets the multipart content type (with its boundary) by itself.
    const post = file ? { method, body: multipart(params, file) } : { method, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() }
    const init = method === 'GET' ? { method } : post
    let res
    try {
      res = await fetch(url, init)
    } catch (error) {
      throw new GraphError(redact(`network error on ${method} ${path}: ${error.message}`, token))
    }
    const usage = usageOf(res.headers)
    if (usage && (!peak || usage.pct > peak.pct)) peak = usage
    let json = null
    try {
      json = await res.json()
    } catch {
      json = null
    }
    if (!res.ok || !json || json.error) {
      const e = json?.error || {}
      const detail = e.message || `HTTP ${res.status}`
      throw new GraphError(redact(`${method} ${path} failed: ${detail}`, token), {
        status: res.status,
        code: Number(e.code) || 0,
        subcode: Number(e.error_subcode) || 0,
        type: e.type || '',
      })
    }
    return json
  }

  /** The reel file to Facebook's upload host. The address Facebook hands back is used only when it is on that host. */
  async function upload(videoId, given, bytes) {
    const safe = (() => {
      try {
        return new URL(given).host === UPLOAD_HOST ? given : null
      } catch {
        return null
      }
    })()
    const url = safe || `https://${UPLOAD_HOST}/video-upload/${version}/${videoId}`
    let res
    try {
      res = await fetch(url, { method: 'POST', headers: { Authorization: `OAuth ${token}`, offset: '0', file_size: String(bytes.length), 'content-type': 'application/octet-stream' }, body: bytes })
    } catch (error) {
      throw new GraphError(redact(`network error on the reel upload: ${error.message}`, token))
    }
    const json = await res.json().catch(() => null)
    if (!res.ok || !json || json.error || json.success === false) {
      const e = json?.error || {}
      throw new GraphError(redact(`the reel upload failed: ${e.message || `HTTP ${res.status}`}`, token), { status: res.status, code: Number(e.code) || 0, subcode: Number(e.error_subcode) || 0, type: e.type || '' })
    }
  }

  return {
    /** The highest usage any answer has reported so far, or null. */
    usage: () => peak,
    async pageName() {
      const json = await call('GET', `/${pageId}`, { fields: 'name' })
      return json.name || ''
    },
    async publishPhoto({ url, caption }) {
      const json = await call('POST', `/${pageId}/photos`, { url, caption, published: 'true' })
      return { photoId: json.id, postId: json.post_id || json.id }
    },
    /** A photo post from a file made on the runner (a template image). */
    async publishPhotoFile({ bytes, caption, filename = 'post.jpg', contentType = 'image/jpeg' }) {
      if (!bytes?.length) throw new GraphError('publishPhotoFile needs the image bytes')
      const json = await call('POST', `/${pageId}/photos`, { caption, published: 'true' }, { bytes, filename, contentType })
      return { photoId: json.id, postId: json.post_id || json.id }
    },
    async publishText({ message }) {
      const json = await call('POST', `/${pageId}/feed`, { message })
      return { postId: json.id }
    },
    /** A reel from an MP4 made on the runner. The id of the video is the id the first comment goes on. */
    async publishReel({ bytes, description }) {
      if (!bytes?.length) throw new GraphError('publishReel needs the video bytes')
      const start = await call('POST', `/${pageId}/video_reels`, { upload_phase: 'start' })
      if (!start.video_id) throw new GraphError('the reel upload could not be started: no video id came back')
      await upload(start.video_id, start.upload_url, bytes)
      await call('POST', `/${pageId}/video_reels`, { upload_phase: 'finish', video_id: start.video_id, video_state: 'PUBLISHED', description })
      return { videoId: start.video_id, postId: start.video_id }
    },
    /**
     * Wait until Facebook has processed and published a reel, so the first
     * comment has something to land on. True when it is ready, false when the
     * wait ran out; a processing error throws.
     */
    async reelReady(videoId, { sleep, tries = REEL_POLL.tries, everyMs = REEL_POLL.everyMs } = {}) {
      for (let i = 0; i < tries; i += 1) {
        const { status = {} } = await call('GET', `/${videoId}`, { fields: 'status' })
        const failed = status.processing_phase?.error || status.publishing_phase?.error || status.uploading_phase?.error
        if (failed) throw new GraphError(redact(`Facebook could not process the reel: ${failed.message || 'no reason given'}`, token))
        if (status.video_status === 'ready' || status.publishing_phase?.status === 'complete') return true
        if (sleep) await sleep(everyMs)
      }
      return false
    },
    async comment(postId, message) {
      const json = await call('POST', `/${postId}/comments`, { message })
      return { commentId: json.id }
    },
  }
}
