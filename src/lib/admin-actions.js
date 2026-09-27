/**
 * The owner's buttons: one endpoint, /my-admin/api/rule, that adds or removes
 * a homepage rule or a keep-list id. Everything else on /my-admin only reads;
 * this is the one place that writes, so every check sits here, in order:
 *
 *   1. POST only.
 *   2. Same origin. A page on another site cannot make the owner's browser
 *      tap a button: the Origin must be this site, and Sec-Fetch-Site, which
 *      every current browser sends and a page cannot forge, must not say
 *      otherwise. The body must be JSON, which a plain cross-site form cannot
 *      send without a preflight this endpoint never answers.
 *   3. The owner's cookie, checked exactly as the pages check it
 *      (isOwner in src/lib/admin.js).
 *   4. A strict body (checkTap in src/lib/owner-rules.mjs).
 *
 * Nothing about the request is logged, so the cookie never reaches a log.
 */
import { isOwner } from './admin.js'
import { checkTap, tapStatements, savedLine } from './owner-rules.mjs'

// A tap is a few dozen bytes; anything much bigger is not a tap.
const MAX_BODY = 1024

const answer = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  })

/** Null when the request comes from this site's own page, else the reason. */
export function crossSite(request) {
  const own = new URL(request.url).origin
  const origin = request.headers.get('origin')
  if (!origin || origin !== own) return 'wrong origin'
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin') return 'not same-origin'
  const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (type !== 'application/json') return 'body must be JSON'
  return null
}

/** Handle one tap. `env` is the Worker's env; `now` is for tests. */
export async function handleTap(request, env, now = Date.now()) {
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
  const { value: tap, error } = checkTap(body)
  if (error) return answer(400, { ok: false, error })

  const db = env?.ANALYTICS
  if (!db) return answer(503, { ok: false, error: 'the database is not connected' })
  const at = new Date(now).toISOString()
  try {
    // One batch is one transaction: the rule and its log line land together
    // or not at all. Parameters only, never text pasted into the SQL.
    await db.batch(tapStatements(tap, at).map(([sql, args]) => db.prepare(sql).bind(...args)))
  } catch {
    return answer(503, { ok: false, error: 'not saved, the database refused it; try again' })
  }
  return answer(200, { ok: true, message: savedLine(tap) })
}
