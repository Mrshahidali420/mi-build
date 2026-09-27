// The owner's buttons: the rules they write (src/lib/owner-rules.mjs), and the
// one endpoint that writes them (src/lib/admin-actions.js), against a real
// SQLite with the real schema.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkTap, mergeRules, mergeKeep, tapStatements } from '../src/lib/owner-rules.mjs'
import { handleTap, crossSite } from '../src/lib/admin-actions.js'
import { cookieFrom, isOwner } from '../src/lib/admin.js'
import { planHome } from '../src/lib/home-plan.mjs'
import { analyticsD1 } from './d1-shim.js'

const SECRET = 'correct horse battery staple'
const SITE = 'https://manhwaindex.com'

/** The cookie gate() sets after the right word: the word's fingerprint. */
async function ownerCookie(word = SECRET) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`manhwaindex:${word}`))
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function tapRequest(body, over = {}) {
  const headers = {
    origin: SITE,
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json',
    cookie: `other=1; mi_admin=${await ownerCookie()}`,
    ...over.headers,
  }
  for (const [k, v] of Object.entries(headers)) if (v === null) delete headers[k]
  const method = over.method || 'POST'
  return new Request(`${SITE}/my-admin/api/rule`, {
    method,
    headers,
    body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const world = () => {
  const db = analyticsD1()
  return { db, env: { ADMIN_SECRET: SECRET, ANALYTICS: db } }
}
const rulesIn = (db) => db.raw.prepare('SELECT anilist_id, action, section, note FROM home_rules ORDER BY anilist_id').all().map((r) => ({ ...r }))
const logIn = (db) => db.raw.prepare('SELECT action, anilist_id FROM admin_log ORDER BY id').all().map((r) => ({ ...r }))

// ------------------------------------------------------------------ auth

test('no cookie, a wrong cookie, or no ADMIN_SECRET: 401 and nothing written', async () => {
  const { db, env } = world()
  const body = { op: 'add', kind: 'ban', id: 5 }
  const cases = [
    await tapRequest(body, { headers: { cookie: null } }),
    await tapRequest(body, { headers: { cookie: `mi_admin=${await ownerCookie('wrong word')}` } }),
    await tapRequest(body, { headers: { cookie: `mi_admin=${SECRET}` } }),
  ]
  for (const req of cases) assert.equal((await handleTap(req, env)).status, 401)
  assert.equal((await handleTap(await tapRequest(body), { ANALYTICS: db })).status, 401, 'no secret set: no way in')
  assert.deepEqual(rulesIn(db), [])
  assert.deepEqual(logIn(db), [])
})

test('the owner check is the same door as the pages', async () => {
  assert.equal(cookieFrom('a=1; mi_admin=abc ; b=2'), 'abc')
  assert.equal(cookieFrom('xmi_admin=abc'), '')
  const req = await tapRequest({})
  assert.equal(await isOwner(req, { ADMIN_SECRET: SECRET }), true)
  assert.equal(await isOwner(req, { ADMIN_SECRET: 'another' }), false)
  assert.equal(await isOwner(req, {}), false)
})

// ------------------------------------------------------------------ CSRF

test('another origin, a cross-site fetch, a missing Origin or a form body: 403', async () => {
  const { db, env } = world()
  const body = { op: 'add', kind: 'ban', id: 5 }
  const cases = [
    { origin: 'https://evil.example' },
    { origin: 'https://manhwaindex.com.evil.example' },
    { origin: null },
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site' },
    { 'content-type': 'application/x-www-form-urlencoded' },
    { 'content-type': 'text/plain' },
  ]
  for (const headers of cases) {
    const res = await handleTap(await tapRequest(body, { headers }), env)
    assert.equal(res.status, 403, JSON.stringify(headers))
  }
  assert.deepEqual(rulesIn(db), [])
})

test('only POST', async () => {
  const { env } = world()
  const res = await handleTap(await tapRequest(null, { method: 'GET' }), env)
  assert.equal(res.status, 405)
  assert.equal(res.headers.get('allow'), 'POST')
})

test('a same-origin request passes the origin check', async () => {
  assert.equal(crossSite(await tapRequest({})), null)
  // An older browser without Sec-Fetch-Site still needs the right Origin.
  assert.equal(crossSite(await tapRequest({}, { headers: { 'sec-fetch-site': null } })), null)
})

// ------------------------------------------------------------ validation

test('strict input: only whole-number ids, known actions, real sections', () => {
  const bad = [
    null, [], 'x',
    { op: 'add', kind: 'ban', id: '12' },
    { op: 'add', kind: 'ban', id: 1.5 },
    { op: 'add', kind: 'ban', id: 0 },
    { op: 'add', kind: 'ban', id: -3 },
    { op: 'add', kind: 'ban', id: 2 ** 40 },
    { op: 'add', kind: 'delete', id: 1 },
    { op: 'drop', kind: 'ban', id: 1 },
    { op: 'add', kind: 'pin', id: 1 },
    { op: 'add', kind: 'pin', id: 1, section: 'nope' },
    { op: 'add', kind: 'pin', id: 1, section: '__proto__' },
    { op: 'add', kind: 'ban', id: 1, section: 'saving' },
    { op: 'add', kind: 'ban', id: 1, note: 'x'.repeat(121) },
    { op: 'add', kind: 'ban', id: 1, note: 7 },
    { op: 'add', kind: 'ban', id: 1, sql: 'DROP TABLE home_rules' },
  ]
  for (const body of bad) assert.ok(checkTap(body).error, JSON.stringify(body))
  assert.deepEqual(checkTap({ op: 'add', kind: 'pin', id: 7, section: 'saving', note: ' Solo\nLeveling ' }).value,
    { op: 'add', kind: 'pin', id: 7, section: 'saving', note: 'Solo Leveling' })
})

test('bad bodies answer 400 and write nothing', async () => {
  const { db, env } = world()
  for (const body of ['not json', { op: 'add', kind: 'ban', id: '1; DROP TABLE home_rules' }]) {
    assert.equal((await handleTap(await tapRequest(body), env)).status, 400)
  }
  assert.equal((await handleTap(await tapRequest('x'.repeat(2000)), env)).status, 413)
  assert.deepEqual(rulesIn(db), [])
})

// ------------------------------------------------------------ writes

test('add, replace and undo a rule; each tap is logged', async () => {
  const { db, env } = world()
  const post = async (body) => {
    const res = await handleTap(await tapRequest(body), env, Date.UTC(2026, 8, 27))
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    return res.json()
  }
  const sneaky = "Robert'); DROP TABLE home_rules;--"
  const first = await post({ op: 'add', kind: 'ban', id: 5, note: sneaky })
  assert.equal(first.message, "Saved. Applies at tonight's update.")
  assert.deepEqual(rulesIn(db), [{ anilist_id: 5, action: 'ban', section: '', note: sneaky }])
  // The latest tap is what the owner means: Keep replaces Hide.
  await post({ op: 'add', kind: 'pin', id: 5, section: 'rising', note: 'T5' })
  assert.deepEqual(rulesIn(db), [{ anilist_id: 5, action: 'pin', section: 'rising', note: 'T5' }])
  const undo = await post({ op: 'remove', kind: 'pin', id: 5 })
  assert.equal(undo.message, "Undone. Applies at tonight's update.")
  assert.deepEqual(rulesIn(db), [])
  assert.deepEqual(logIn(db).map((r) => r.action), ['add ban', 'add pin', 'remove pin'])
})

test('the keep list: add and remove', async () => {
  const { db, env } = world()
  await handleTap(await tapRequest({ op: 'add', kind: 'keep', id: 855 }), env)
  assert.deepEqual(db.raw.prepare('SELECT anilist_id FROM keep_media').all().map((r) => r.anilist_id), [855])
  await handleTap(await tapRequest({ op: 'remove', kind: 'keep', id: 855 }), env)
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM keep_media').get().n, 0)
  assert.deepEqual(mergeKeep({ characters: [1], media: [2] }, [{ anilist_id: 3 }, { anilist_id: 2 }, { anilist_id: 'x' }]),
    { characters: [1], media: [2, 3] })
})

test('every statement is parameterized', () => {
  for (const tap of [
    { op: 'add', kind: 'ban', id: 1, section: '', note: 'n' },
    { op: 'remove', kind: 'ban', id: 1, section: '', note: '' },
    { op: 'add', kind: 'keep', id: 1, section: '', note: 'n' },
  ]) {
    for (const [sql, args] of tapStatements(tap, '2026-09-27T00:00:00.000Z')) {
      assert.equal((sql.match(/\?/g) || []).length, args.length)
    }
  }
})

// ------------------------------------------------------------ the planner

test('rules from the file and the buttons merge; a ban wins over a pin', () => {
  const file = { ban: [1], pin: { saving: [2, 3] }, adultGenres: ['Hentai'] }
  const rows = [
    { anilist_id: 4, action: 'ban', section: '' },
    { anilist_id: 3, action: 'ban', section: '' },
    { anilist_id: 5, action: 'pin', section: 'rising' },
    { anilist_id: 6, action: 'pin', section: 'nope' },
    { anilist_id: -1, action: 'ban', section: '' },
  ]
  const merged = mergeRules(file, rows)
  assert.deepEqual(merged.ban, [1, 3, 4])
  assert.deepEqual(merged.pin, { saving: [2], rising: [5] })
  assert.deepEqual(merged.adultGenres, ['Hentai'], 'the adult lists are kept')
  assert.deepEqual(file.pin.saving, [2, 3], 'the file rules are not changed')
})

test('the planner honours a button ban and pin, and never pins an adult title', () => {
  const titles = new Map()
  const stats = new Map()
  for (let id = 1; id <= 12; id++) {
    titles.set(id, { id, title: `Title ${id}`, path: `/manhwa/t-${id}`, genres: ['Action'], tags: [], popularity: 5000 })
    stats.set(id, { saves7: 20 + id, unsaves7: 1, savers7: 20 + id, saveDays7: 4, opens7: 300, people7: 80, daysSeen7: 7, entries7: 40, quick7: 5 })
  }
  titles.set(11, { ...titles.get(11), genres: ['Ecchi'] })
  titles.set(12, { ...titles.get(12), isAdult: true })
  const file = { ban: [], pin: {}, adultGenres: ['Hentai', 'Ecchi'], tagBlock: [], titleWordBlock: [] }
  const rules = mergeRules(file, [
    { anilist_id: 10, action: 'ban', section: '' },
    { anilist_id: 1, action: 'pin', section: 'saving' },
    { anilist_id: 11, action: 'pin', section: 'saving' },
    { anilist_id: 12, action: 'pin', section: 'month' },
  ])
  const { plan, decisions } = planHome({ night: '2026-09-27', titles, stats, rules, prev: null })
  const all = Object.values(plan.sections).flatMap((s) => s.items.map((it) => it.id))
  assert.ok(!all.includes(10), 'banned')
  assert.ok(!all.includes(11) && !all.includes(12), 'adult pins refused')
  assert.equal(plan.sections.saving.items[0].id, 1)
  assert.ok(plan.sections.saving.items[0].pinned)
  assert.ok(decisions.some((d) => d.id === 11 && /pin refused: adult genre/.test(d.reason)))
  assert.ok(decisions.some((d) => d.id === 12 && /pin refused: marked adult/.test(d.reason)))
})
