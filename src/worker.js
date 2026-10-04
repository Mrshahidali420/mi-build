// The front door. It does three jobs, in this order:
//   1. old URLs are sent to their new home
//   2. a page already rendered once is served from the edge cache
//   3. everything else goes to Astro, which serves a static file or
//      renders a title or character page from a shard
import redirects from '../data/redirects.json'
import shards from '../data/shards.json'
import astro from '../dist/_worker.js/index.js'
import { runRollup } from './lib/rollup.js'
import { cleanRow, INSERT_SQL } from './lib/beacon-rows.js'
import { passProblem, readBeacon, beaconPlace, sign } from './lib/beacon-pass.js'
import { rejectCounter, writeRejects } from './lib/reject-count.js'
import { handleVote, handleReview, forgetSenders } from './lib/reviews-api.js'
import { EDGE_HEADER } from './lib/reviews-read.js'
import { handleMessage, forgetMessageSenders } from './lib/messages-api.js'

// How long the edge keeps a rendered page. The data changes once a day.
// A page that carries live numbers asks for less with the EDGE_HEADER header
// (title pages: ten minutes, for reader ratings and approved reviews); it
// can never ask for more.
const CACHE_SECONDS = 86400

// Every build writes a new builtAt. It goes in the cache key, so a page kept
// by the last build can never be found again after a deploy. Without this a
// template change stays invisible for a full day.
const BUILD = String(shards.builtAt || 0)

// The answer pages that hang under a title or a character page.
const SUBPAGE = /^(\/[^/]+\/[^/]+)(\/(?:buy|free|like|characters))$/

// Where the page script posts one row per view, per outbound click and per
// exit. It is short on purpose: it travels in every page.
const BEACON_PATH = '/_a'

// Most visits now arrive as one batch at the end, so a body holds many rows.
const MAX_ROWS = 25

// What the door turned away, and what it let in, by reason. Counted in this
// isolate's memory and written at most once a minute, so a robot flood
// cannot turn into a flood of database writes. See src/lib/reject-count.js.
const doorCounts = rejectCounter()

/** Count one hit at the door; write the isolate's counts when a window is up. */
function countDoor(request, env, ctx, reason, place, n = 1) {
  try {
    const now = Date.now()
    doorCounts.add(reason, place, request.headers.get('cf-ipcountry'), now, n)
    const rows = doorCounts.take(now)
    // Written after the answer has gone, so a slow write never slows a page.
    if (rows && env && env.ANALYTICS && ctx) ctx.waitUntil(writeRejects(env.ANALYTICS, rows).catch(() => {}))
  } catch (e) {
    // Counting the door must never break the door.
  }
}

/**
 * Keep one event. It can never fail the page: the script does not wait for the
 * answer, and every error here ends as the same empty 204.
 */
async function recordEvent(request, env, ctx) {
  const done = new Response(null, {
    status: 204,
    headers: { 'cache-control': 'no-store' },
  })
  if (!env || !env.ANALYTICS) return done

  let raw = ''
  try {
    raw = await request.text()
  } catch (e) {
    raw = ''
  }
  // The same checks as always (src/lib/beacon-pass.js); they now say why.
  const read = readBeacon(raw)
  if (read.reason) {
    countDoor(request, env, ctx, read.reason, 'other')
    return done
  }
  const body = read.body
  const place = beaconPlace(body)

  // No pass, nothing written. This is the whole defence: a browser driven by a
  // program cannot get a Turnstile ticket, so it can never hold a pass.
  const problem = await passProblem(body.pass, env)
  if (problem) {
    countDoor(request, env, ctx, problem, place)
    return done
  }

  // One visit used to cost three requests: open, click, leave. On a free
  // Workers plan that was 82% of the whole daily allowance, and the site
  // started answering 504 once the allowance ran out. The page now keeps its
  // rows in the tab and sends them all together when the reader really goes,
  // so a whole visit costs one request instead of three.
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, MAX_ROWS) : [body]
  const now = Date.now()
  const country = request.headers.get('cf-ipcountry') || ''

  try {
    // Every field is checked and cut in src/lib/beacon-rows.js. A row it
    // refuses (an unknown action, a search that looks like an e-mail) is
    // simply not written.
    const stmt = env.ANALYTICS.prepare(INSERT_SQL)
    const batch = []
    for (const row of rows) {
      const values = cleanRow(row, country, now)
      if (values) batch.push(stmt.bind(...values))
    }
    countDoor(request, env, ctx, 'ok', place)
    if (batch.length < rows.length) countDoor(request, env, ctx, 'bad_row', place, rows.length - batch.length)
    if (batch.length) await env.ANALYTICS.batch(batch)
  } catch (e) {
    // A full day allowance or a dropped connection must not break a page view.
  }
  return done
}


// Where the page asks for a pass. It sends one Turnstile ticket and gets back
// a pass that lasts half an hour.
//
// Turnstile is Cloudflare's own "is a real browser here" test. It is free and
// the reader never sees it. It exists because nothing the page itself can
// measure works any more: the crawler that fills these reports runs a real
// browser on home internet lines in forty six countries, waits on the page for
// up to thirty eight seconds, and scrolls. It looks exactly like a reader from
// the inside. From the outside, to Cloudflare, it does not.
const PASS_PATH = '/_p'
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
// A Turnstile ticket is good once and dies after five minutes, so the page
// cannot keep sending it. The worker trades it for a pass of our own, and the
// pass is what travels with every later beacon.
const PASS_MINUTES = 30

