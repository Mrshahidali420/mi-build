/**
 * The two doors a reader can write through: /_vote (one tap on the stars)
 * and /_review (the short form). Both are answered by src/worker.js before
 * Astro is reached, the same way the visit counter's /_a and /_p are.
 *
 * Every check sits here, in order:
 *   1. Same origin, JSON body (crossSite in src/lib/admin-actions.js). A page
 *      on another site cannot make a visitor's browser vote.
 *   2. A strict body (checkVote / checkReview in src/lib/reviews.mjs). For a
 *      review that is also the no-links rule and the spam rule.
 *   3. Proof a real browser is here. A review needs a fresh Turnstile ticket.
 *      A vote takes that, or the half-hour pass the page already earned with
 *      Turnstile for the visit counter, so most taps need no second check.
 *   4. The title must exist in the catalog, read from its shard.
 *   5. Repeats: a vote counts once per title, per browser and address, per
 *      day; an address may send DAILY_REVIEWS reviews a day.
 *
 * No IP address is kept anywhere. Repeats are spotted with an HMAC of the
 * address under the Worker secret PASS_KEY, mixed with the day, so the same
 * reader on two days gives two unrelated hashes, and the night job blanks
 * them after two days (forgetSenders below).
 */
import { crossSite } from './admin-actions.js'
import { passProblem, sign } from './beacon-pass.js'
import { loadTitle } from './runtime.js'
import { sectionOf } from './section.mjs'
import {
  checkVote,
  checkReview,
  ratingOf,
  ratingLine,
  VOTE_INSERT,
  TOTALS_RECOUNT,
  TOTALS_READ,
  REVIEW_INSERT,
  SENDS_READ,
  SENDS_BUMP,
  PENDING_COUNT,
  DAILY_REVIEWS,
  MAX_PENDING,
  FORGET_VOTERS,
  FORGET_SENDS,
} from './reviews.mjs'

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
// A vote is a few hundred bytes; a review at most 1500 characters, which is
// up to 6 KB in UTF-8, plus the ticket.
const MAX_VOTE_BODY = 4096
const MAX_REVIEW_BODY = 12288
// How long a hash that spots repeats is kept, in days.
const FORGET_AFTER_DAYS = 2

const answer = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  })

const dayOf = (now) => new Date(now).toISOString().slice(0, 10)

/**
 * Ask Cloudflare whether a Turnstile ticket is good. A ticket works once and
 * dies after five minutes, so a replayed one is refused there, not here.
 */
export async function verifyTicket(token, ip, env) {
  if (!env?.TURNSTILE_SECRET || !token) return false
  try {
    const form = new FormData()
    form.append('secret', env.TURNSTILE_SECRET)
    form.append('response', token)
    if (ip) form.append('remoteip', ip)
    const res = await fetch(VERIFY_URL, { method: 'POST', body: form })
    const verdict = await res.json()
    return Boolean(verdict && verdict.success === true)
  } catch {
    return false
  }
}

/** The JSON body, or a ready answer saying why there is none. */
async function readJson(request, max) {
  let raw = ''
  try {
    raw = await request.text()
  } catch {
    return { refused: answer(400, { ok: false, error: 'the body could not be read' }) }
  }
  if (raw.length > max) return { refused: answer(413, { ok: false, error: 'That is too long.' }) }
  try {
    return { body: JSON.parse(raw) }
  } catch {
    return { refused: answer(400, { ok: false, error: 'the body is not JSON' }) }
  }
}

/**
 * The catalog record for kind + slug, null when there is no such page, or
 * 'down' when the shard could not be read. The section must match the
 * record's own: a manhwa cannot be voted on through /manga/.
 */
async function findTitle(env, kind, slug) {
  try {
    const item = await loadTitle(env, kind, slug)
    return item && sectionOf(item) === kind && Number.isSafeInteger(item.id) && item.id > 0 ? item : null
  } catch {
    return 'down'
  }
}

/**
 * The parts every door shares: method, origin, body, the database and the
 * key. Returns { body, db } or { refused }.
 */
