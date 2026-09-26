// The phase 3 /my-admin views. See src/lib/admin-insights.js.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isTitlePath, usualRate, deadEnds, deadReason, platformCountries, countriesByPath,
  perThousand, moneyPer, threeChanges, DEAD_MIN_ENTRIES,
} from '../src/lib/admin-insights.js'

const page = (path, views, clicks, entries, over = {}) => ({ path, label: '', views, clicks, entries, buys: 0, ...over })

test('only /<kind>/<slug> is a title page', () => {
  assert.equal(isTitlePath('/manga/akira'), true)
  assert.equal(isTitlePath('/manga/akira/free'), false)
  assert.equal(isTitlePath('/character/x'), false)
  assert.equal(isTitlePath('/'), false)
})

test('the usual rate is the median of title pages over the floor', () => {
  const rows = [page('/manga/a', 100, 10, 0), page('/manga/b', 100, 20, 0), page('/manga/c', 100, 30, 0), page('/manga/d', 5, 5, 0), page('/genre/x', 100, 90, 0)]
  assert.equal(usualRate(rows), 0.2)
  assert.equal(usualRate([]), 0)
})

test('dead ends: sorted by lost clicks, floors applied, good pages left out', () => {
  const rows = [
    page('/manga/hot', 120, 2, 114), // the owner's case: 114 arrivals, almost no clicks
    page('/manga/ok', 100, 20, 50),
    page('/manga/meh', 100, 10, 50),
    page('/manga/tiny', 9, 0, DEAD_MIN_ENTRIES - 1),
    page('/manga/free-x/free', 300, 0, 200),
  ]
  const out = deadEnds(rows, { usual: 0.2 })
  assert.deepEqual(out.map((r) => r.path), ['/manga/hot', '/manga/meh'])
  assert.equal(out[0].lost, Math.round(114 * (0.2 - 2 / 120)))
})

test('the reason: no licence, Amazon only, language, country, or none', () => {
  const comic = (readLinks) => ({ kind: 'comic', readLinks })
  assert.equal(deadReason(comic([])).key, 'licence')
  assert.equal(deadReason(comic([]), { buys: 3 }).key, 'amazon')
  assert.match(deadReason(comic([{ site: 'KakaoPage', language: 'Korean' }])).text, /Korean/)
  const vizOnly = comic([{ site: 'VIZ', language: 'English' }])
  assert.equal(deadReason(vizOnly, { country: 'GB', countryLabel: 'United Kingdom' }).key, 'country')
  assert.equal(deadReason(vizOnly, { country: 'US' }), null)
  // A platform whose reach we do not know never produces a country reason.
  assert.equal(deadReason(comic([{ site: 'Mystery', language: 'English' }]), { country: 'GB' }), null)
  assert.equal(deadReason({ kind: 'anime', watchLinks: [] }).key, 'licence')
  assert.equal(deadReason(null), null)
})

test('platform reach comes from the facts table', () => {
  assert.equal(platformCountries('WEBTOON'), '*')
  assert.deepEqual(platformCountries('Hulu'), ['US', 'CA'])
  assert.equal(platformCountries('HIDIVE'), null)
  assert.equal(platformCountries('Nope'), null)
})

test('countries per path add up and keep the top three', () => {
  const rows = [
    { path: '/a', country: 'US', n: 60 }, { path: '/a', country: 'GB', n: 20 },
    { path: '/a', country: 'CA', n: 10 }, { path: '/a', country: 'IN', n: 10 },
  ]
  const a = countriesByPath(rows).get('/a')
  assert.equal(a.total, 100)
  assert.deepEqual(a.top.map((c) => [c.country, c.share]), [['US', 60], ['GB', 20], ['CA', 10]])
})

test('money per 1,000 views, with a views floor', () => {
  assert.equal(perThousand(3, 1000), 3)
  assert.equal(perThousand(1, 3), 333.3)
  assert.equal(perThousand(1, 0), 0)
  const out = moneyPer([
    { path: '/a', views: 1000, buys: 5 }, { path: '/b', views: 200, buys: 2 }, { path: '/c', views: 12, buys: 1 },
  ])
  assert.deepEqual(out.map((r) => [r.path, r.per1k]), [['/b', 10], ['/a', 5]])
})

test('three changes: spikes and drops past the floors, biggest first', () => {
  const days = ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']
  const last = '2026-09-26'
  const pages = [
    ...days.map((day) => ({ day, path: '/manga/spike', label: 'Spike', views: 20 })),
    { day: last, path: '/manga/spike', label: 'Spike', views: 114 },
    ...days.map((day) => ({ day, path: '/manga/drop', label: 'Drop', views: 60 })),
    { day: last, path: '/manga/drop', label: 'Drop', views: 10 },
    ...days.map((day) => ({ day, path: '/manga/flat', label: 'Flat', views: 50 })),
    { day: last, path: '/manga/flat', label: 'Flat', views: 55 },
    ...days.map((day) => ({ day, path: '/manga/small', label: 'Small', views: 2 })),
    { day: last, path: '/manga/small', label: 'Small', views: 15 },
  ]
  const sources = [...days.map((day) => ({ day, source: 'google.com', entries: 100 })), { day: last, source: 'google.com', entries: 40 }]
  const out = threeChanges({ pages, sources, last, nameOf: (p, l) => l || p, sourceOf: () => 'Google search' })
  assert.equal(out.length, 3)
  assert.match(out[0].text, /^Spike: 114 opens yesterday, 5\.5 times its usual 20 a day\.$/)
  assert.equal(out[0].tone, 'good')
  assert.match(out[1].text, /^Google search sent 40 arrivals yesterday, down from 100 a day\.$/)
  assert.match(out[2].text, /^Drop: 10 opens yesterday, down from 60 a day\.$/)
  for (const c of out) assert.doesNotMatch(c.text, /—/)
})

test('three changes: a quiet day says nothing', () => {
  assert.deepEqual(threeChanges({ pages: [], sources: [], last: '2026-09-26' }), [])
})