/**
 * Trade one Turnstile ticket for a pass. The pass is the minute it dies plus a
 * signature, so the worker can check it later without keeping a list.
 */
async function issuePass(request, env, ctx) {
  const no = new Response('no', { status: 403, headers: { 'cache-control': 'no-store' } })
  if (!env || !env.TURNSTILE_SECRET || !env.PASS_KEY) return no
  const refuse = (reason) => {
    countDoor(request, env, ctx, reason, 'pass')
    return no
  }

  let token = ''
  try {
    const raw = await request.text()
    if (raw.length > 4096) return refuse('pass_bad_ask')
    token = String(JSON.parse(raw).token || '')
  } catch (e) {
    return refuse('pass_bad_ask')
  }
  if (!token) return refuse('pass_bad_ask')

  try {
    const form = new FormData()
    form.append('secret', env.TURNSTILE_SECRET)
    form.append('response', token)
    const ip = request.headers.get('cf-connecting-ip')
    if (ip) form.append('remoteip', ip)
    const answer = await fetch(VERIFY_URL, { method: 'POST', body: form })
    const verdict = await answer.json()
    if (!verdict || verdict.success !== true) return refuse('pass_refused')
  } catch (e) {
    return refuse('pass_error')
  }
  countDoor(request, env, ctx, 'pass_ok', 'pass')

  const dies = Date.now() + PASS_MINUTES * 60000
  const pass = dies + '.' + (await sign(env.PASS_KEY, String(dies)))
  return new Response(JSON.stringify({ pass }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

// Where the rating stars and the review form post.
const VOTE_PATH = '/_vote'
const REVIEW_PATH = '/_review'
// Where the feedback, contact and advertise forms post.
const MESSAGE_PATH = '/_message'

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/$/, '') || '/'

    const target = redirects[path]
    if (target) return Response.redirect(`${url.origin}${target}${url.search}`, 301)

    // A page that moved takes its answer pages with it. The map holds only the
    // page itself, so /character/jin-u-seong/buy is matched here by its parent
    // and follows it to /character/sung-jin-woo/buy. One lookup, no new rows.
    const sub = SUBPAGE.exec(path)
    if (sub && redirects[sub[1]]) {
      return Response.redirect(`${url.origin}${redirects[sub[1]]}${sub[2]}${url.search}`, 301)
    }

    if (url.pathname === PASS_PATH) {
      if (request.method !== 'POST') {
        countDoor(request, env, ctx, 'wrong_method', 'pass')
        return new Response(null, { status: 405 })
      }
      return issuePass(request, env, ctx)
    }

    // A reader's star tap and a written review (src/lib/reviews-api.js). Both
    // answer 405 to anything but POST, inside the handler.
    if (url.pathname === VOTE_PATH) return handleVote(request, env)
    if (url.pathname === REVIEW_PATH) return handleReview(request, env)
    // A message from /feedback, /contact or /advertise (src/lib/messages-api.js).
    if (url.pathname === MESSAGE_PATH) return handleMessage(request, env)

    if (url.pathname === BEACON_PATH) {
      if (request.method !== 'POST') {
        countDoor(request, env, ctx, 'wrong_method', 'other')
        return new Response(null, { status: 405 })
      }
      return recordEvent(request, env, ctx)
    }

    // The admin pages read the database on every request, so they are
    // rendered fresh every time and never kept by the edge.
    if (path === '/my-admin' || path.startsWith('/my-admin/')) {
      return astro.fetch(request, env, ctx)
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return astro.fetch(request, env, ctx)
    }

    const cache = caches.default
    // The buy links point at the reader's own Amazon store, so a page cached
    // for one country must never be served to another. The country joins the
    // key. This costs almost nothing: an edge cache is per data centre, and a
    // data centre already serves mostly one country.
    const country = request.headers.get('cf-ipcountry') || 'zz'
    // Always GET: the cache API refuses to store a HEAD request.
    const cacheKey = new Request(
      `${url.origin}${url.pathname}?_b=${BUILD}&_c=${country}`,
      { method: 'GET' }
    )
    const hit = await cache.match(cacheKey)
    if (hit) return hit

    const response = await astro.fetch(request, env, ctx)

    // Only a good HTML answer is worth keeping. A 404 must stay cheap to fix.
    const type = response.headers.get('content-type') || ''
    if (response.status === 200 && type.includes('text/html')) {
      const kept = new Response(response.body, response)
      const asked = Number(kept.headers.get(EDGE_HEADER))
      const seconds = asked > 0 && asked < CACHE_SECONDS ? Math.floor(asked) : CACHE_SECONDS
      kept.headers.delete(EDGE_HEADER)
      kept.headers.set('cache-control', `public, max-age=0, s-maxage=${seconds}`)
      ctx.waitUntil(cache.put(cacheKey, kept.clone()))
      return kept
    }
    return response
  },

  /**
   * Once a night, at 00:10 UTC, yesterday is squeezed into the small daily
   * tables and raw rows older than 30 days are thrown away. See
   * src/lib/rollup.js. One run is one Worker request out of 100,000 a day.
   */
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runRollup(env && env.ANALYTICS))
    // Blank the two-day-old hashes that stop repeat votes and reviews.
    ctx.waitUntil(forgetSenders(env && env.ANALYTICS))
    ctx.waitUntil(forgetMessageSenders(env && env.ANALYTICS))
  },
}