async function opening(request, env, max) {
  if (request.method !== 'POST') {
    return { refused: new Response(null, { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' } }) }
  }
  const cross = crossSite(request)
  if (cross) return { refused: answer(403, { ok: false, error: cross }) }
  const read = await readJson(request, max)
  if (read.refused) return read
  const db = env?.ANALYTICS
  if (!db || !env?.PASS_KEY) return { refused: answer(503, { ok: false, error: 'Not saved just now. Try again later.' }) }
  return { body: read.body, db }
}

const ipOf = (request) => request.headers.get('cf-connecting-ip') || ''

/**
 * One tap on the stars. `verify` is swapped in tests; the Worker uses the
 * real Turnstile check.
 */
export async function handleVote(request, env, { now = Date.now(), verify = verifyTicket } = {}) {
  const open = await opening(request, env, MAX_VOTE_BODY)
  if (open.refused) return open.refused
  const { value: vote, error } = checkVote(open.body)
  if (error) return answer(400, { ok: false, error })

  const ip = ipOf(request)
  // The visit pass first: it is free to check. A fresh ticket otherwise.
  let proved = vote.pass ? (await passProblem(vote.pass, env, now)) === null : false
  if (!proved && vote.token) proved = await verify(vote.token, ip, env)
  if (!proved) return answer(403, { ok: false, error: 'The browser check did not pass. Reload the page and try again.' })

  const item = await findTitle(env, vote.kind, vote.slug)
  if (item === 'down') return answer(503, { ok: false, error: 'Not saved just now. Try again in a moment.' })
  if (!item) return answer(404, { ok: false, error: 'unknown title' })

  const day = dayOf(now)
  const at = new Date(now).toISOString()
  const ua = (request.headers.get('user-agent') || '').slice(0, 300)
  const voter = await sign(env.PASS_KEY, `vote|${day}|${item.id}|${ip}|${ua}`)
  const db = open.db
  let counted = false
  let row = null
  try {
    // One batch is one transaction: the vote and the recount land together.
    const out = await db.batch([
      db.prepare(VOTE_INSERT).bind(item.id, vote.stars, day, voter, at),
      db.prepare(TOTALS_RECOUNT).bind(item.id, at, item.id),
    ])
    counted = Number(out?.[0]?.meta?.changes) > 0
    row = await db.prepare(TOTALS_READ).bind(item.id).first()
  } catch {
    return answer(503, { ok: false, error: 'Not saved just now. Try again later.' })
  }
  // A repeat is answered like a first vote: telling a script which taps
  // counted would only help it.
  const rating = ratingOf(row)
  return answer(200, { ok: true, counted, votes: rating.votes, avg: rating.avg, line: ratingLine(rating) })
}

/** One review from the form. Saved as pending; nothing is shown until approved. */
export async function handleReview(request, env, { now = Date.now(), verify = verifyTicket } = {}) {
  const open = await opening(request, env, MAX_REVIEW_BODY)
  if (open.refused) return open.refused
  const { value: review, error, field } = checkReview(open.body)
  if (error) return answer(400, { ok: false, error, field })

  const ip = ipOf(request)
  if (!(await verify(review.token, ip, env))) {
    return answer(403, { ok: false, error: 'The browser check did not pass. Reload the page and try again.' })
  }

  const item = await findTitle(env, review.kind, review.slug)
  if (item === 'down') return answer(503, { ok: false, error: 'Not saved just now. Try again in a moment.' })
  if (!item) return answer(404, { ok: false, error: 'unknown title' })

  const day = dayOf(now)
  const at = new Date(now).toISOString()
  const sender = await sign(env.PASS_KEY, `review|${day}|${ip}`)
  const db = open.db
  try {
    const sent = await db.prepare(SENDS_READ).bind(day, sender).first()
    if (Number(sent?.n) >= DAILY_REVIEWS) {
      return answer(429, { ok: false, error: `That is ${DAILY_REVIEWS} reviews today. Thank you; come back tomorrow for more.` })
    }
    const waiting = await db.prepare(PENDING_COUNT).first()
    if (Number(waiting?.n) >= MAX_PENDING) {
      return answer(503, { ok: false, error: 'Reviews are paused for a little while. Try again tomorrow.' })
    }
    await db.batch([
      db.prepare(REVIEW_INSERT).bind(item.id, review.kind, review.slug, String(item.title || '').slice(0, 200), review.name, review.text, review.stars, at),
      db.prepare(SENDS_BUMP).bind(day, sender),
    ])
  } catch {
    return answer(503, { ok: false, error: 'Not saved just now. Try again later.' })
  }
  return answer(200, { ok: true, message: 'Thank you. Your review is checked first and shows here within 24 hours.' })
}

/**
 * The night job's part: blank the repeat-spotting hashes once they are two
 * days old. Run from the scheduled handler in src/worker.js. Never throws.
 */
export async function forgetSenders(db, now = Date.now()) {
  if (!db) return
  const before = dayOf(now - FORGET_AFTER_DAYS * 86400000)
  try {
    await db.batch([db.prepare(FORGET_VOTERS).bind(before), db.prepare(FORGET_SENDS).bind(before)])
  } catch {
    // Before 0007 has run the tables do not exist; the next night tries again.
  }
}
