/**
 * The owner's comment buttons: one endpoint, /my-admin/api/comment, that
 * approves a pending guide comment or deletes a comment (pending or live,
 * with every reply under it). The same door as the review buttons
 * (src/lib/review-actions.js), checked in the same order: POST only, same
 * origin with a JSON body, the owner's cookie, then a strict body
 * (checkCommentTap in src/lib/guide-comments.mjs). Every change is written
 * to admin_log beside the other taps.
 *
 * A guide keeps its approved comments at the edge for five minutes
 * (src/lib/guide-comments-api.js), so an approval or a removal can take that
 * long to show.
 */
import { isOwner } from './admin.js'
import { crossSite } from './admin-actions.js'
import { LOG_INSERT } from './owner-rules.mjs'
import { checkCommentTap, COMMENT_APPROVE, COMMENT_DELETE, COMMENT_FIND } from './guide-comments.mjs'

// A tap is a few dozen bytes; anything much bigger is not a tap.
const MAX_BODY = 1024

const answer = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  })

/** Handle one tap. `env` is the Worker's env; `now` is for tests. */
export async function handleCommentTap(request, env, now = Date.now()) {
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' } })
  }
  const refused = crossSite(request)
  if (refused) return answer(403, { ok: false, error: refused })
  if (!(await isOwner(request, env))) return answer(401, { ok: false, error: 'sign in again' })

  let raw = ''
  try {
    raw = await request.text()
  } catch {
    return answer(400, { ok: false, error: 'the body could not be read' })
  }
  if (raw.length > MAX_BODY) return answer(413, { ok: false, error: 'the body is too big' })
  let body
  try {
    body = JSON.parse(raw)
  } catch {
    return answer(400, { ok: false, error: 'the body is not JSON' })
  }
  const { value: tap, error } = checkCommentTap(body)
  if (error) return answer(400, { ok: false, error })

  const db = env?.ANALYTICS
  if (!db) return answer(503, { ok: false, error: 'the database is not connected' })
  const at = new Date(now).toISOString()
  try {
    const found = await db.prepare(COMMENT_FIND).bind(tap.id).first()
    if (!found) return answer(404, { ok: false, error: 'that comment is not there any more' })
    const change = tap.op === 'approve'
      ? db.prepare(COMMENT_APPROVE).bind(at, tap.id)
      : db.prepare(COMMENT_DELETE).bind(tap.id)
    const note = `comment ${tap.id} on ${found.guide}`.slice(0, 120)
    // One batch is one transaction: the change and its log line land together.
    await db.batch([change, db.prepare(LOG_INSERT).bind(at, `${tap.op} comment`, null, '', note)])
  } catch {
    return answer(503, { ok: false, error: 'not saved, the database refused it; try again' })
  }
  return answer(200, {
    ok: true,
    message: tap.op === 'approve' ? 'Approved. Live on the guide within 5 minutes.' : 'Deleted, with any replies under it.',
  })
}
