// The three reader forms (feedback, contact, sponsor): the strict check, the
// /_message door with its daily limit and pause, the night job, and the
// owner's Mark done / Delete buttons, over the real schema in a D1 stand-in.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkMessage, cleanPage, cleanWebsite, checkMessageTap, DAILY_MESSAGES, MAX_NEW } from '../src/lib/messages.mjs'
import { handleMessage, forgetMessageSenders } from '../src/lib/messages-api.js'
import { handleMessageTap } from '../src/lib/message-actions.js'
import { analyticsD1 } from './d1-shim.js'

const SITE = 'https://manhwaindex.com'
const SECRET = 'correct horse battery staple'
const NOW = Date.parse('2026-10-04T08:00:00Z')
const TEXT = 'The Tapas link on this page is dead.'

const feedback = (extra = {}) => ({ kind: 'feedback', body: TEXT, token: 't', ...extra })
const contact = (extra = {}) => ({ kind: 'contact', email: 'a@example.com', topic: 'Business or press', body: TEXT, token: 't', ...extra })
const sponsor = (extra = {}) => ({ kind: 'sponsor', email: 'ads@example.com', topic: 'Sponsored spot', body: TEXT, token: 't', ...extra })

async function ownerCookie(word = SECRET) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`manhwaindex:${word}`))
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const world = () => {
  const db = analyticsD1()
  return { db, env: { ANALYTICS: db, PASS_KEY: 'k', TURNSTILE_SECRET: 's', ADMIN_SECRET: SECRET } }
}
const yes = async () => true
const no = async () => false

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

test('checkMessage: each kind takes its own fields', () => {
  const f = checkMessage(feedback({ page: '/manhwa/solo-leveling', topic: 'Wrong or dead link' }))
  assert.equal(f.error, undefined)
  assert.equal(f.value.page, '/manhwa/solo-leveling')
  assert.equal(f.value.email, '')
  // Feedback may leave the topic, the email and the name empty.
  assert.equal(checkMessage(feedback()).value.topic, '')

  assert.equal(checkMessage(contact()).value.topic, 'Business or press')
  assert.equal(checkMessage(contact({ email: '' })).field, 'email')
  assert.equal(checkMessage(contact({ topic: '' })).field, 'topic')
  assert.equal(checkMessage(contact({ topic: 'Sponsored spot' })).field, 'topic')
  assert.match(checkMessage(contact({ page: '/x' })).error, /unknown field/)

  const s = checkMessage(sponsor({ company: 'Inkpot', website: 'https://inkpot.example/about', budget: '$100 a month' }))
  assert.equal(s.error, undefined)
  assert.deepEqual([s.value.company, s.value.website, s.value.budget], ['Inkpot', 'https://inkpot.example/about', '$100 a month'])
  assert.equal(checkMessage(sponsor({ budget: 'x'.repeat(61) })).field, 'budget')
  assert.match(checkMessage(feedback({ website: 'https://a.example' })).error, /unknown field/)

  assert.equal(checkMessage({ kind: 'other', body: TEXT, token: 't' }).error, 'unknown form')
  assert.equal(checkMessage(feedback({ token: '' })).error, 'the browser check is missing')
  // Links are fine: a message is private to the owner.
  assert.equal(checkMessage(contact({ body: 'See https://example.com/page for the dead link.' })).error, undefined)
})

test('checkMessage: bad email, short or long body, HTML', () => {
  for (const email of ['nope', 'a@b', 'a b@c.com', 'a@b.c', 'x@example.com?subject=hi', `${'a'.repeat(190)}@example.com`, 'a@example.com\u0000']) {
    assert.equal(checkMessage(contact({ email })).field, 'email', email)
  }
  assert.equal(checkMessage(feedback({ email: 'not-an-email' })).field, 'email')
  assert.equal(checkMessage(feedback({ body: '  too short ' })).field, 'body')
  assert.equal(checkMessage(feedback({ body: 'x '.repeat(1600) })).field, 'body')
  assert.equal(checkMessage(feedback({ body: 'Hello <script>alert(1)</script> there' })).field, 'body')
  assert.equal(checkMessage(feedback({ name: '<b>Bold</b>' })).field, 'name')
  assert.equal(checkMessage(feedback({ name: 'n'.repeat(81) })).field, 'name')
  assert.equal(checkMessage(feedback({ body: 42 })).field, 'body')
})

