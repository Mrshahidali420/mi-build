// Guide comments: the strict check (the review link rules), the /_comment
// door with replies, its daily limit and pause, the /_comments read and its
// edge cache, the night job, and the owner's Approve / Delete buttons, over
// the real schema in a D1 stand-in.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkComment,
  checkCommentTap,
  threadComments,
  commentCount,
  DAILY_COMMENTS,
  MAX_PENDING_COMMENTS,
  MAX_COMMENT,
} from '../src/lib/guide-comments.mjs'
import { handleComment, handleCommentsRead, forgetCommentSenders, READ_CACHE_SECONDS } from '../src/lib/guide-comments-api.js'
import { handleCommentTap } from '../src/lib/comment-actions.js'
import { analyticsD1 } from './d1-shim.js'

const SITE = 'https://manhwaindex.com'
const SECRET = 'correct horse battery staple'
const NOW = Date.parse('2026-10-04T08:00:00Z')
const GUIDES = new Set(['naruto-strongest-characters', 'best-romance-manhwa'])
const hasGuide = (slug) => GUIDES.has(slug)
const yes = async () => true
const no = async () => false
const opts = { now: NOW, verify: yes, hasGuide }

const comment = (extra = {}) => ({
  guide: 'naruto-strongest-characters',
  name: 'Mia',
  body: 'Itachi deserves a higher spot than this.',
  token: 't',
  ...extra,
})

async function ownerCookie(word = SECRET) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`manhwaindex:${word}`))
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const world = () => {
  const db = analyticsD1()
  return { db, env: { ANALYTICS: db, PASS_KEY: 'k', TURNSTILE_SECRET: 's', ADMIN_SECRET: SECRET } }
}

function post(path, body, headers = {}) {
  const all = {
    origin: SITE,
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json',
    'cf-connecting-ip': '203.0.113.7',
    ...headers,
  }
  for (const [k, v] of Object.entries(all)) if (v === null) delete all[k]
  return new Request(`${SITE}${path}`, { method: 'POST', headers: all, body: typeof body === 'string' ? body : JSON.stringify(body) })
}

/** Save one comment through the door and approve it by hand; returns its id. */
async function approved(db, env, extra = {}) {
  const res = await handleComment(post('/_comment', comment(extra)), env, opts)
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()))
  const { id } = db.raw.prepare('SELECT MAX(id) AS id FROM guide_comments').get()
  db.raw.prepare("UPDATE guide_comments SET status = 'approved', approved_at = ? WHERE id = ?").run('2026-10-04T09:00:00Z', id)
  return id
}

/** A tiny stand-in for the edge cache. */
function memoryCache() {
  const store = new Map()
  return {
    store,
    match: async (req) => store.get(req.url)?.clone() ?? undefined,
    put: async (req, res) => {
      store.set(req.url, res)
    },
  }
}

test('checkComment: a good comment, a reply, and the name rule', () => {
  const ok = checkComment(comment())
  assert.equal(ok.error, undefined)
  assert.deepEqual(ok.value, { guide: 'naruto-strongest-characters', parent: null, name: 'Mia', body: 'Itachi deserves a higher spot than this.', token: 't' })
  assert.equal(checkComment(comment({ parent: 7 })).value.parent, 7)
  assert.equal(checkComment(comment({ parent: '7' })).value.parent, 7)
  assert.equal(checkComment(comment({ parent: null })).value.parent, null)
  assert.equal(checkComment(comment({ name: '  Ana \n Lee ' })).value.name, 'Ana Lee')

  assert.equal(checkComment(comment({ name: '' })).field, 'name')
  assert.equal(checkComment(comment({ name: '   ' })).field, 'name')
  assert.equal(checkComment(comment({ name: undefined })).field, 'name')
  assert.equal(checkComment(comment({ name: 'n'.repeat(41) })).field, 'name')
  assert.equal(checkComment(comment({ name: 'n'.repeat(40) })).error, undefined)
  assert.equal(checkComment(comment({ name: 'mia.com' })).field, 'name')
  assert.equal(checkComment(comment({ name: '@mia' })).field, 'name')
  assert.equal(checkComment(comment({ name: '<b>Mia</b>' })).field, 'name')
})

