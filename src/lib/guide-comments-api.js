/**
 * The two doors of the guide comments, answered by src/worker.js before
 * Astro is reached, like /_review and /_message:
 *
 *   POST /_comment            one comment or reply, saved as pending
 *   GET  /_comments?guide=x   the approved comments of one guide, threaded
 *
 * POST is checked the way a review is (src/lib/reviews-api.js), in order:
 *   1. POST, same origin, a JSON body of at most 12 KB (opening).
 *   2. A strict body (checkComment in src/lib/guide-comments.mjs): the
 *      review rules for links, handles, HTML and spam.
 *   3. A fresh Turnstile ticket.
 *   4. The guide must exist (hasGuide, from the guide list the Worker
 *      already carries) and a reply's parent must be an approved comment on
 *      that same guide.
 *   5. An address may send DAILY_COMMENTS a day, and when more than
 *      MAX_PENDING_COMMENTS wait for the owner, new ones are paused.
 *
 * No IP address is kept. The daily limit uses an HMAC of `comment|day|ip`
 * under PASS_KEY, and the night job blanks it after two days
 * (forgetCommentSenders below).
 *
 * GET is the guide pages' read. The pages are built as files, so they load
 * their comments in the browser; the answer is kept at the edge with the
 * Cache API for READ_CACHE_SECONDS, so a busy guide costs one D1 read every
 * five minutes per data centre. An approval can take that long to show.
 */
import { sign } from './beacon-pass.js'
import { answer, dayOf, ipOf, opening, verifyTicket } from './reviews-api.js'
import {
  checkComment,
  threadComments,
  commentCount,
  GUIDE_SLUG,
  COMMENT_INSERT,
  COMMENT_SENDS_READ,
  COMMENTS_PENDING_COUNT,
  COMMENT_PARENT_READ,
  COMMENTS_APPROVED_READ,
  DAILY_COMMENTS,
  MAX_PENDING_COMMENTS,
  FORGET_COMMENT_SENDERS,
} from './guide-comments.mjs'

// A comment is at most 1500 characters (up to 6 KB in UTF-8), plus the name
// and the ticket.
const MAX_COMMENT_BODY = 12288
// How long a hash that spots repeats is kept, in days.
const FORGET_AFTER_DAYS = 2
// How long the edge keeps one guide's approved comments.
export const READ_CACHE_SECONDS = 300

const NOT_SAVED = 'Not saved just now. Try again later.'

/**
 * One comment from a guide page. Saved as pending for /my-admin/comments.
 * `hasGuide(slug)` says whether the guide exists; `verify` is swapped in tests.
 */
export async function handleComment(request, env, { now = Date.now(), verify = verifyTicket, hasGuide = () => false } = {}) {
  const open = await opening(request, env, MAX_COMMENT_BODY)
  if (open.refused) return open.refused
  const { value: comment, error, field } = checkComment(open.body)
  if (error) return answer(400, { ok: false, error, field })

  const ip = ipOf(request)
  if (!(await verify(comment.token, ip, env))) {
    return answer(403, { ok: false, error: 'The browser check did not pass. Reload the page and try again.' })
  }
  if (!hasGuide(comment.guide)) return answer(404, { ok: false, error: 'unknown guide' })

  const day = dayOf(now)
  const at = new Date(now).toISOString()
  const sender = await sign(env.PASS_KEY, `comment|${day}|${ip}`)
  const db = open.db
  try {
    if (comment.parent) {
      const parent = await db.prepare(COMMENT_PARENT_READ).bind(comment.parent).first()
      if (!parent || parent.status !== 'approved' || parent.guide !== comment.guide) {
        return answer(400, { ok: false, error: 'That comment cannot take a reply any more. Reload the page.' })
      }
    }
    const sent = await db.prepare(COMMENT_SENDS_READ).bind(day, sender).first()
    if (Number(sent?.n) >= DAILY_COMMENTS) {
      return answer(429, { ok: false, error: `That is ${DAILY_COMMENTS} comments today. Thank you; come back tomorrow for more.` })
    }
    const waiting = await db.prepare(COMMENTS_PENDING_COUNT).first()
    if (Number(waiting?.n) > MAX_PENDING_COMMENTS) {
      return answer(503, { ok: false, error: 'Comments are paused for a little while. Try again tomorrow.' })
    }
    await db
      .prepare(COMMENT_INSERT)
      .bind(comment.guide, comment.parent, comment.name, comment.body, day, sender, at)
      .run()
  } catch {
    return answer(503, { ok: false, error: NOT_SAVED })
  }
  return answer(200, { ok: true, message: 'Thank you. Your comment shows here once it is approved.' })
}

const readAnswer = (status, body, seconds) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': seconds ? `public, max-age=0, s-maxage=${seconds}` : 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })

/**
 * The approved comments of one guide: { ok, count, comments } where comments
 * is threadComments' shape. `cache` is the edge cache (caches.default in the
 * Worker, a stand-in or null in tests); `ctx` keeps the cache write alive.
 */
export async function handleCommentsRead(request, env, ctx, { cache = null, hasGuide = () => false } = {}) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET', 'cache-control': 'no-store' } })
  }
  const url = new URL(request.url)
  const guide = url.searchParams.get('guide') || ''
  if (!GUIDE_SLUG.test(guide) || !hasGuide(guide)) return readAnswer(404, { ok: false, error: 'unknown guide' }, 0)

  // One key per guide, whatever else the address carries.
  const key = new Request(`${url.origin}${url.pathname}?guide=${guide}`, { method: 'GET' })
  if (cache) {
    const hit = await cache.match(key)
    if (hit) return hit
  }
  const db = env?.ANALYTICS
  if (!db) return readAnswer(503, { ok: false, comments: [], count: 0 }, 0)
  let rows
  try {
    rows = (await db.prepare(COMMENTS_APPROVED_READ).bind(guide).all())?.results || []
  } catch {
    // Before 0010 has run, or a bad moment: no comments, and nothing kept.
    return readAnswer(503, { ok: false, comments: [], count: 0 }, 0)
  }
  const comments = threadComments(rows)
  const response = readAnswer(200, { ok: true, count: commentCount(comments), comments }, READ_CACHE_SECONDS)
  if (cache) {
    const put = cache.put(key, response.clone())
    if (ctx?.waitUntil) ctx.waitUntil(put)
    else await put
  }
  return response
}

/**
 * The night job's part: blank the senders' hashes once they are two days
 * old. Run from the scheduled handler in src/worker.js. Never throws.
 */
export async function forgetCommentSenders(db, now = Date.now()) {
  if (!db) return
  const before = dayOf(now - FORGET_AFTER_DAYS * 86400000)
  try {
    await db.prepare(FORGET_COMMENT_SENDERS).bind(before).run()
  } catch {
    // Before 0010 has run the table does not exist; the next night tries again.
  }
}