test('checkMessage: control characters are stripped, line breaks kept', () => {
  const out = checkMessage(feedback({ name: 'Ana\u0007\nLee', body: 'Line one\u0000 here\r\nLine two\u001b here' }))
  assert.equal(out.error, undefined)
  assert.equal(out.value.name, 'Ana Lee')
  assert.equal(out.value.body, 'Line one here\nLine two here')
})

test('page and website checks', () => {
  assert.equal(cleanPage(''), '')
  assert.equal(cleanPage('/manga/berserk?x=1'), '/manga/berserk?x=1')
  for (const bad of ['manga/berserk', '//evil.example', '/a//b', 'https://evil.example', '/a b', '/a\u0000', `/${'a'.repeat(300)}`, '/a\\b', '/"x']) {
    assert.equal(cleanPage(bad), null, bad)
    assert.equal(checkMessage(feedback({ page: bad })).field, 'page', bad)
  }
  assert.equal(cleanWebsite(''), '')
  assert.equal(cleanWebsite('http://shop.example'), 'http://shop.example')
  for (const bad of ['javascript:alert(1)', 'shop.example', 'ftp://shop.example', 'https://localhost', 'https://u:p@shop.example', 'https://a.example/ x', `https://a.example/${'a'.repeat(200)}`]) {
    assert.equal(cleanWebsite(bad), null, bad)
    assert.equal(checkMessage(sponsor({ website: bad })).field, 'website', bad)
  }
})

test('/_message: saves a message, no IP kept', async () => {
  const { db, env } = world()
  const res = await handleMessage(post('/_message', feedback({ page: '/anime/frieren', name: 'Mia' })), env, { now: NOW, verify: yes })
  assert.equal(res.status, 200)
  const out = await res.json()
  assert.equal(out.ok, true)
  assert.equal(out.message, 'Thank you. Your message reached the site owner.')
  const row = db.raw.prepare('SELECT * FROM messages').get()
  assert.equal(row.kind, 'feedback')
  assert.equal(row.page, '/anime/frieren')
  assert.equal(row.name, 'Mia')
  assert.equal(row.status, 'new')
  assert.equal(row.day, '2026-10-04')
  assert.ok(row.sender && !row.sender.includes('203.0.113.7'))
  assert.ok(!JSON.stringify(row).includes('203.0.113.7'))
})

test('/_message: method, origin, size, ticket and body are checked', async () => {
  const { db, env } = world()
  const opts = { now: NOW, verify: yes }
  assert.equal((await handleMessage(new Request(`${SITE}/_message`), env, opts)).status, 405)
  assert.equal((await handleMessage(post('/_message', contact(), { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }), env, opts)).status, 403)
  assert.equal((await handleMessage(post('/_message', 'x'.repeat(17000)), env, opts)).status, 413)
  assert.equal((await handleMessage(post('/_message', '{nope'), env, opts)).status, 400)
  const bad = await handleMessage(post('/_message', contact({ email: 'nope' })), env, opts)
  assert.equal(bad.status, 400)
  assert.equal((await bad.json()).field, 'email')
  assert.equal((await handleMessage(post('/_message', contact()), env, { now: NOW, verify: no })).status, 403)
  assert.equal((await handleMessage(post('/_message', contact()), { ANALYTICS: db }, opts)).status, 503)
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 0)
})