test('checkComment: length, links, handles, HTML and spam are refused', () => {
  assert.equal(checkComment(comment({ body: 'ok' })).error, undefined)
  assert.equal(checkComment(comment({ body: 'x' })).field, 'body')
  assert.equal(checkComment(comment({ body: '   ' })).field, 'body')
  assert.equal(checkComment(comment({ body: 'a '.repeat(MAX_COMMENT) })).field, 'body')
  assert.equal(checkComment(comment({ body: 42 })).field, 'body')
  for (const body of [
    'Read it at https://example.com today',
    'Go to www.example.com for raws',
    'Find it on mangasite.net now',
    'Follow me @mia_reads for more',
    'Mail me at mia@example.com please',
    'Click [here](x) for the chapter',
    'Nice <a href="x">list</a>',
  ]) {
    const out = checkComment(comment({ body }))
    assert.equal(out.field, 'body', body)
  }
  assert.match(checkComment(comment({ body: 'Read it at https://example.com today' })).error, /No links/)
  assert.equal(checkComment(comment({ body: 'Hello <script>alert(1)</script>' })).error, 'Plain text only, no HTML.')
  assert.equal(checkComment(comment({ body: 'aaaaaaaaaaaa' })).field, 'body')
  assert.equal(checkComment(comment({ body: 'Call 0300 1234 5678 now' })).field, 'body')
})

test('checkComment: shape, guide, parent and ticket', () => {
  assert.ok(checkComment(null).error)
  assert.ok(checkComment([]).error)
  assert.match(checkComment(comment({ extra: 1 })).error, /unknown field/)
  assert.equal(checkComment(comment({ guide: 'Not A Slug' })).error, 'unknown guide')
  assert.equal(checkComment(comment({ guide: '../x' })).error, 'unknown guide')
  for (const parent of [-1, 1.5, 'x', '1e3', {}]) assert.equal(checkComment(comment({ parent })).error, 'unknown comment to reply to', String(parent))
  assert.equal(checkComment(comment({ token: '' })).error, 'the browser check is missing')
})

test('/_comment: saves a pending comment, no IP kept', async () => {
  const { db, env } = world()
  const res = await handleComment(post('/_comment', comment()), env, opts)
  assert.equal(res.status, 200)
  const out = await res.json()
  assert.deepEqual(out, { ok: true, message: 'Thank you. Your comment shows here once it is approved.' })
  const row = db.raw.prepare('SELECT * FROM guide_comments').get()
  assert.equal(row.guide, 'naruto-strongest-characters')
  assert.equal(row.parent_id, null)
  assert.equal(row.name, 'Mia')
  assert.equal(row.status, 'pending')
  assert.equal(row.day, '2026-10-04')
  assert.equal(row.approved_at, null)
  assert.ok(row.sender)
  assert.ok(!JSON.stringify(row).includes('203.0.113.7'))
})

test('/_comment: method, origin, size, body, ticket and guide are checked', async () => {
  const { db, env } = world()
  assert.equal((await handleComment(new Request(`${SITE}/_comment`), env, opts)).status, 405)
  assert.equal((await handleComment(post('/_comment', comment(), { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }), env, opts)).status, 403)
  assert.equal((await handleComment(post('/_comment', 'x'.repeat(13000)), env, opts)).status, 413)
  assert.equal((await handleComment(post('/_comment', '{nope'), env, opts)).status, 400)
  const bad = await handleComment(post('/_comment', comment({ body: 'see www.example.com' })), env, opts)
  assert.equal(bad.status, 400)
  assert.equal((await bad.json()).field, 'body')
  assert.equal((await handleComment(post('/_comment', comment()), env, { ...opts, verify: no })).status, 403)
  assert.equal((await handleComment(post('/_comment', comment({ guide: 'no-such-guide' })), env, opts)).status, 404)
  // Without a guide list, nothing is accepted.
  assert.equal((await handleComment(post('/_comment', comment()), env, { now: NOW, verify: yes })).status, 404)
  assert.equal((await handleComment(post('/_comment', comment()), { ANALYTICS: db }, opts)).status, 503)
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM guide_comments').get().n, 0)
})

test('/_comment: a reply needs an approved parent on the same guide', async () => {
  const { db, env } = world()
  const top = await approved(db, env)
  // A pending comment cannot take a reply.
  await handleComment(post('/_comment', comment({ body: 'Still waiting.' })), env, opts)
  const pendingId = db.raw.prepare("SELECT id FROM guide_comments WHERE status = 'pending'").get().id
  const refused = await handleComment(post('/_comment', comment({ parent: pendingId })), env, opts)
  assert.equal(refused.status, 400)
  assert.match((await refused.json()).error, /cannot take a reply/)
  // Nor can one on another guide, or one that does not exist.
  const other = await approved(db, env, { guide: 'best-romance-manhwa' })
  assert.equal((await handleComment(post('/_comment', comment({ parent: other })), env, opts)).status, 400)
  assert.equal((await handleComment(post('/_comment', comment({ parent: 9999 })), env, opts)).status, 400)

  const ok = await handleComment(post('/_comment', comment({ parent: top, name: 'Leo', body: 'Agreed, top three.' })), env, opts)
  assert.equal(ok.status, 200)
  const row = db.raw.prepare('SELECT parent_id, status FROM guide_comments WHERE name = ?').get('Leo')
  assert.deepEqual({ ...row }, { parent_id: top, status: 'pending' })
})

