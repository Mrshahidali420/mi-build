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
 * Checked against Meta's docs on 12 Oct 2026 (Graph API v26.0, Page Photos,
 * Pages API Posts, Object Comments). `message` on /photos is deprecated in
 * favour of `caption`.
 *
 * The token travels in the POST body (or the GET query) and is never logged:
 * every error message is passed through redact() before it leaves this file.
 * `fetch` is injectable so the tests need no network.
 */

/** The one place the Graph API version lives. */
export const GRAPH_VERSION = 'v26.0'
export const GRAPH_HOST = 'https://graph.facebook.com'

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

const redact = (text, token) => (token ? String(text).split(token).join('***') : String(text))

export function graphClient({ pageId, token, fetch = globalThis.fetch, version = GRAPH_VERSION }) {
  if (!pageId || !token) throw new Error('graphClient needs a page id and a token')
  const base = `${GRAPH_HOST}/${version}`

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

  return {
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
    async comment(postId, message) {
      const json = await call('POST', `/${postId}/comments`, { message })
      return { commentId: json.id }
    },
  }
}
