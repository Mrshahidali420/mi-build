// Visits from Facebook: the counter in src/layouts/Base.astro marks them, and
// the admin helpers in src/lib/admin.js name them "Facebook" as one sender.
// The two counter functions are read straight out of the layout, so the test
// runs the code the page really ships.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { analyticsD1 } from './d1-shim.js'
import { cleanRow, INSERT_SQL } from '../src/lib/beacon-rows.js'
import { runRollup } from '../src/lib/rollup.js'
import { weekFacebook, weeks } from '../src/lib/admin-more.js'
import { FACEBOOK_EVENT_SQL, groupSenders, isFacebook, sourceKey, sourceName } from '../src/lib/admin.js'

const layout = readFileSync(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8')

/** One `function name(...) { ... }` out of the layout's inline script. */
function pull(name) {
  const start = layout.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `${name} is in Base.astro`)
  let depth = 0
  for (let i = layout.indexOf('{', start); i < layout.length; i += 1) {
    if (layout[i] === '{') depth += 1
    if (layout[i] === '}') depth -= 1
    if (depth === 0) return new Function(`${layout.slice(start, i + 1)}; return ${name}`)()
  }
  throw new Error(`${name} never closes`)
}

const miFacebook = pull('miFacebook')
const miNoFbclid = pull('miNoFbclid')

test('a fbclid on the address marks a Facebook visit', () => {
  assert.equal(miFacebook('?fbclid=IwAR0abc', ''), true)
  assert.equal(miFacebook('?q=one&fbclid=x', 'https://www.google.com/'), true)
})

test('every Facebook referrer host marks a Facebook visit', () => {
  for (const host of ['facebook.com', 'www.facebook.com', 'l.facebook.com', 'lm.facebook.com', 'm.facebook.com', 'fb.com']) {
    assert.equal(miFacebook('', `https://${host}/`), true, host)
  }
})

test('an old utm_source=facebook link still counts as Facebook', () => {
  assert.equal(miFacebook('?utm_source=facebook&utm_medium=social', ''), true)
  assert.equal(miFacebook('?utm_source=Facebook', ''), true)
})

test('anything else is not Facebook', () => {
  assert.equal(miFacebook('', ''), false)
  assert.equal(miFacebook('?utm_source=reddit', 'https://www.reddit.com/'), false)
  assert.equal(miFacebook('', 'https://notfacebook.com/'), false)
  assert.equal(miFacebook('', 'https://www.google.com/'), false)
  assert.equal(miFacebook('', 'not a url'), false)
})

test('fbclid comes off the address, and only fbclid', () => {
  assert.equal(miNoFbclid('https://manhwaindex.com/manga/x?fbclid=abc'), '/manga/x')
  assert.equal(miNoFbclid('https://manhwaindex.com/search?q=solo&fbclid=abc#top'), '/search?q=solo#top')
  assert.equal(miNoFbclid('https://manhwaindex.com/manga/x?q=solo'), '', 'nothing to take off')
  assert.equal(miNoFbclid('not a url'), '')
})

test('every Facebook source is named Facebook', () => {
  for (const s of ['utm:facebook', 'utm:facebook/social/post', 'utm:Facebook/social', 'l.facebook.com', 'lm.facebook.com', 'm.facebook.com', 'www.facebook.com', 'facebook.com', 'fb.com']) {
    assert.equal(sourceName(s), 'Facebook', s)
    assert.equal(sourceKey(s), 'utm:facebook', s)
  }
  assert.equal(isFacebook('utm:facebooker'), false)
  assert.equal(isFacebook('notfacebook.com'), false)
  assert.equal(sourceName('utm:reddit/social'), 'Your own link: reddit/social')
  assert.equal(sourceName('www.google.com'), 'Google search')
  assert.equal(sourceName(''), 'Typed the address')
})

test('the Facebook senders add up into one row', () => {
  const rows = groupSenders([
    { source: 'www.google.com', views: 9, entries: 5 },
    { source: 'l.facebook.com', views: 4, entries: 3 },
    { source: 'utm:facebook', views: 3, entries: 2 },
    { source: 'm.facebook.com', views: 3, entries: 1 },
  ])
  assert.deepEqual(rows, [
    { source: 'utm:facebook', views: 10, entries: 6 },
    { source: 'www.google.com', views: 9, entries: 5 },
  ])
})

test('the admin counts Facebook visits, today and night by night', async () => {
  const d1 = analyticsD1()
  const day = '2026-09-20'
  const at = Date.parse(`${day}T12:00:00Z`)
  const stmt = d1.raw.prepare(INSERT_SQL)
  const view = (session, step, extra) => ({ kind: 'view', name: 'page_view_scroll', path: '/manga/a', page_type: 'manga', visitor: session, session, step, ...extra })
  for (const row of [
    view('s1', 1, { campaign: 'facebook' }),
    view('s1', 2, {}),
    view('s2', 1, { campaign: 'facebook/social/post' }),
    view('s3', 1, { referrer: 'lm.facebook.com' }),
    view('s4', 1, { referrer: 'www.google.com' }),
    view('s5', 1, { campaign: 'reddit' }),
  ]) {
    const values = cleanRow(row, 'US', at)
    if (values) stmt.run(...values)
  }

  // The Now tab's question.
  const today = await d1
    .prepare(
      `SELECT COUNT(DISTINCT CASE WHEN step = 1 AND session <> '' AND ${FACEBOOK_EVENT_SQL}
              THEN session END) AS facebook
       FROM events WHERE day = ? AND kind = 'view'`
    )
    .bind(day)
    .first()
  assert.equal(today.facebook, 3)

  // The Week tab's, after the night job.
  await runRollup(d1, Date.parse('2026-09-21T00:10:00Z'))
  const days = await weekFacebook(d1, weeks(Date.parse('2026-09-21T09:00:00Z')))
  assert.equal(days.length, 14)
  assert.deepEqual(days.at(-1), { day, visits: 3 })
  assert.equal(days.slice(0, -1).every((row) => row.visits === 0), true)
})