test('/_comment: ten a day per address, then 429; a new day or address is fresh', async () => {
  const { env } = world()
  for (let i = 0; i < DAILY_COMMENTS; i++) assert.equal((await handleComment(post('/_comment', comment()), env, opts)).status, 200)
  const res = await handleComment(post('/_comment', comment()), env, opts)
  assert.equal(res.status, 429)
  assert.match((await res.json()).error, /10 comments today/)
  assert.equal((await handleComment(post('/_comment', comment(), { 'cf-connecting-ip': '198.51.100.9' }), env, opts)).status, 200)
  assert.equal((await handleComment(post('/_comment', comment()), env, { ...opts, now: NOW + 86400000 })).status, 200)
})

test('/_comment: paused when more than 500 wait', async () => {
  const { db, env } = world()
  const insert = db.raw.prepare(
    "INSERT INTO guide_comments (guide, name, body, day, created_at) VALUES ('best-romance-manhwa', 'x', 'x', '2026-10-01', '2026-10-01T00:00:00Z')"
  )
  for (let i = 0; i < MAX_PENDING_COMMENTS; i++) insert.run()
  // Exactly 500 waiting still lets one more in.
  assert.equal((await handleComment(post('/_comment', comment()), env, opts)).status, 200)
  const res = await handleComment(post('/_comment', comment()), env, opts)
  assert.equal(res.status, 503)
  assert.match((await res.json()).error, /Comments are paused/)
})

test('threadComments: one level, replies to replies under the top comment', () => {
  const rows = [
    { id: 4, parent_id: 2, name: 'Cy', body: 'c', created_at: '2026-10-04T03:00:00Z' },
    { id: 1, parent_id: null, name: 'Ana', body: 'a', created_at: '2026-10-04T01:00:00Z' },
    { id: 2, parent_id: 1, name: 'Bo', body: 'b', created_at: '2026-10-04T02:00:00Z' },
    { id: 3, parent_id: null, name: 'Di', body: 'd', created_at: '2026-10-04T02:30:00Z' },
    // Its top comment was removed: left out.
    { id: 6, parent_id: 99, name: 'Ed', body: 'e', created_at: '2026-10-04T04:00:00Z' },
  ]
  const thread = threadComments(rows)
  assert.deepEqual(thread, [
    {
      id: 1,
      name: 'Ana',
      body: 'a',
      created_at: '2026-10-04T01:00:00Z',
      replies: [
        { id: 2, name: 'Bo', body: 'b', created_at: '2026-10-04T02:00:00Z', to: null },
        { id: 4, name: 'Cy', body: 'c', created_at: '2026-10-04T03:00:00Z', to: 'Bo' },
      ],
    },
    { id: 3, name: 'Di', body: 'd', created_at: '2026-10-04T02:30:00Z', replies: [] },
  ])
  assert.equal(commentCount(thread), 4)
  assert.deepEqual(threadComments([]), [])
})

