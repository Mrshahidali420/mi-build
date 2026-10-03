/**
 * The owner's review buttons: one endpoint, /my-admin/api/review, that
 * approves a pending review or deletes a review (pending or live). It is the
 * same door as the homepage buttons (src/lib/admin-actions.js), checked in
 * the same order: POST only, same origin with a JSON body, the owner's
 * cookie, then a strict body (checkReviewTap in src/lib/reviews.mjs).
 *
 * An approval shows on the title page within ten minutes: the page reads
 * approved reviews from D1 each time it is drawn, and the edge keeps a title
 * page for ten minutes (src/lib/reviews-read.js). No build is needed.
 *
 * Every change is written to admin_log beside the homepage taps, so a review
 * that went live can be traced to the tap behind it.
 */
import { isOwner } from './admin.js'
import { crossSite } from './admin-actions.js'
import { LOG_INSERT } from './owner-rules.mjs'
import { checkReviewTap, REVIEW_APPROVE, REVIEW_DELETE, REVIEW_FIND } from './reviews.mjs'

// A tap is a few dozen bytes; anything much bigger is not a tap.
const MAX_BODY = 1024

const answer = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  })

/** Handle one tap. `env` is the Worker's env; `now` is for tests. */
export async function handleReviewTap(request, env, now = Date.now()) {
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
  const { value: tap, error } = checkReviewTap(body)
  if (error) return answer(400, { ok: false, error })

  const db = env?.ANALYTICS
  if (!db) return answer(503, { ok: false, error: 'the database is not connected' })
  const at = new Date(now).toISOString()
  try {
    const found = await db.prepare(REVIEW_FIND).bind(tap.id).first()
    if (!found) return answer(404, { ok: false, error: 'that review is not there any more' })
    const change = tap.op === 'approve'
      ? db.prepare(REVIEW_APPROVE).bind(at, tap.id)
      : db.prepare(REVIEW_DELETE).bind(tap.id)
    const note = `review ${tap.id}: ${found.title || ''}`.slice(0, 120)
    // One batch is one transaction: the change and its log line land together.
    await db.batch([change, db.prepare(LOG_INSERT).bind(at, `${tap.op} review`, found.anilist_id, '', note)])
  } catch {
    return answer(503, { ok: false, error: 'not saved, the database refused it; try again' })
  }
  return answer(200, {
    ok: true,
    message: tap.op === 'approve' ? 'Approved. Live on the title page within 10 minutes.' : 'Deleted.',
  })
}