test('/_message: five a day per address, then 429; a new day or address is fresh', async () => {
  const { env } = world()
  const opts = { now: NOW, verify: yes }
  for (let i = 0; i < DAILY_MESSAGES; i++) assert.equal((await handleMessage(post('/_message', contact()), env, opts)).status, 200)
  const res = await handleMessage(post('/_message', sponsor()), env, opts)
  assert.equal(res.status, 429)
  assert.match((await res.json()).error, /5 messages today/)
  assert.equal((await handleMessage(post('/_message', contact(), { 'cf-connecting-ip': '198.51.100.9' }), env, opts)).status, 200)
  assert.equal((await handleMessage(post('/_message', contact()), env, { now: NOW + 86400000, verify: yes })).status, 200)
})

test('/_message: paused when too many are new', async () => {
  const { db, env } = world()
  const insert = db.raw.prepare("INSERT INTO messages (kind, body, day, created_at) VALUES ('feedback', 'x', '2026-10-01', '2026-10-01T00:00:00Z')")
  for (let i = 0; i < MAX_NEW; i++) insert.run()
  const res = await handleMessage(post('/_message', feedback()), env, { now: NOW, verify: yes })
  assert.equal(res.status, 503)
  assert.match((await res.json()).error, /Messages are paused for a little while/)
  // Once the owner marks some done, the forms open again.
  db.raw.exec("UPDATE messages SET status = 'done' WHERE id <= 10")
  assert.equal((await handleMessage(post('/_message', feedback()), env, { now: NOW, verify: yes })).status, 200)
})

test('night job blanks two-day-old senders', async () => {
  const { db, env } = world()
  await handleMessage(post('/_message', feedback()), env, { now: NOW, verify: yes })
  await forgetMessageSenders(db, NOW + 86400000)
  assert.ok(db.raw.prepare('SELECT sender FROM messages').get().sender)
  await forgetMessageSenders(db, NOW + 3 * 86400000)
  assert.equal(db.raw.prepare('SELECT sender FROM messages').get().sender, null)
  await forgetMessageSenders(null)
})

test('owner taps: mark done, delete, and every refusal', async () => {
  const { db, env } = world()
  await handleMessage(post('/_message', sponsor()), env, { now: NOW, verify: yes })
  const { id } = db.raw.prepare('SELECT id FROM messages').get()
  const tap = async (body, headers = {}) => post('/my-admin/api/message', body, { cookie: `mi_admin=${await ownerCookie()}`, ...headers })

  assert.equal((await handleMessageTap(new Request(`${SITE}/my-admin/api/message`), env)).status, 405)
  assert.equal((await handleMessageTap(await tap({ op: 'done', id }, { cookie: null }), env)).status, 401)
  assert.equal((await handleMessageTap(await tap({ op: 'done', id }, { cookie: `mi_admin=${await ownerCookie('wrong')}` }), env)).status, 401)
  assert.equal((await handleMessageTap(await tap({ op: 'done', id }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }), env)).status, 403)
  assert.equal((await handleMessageTap(await tap({ op: 'approve', id }), env)).status, 400)
  assert.equal((await handleMessageTap(await tap({ op: 'done', id: -1 }), env)).status, 400)
  assert.equal((await handleMessageTap(await tap({ op: 'done', id, extra: 1 }), env)).status, 400)

  const ok = await handleMessageTap(await tap({ op: 'done', id }), env, NOW)
  assert.equal(ok.status, 200)
  assert.equal((await ok.json()).message, 'Marked done.')
  assert.equal(db.raw.prepare('SELECT status FROM messages WHERE id = ?').get(id).status, 'done')
  const log = db.raw.prepare('SELECT action, note FROM admin_log').get()
  assert.equal(log.action, 'done message')
  assert.match(log.note, /sponsor, Sponsored spot/)

  assert.equal((await handleMessageTap(await tap({ op: 'delete', id }), env)).status, 200)
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 0)
  assert.equal((await handleMessageTap(await tap({ op: 'delete', id }), env)).status, 404)
})

test('checkMessageTap is strict', () => {
  assert.deepEqual(checkMessageTap({ op: 'done', id: 3 }).value, { op: 'done', id: 3 })
  assert.ok(checkMessageTap(null).error)
  assert.ok(checkMessageTap({ op: 'done', id: '3' }).error)
})