test('/_comments: only approved comments, threaded, kept at the edge for five minutes', async () => {
  const { db, env } = world()
  const top = await approved(db, env)
  await approved(db, env, { parent: top, name: 'Leo', body: 'Agreed.' })
  await handleComment(post('/_comment', comment({ name: 'Pending', body: 'Not yet approved.' })), env, opts)
  await approved(db, env, { guide: 'best-romance-manhwa', name: 'Elsewhere' })

  const cache = memoryCache()
  const ask = (q) => new Request(`${SITE}/_comments?guide=${q}`)
  const res = await handleCommentsRead(ask('naruto-strongest-characters'), env, null, { cache, hasGuide })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('cache-control'), `public, max-age=0, s-maxage=${READ_CACHE_SECONDS}`)
  const out = await res.json()
  assert.equal(out.ok, true)
  assert.equal(out.count, 2)
  assert.equal(out.comments.length, 1)
  assert.equal(out.comments[0].name, 'Mia')
  assert.deepEqual(out.comments[0].replies.map((r) => r.name), ['Leo'])
  assert.ok(!JSON.stringify(out).includes('Pending'))
  assert.ok(!JSON.stringify(out).includes('sender'))
  assert.equal(cache.store.size, 1)

  // A second read is served from the cache, even after a new approval.
  await approved(db, env, { name: 'Late' })
  const again = await (await handleCommentsRead(ask('naruto-strongest-characters'), env, null, { cache, hasGuide })).json()
  assert.equal(again.count, 2)

  assert.equal((await handleCommentsRead(ask('no-such-guide'), env, null, { cache, hasGuide })).status, 404)
  assert.equal((await handleCommentsRead(ask('Bad%20Slug'), env, null, { cache, hasGuide })).status, 404)
  assert.equal((await handleCommentsRead(new Request(`${SITE}/_comments?guide=x`, { method: 'POST' }), env, null, { hasGuide })).status, 405)
  // No database: an empty answer that the edge does not keep.
  const down = await handleCommentsRead(ask('best-romance-manhwa'), {}, null, { cache, hasGuide })
  assert.equal(down.status, 503)
  assert.equal(down.headers.get('cache-control'), 'no-store')
})

test('night job blanks two-day-old senders', async () => {
  const { db, env } = world()
  await handleComment(post('/_comment', comment()), env, opts)
  await forgetCommentSenders(db, NOW + 86400000)
  assert.ok(db.raw.prepare('SELECT sender FROM guide_comments').get().sender)
  await forgetCommentSenders(db, NOW + 3 * 86400000)
  assert.equal(db.raw.prepare('SELECT sender FROM guide_comments').get().sender, null)
  await forgetCommentSenders(null)
})

test('owner taps: approve, delete with replies, and every refusal', async () => {
  const { db, env } = world()
  await handleComment(post('/_comment', comment()), env, opts)
  const { id } = db.raw.prepare('SELECT id FROM guide_comments').get()
  const tap = async (body, headers = {}) => post('/my-admin/api/comment', body, { cookie: `mi_admin=${await ownerCookie()}`, ...headers })

  assert.equal((await handleCommentTap(new Request(`${SITE}/my-admin/api/comment`), env)).status, 405)
  assert.equal((await handleCommentTap(await tap({ op: 'approve', id }, { cookie: null }), env)).status, 401)
  assert.equal((await handleCommentTap(await tap({ op: 'approve', id }, { cookie: `mi_admin=${await ownerCookie('wrong')}` }), env)).status, 401)
  assert.equal((await handleCommentTap(await tap({ op: 'approve', id }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }), env)).status, 403)
  assert.equal((await handleCommentTap(await tap({ op: 'done', id }), env)).status, 400)
  assert.equal((await handleCommentTap(await tap({ op: 'approve', id: 0 }), env)).status, 400)
  assert.equal((await handleCommentTap(await tap({ op: 'approve', id, extra: 1 }), env)).status, 400)
  assert.equal((await handleCommentTap(await tap({ op: 'approve', id: 999 }), env)).status, 404)

  const ok = await handleCommentTap(await tap({ op: 'approve', id }), env, NOW)
  assert.equal(ok.status, 200)
  assert.match((await ok.json()).message, /within 5 minutes/)
  const row = db.raw.prepare('SELECT status, approved_at FROM guide_comments WHERE id = ?').get(id)
  assert.deepEqual({ ...row }, { status: 'approved', approved_at: new Date(NOW).toISOString() })
  const log = db.raw.prepare('SELECT action, note FROM admin_log').get()
  assert.equal(log.action, 'approve comment')
  assert.match(log.note, /naruto-strongest-characters/)

  // A reply, and a reply to that reply; deleting the top takes all three.
  const reply = await approved(db, env, { parent: id, name: 'Leo', body: 'Agreed.' })
  await approved(db, env, { parent: reply, name: 'Cy', body: 'Same here.' })
  await approved(db, env, { name: 'Keep', body: 'Stays.' })
  const del = await handleCommentTap(await tap({ op: 'delete', id }), env)
  assert.equal(del.status, 200)
  assert.deepEqual(db.raw.prepare('SELECT name FROM guide_comments').all().map((r) => r.name), ['Keep'])
  assert.equal((await handleCommentTap(await tap({ op: 'delete', id }), env)).status, 404)
})

test('checkCommentTap is strict', () => {
  assert.deepEqual(checkCommentTap({ op: 'delete', id: 3 }).value, { op: 'delete', id: 3 })
  assert.ok(checkCommentTap(null).error)
  assert.ok(checkCommentTap({ op: 'approve', id: '3' }).error)
})
