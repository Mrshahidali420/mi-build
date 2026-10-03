// Three homepage upgrades: Top rated by readers, the one Coming up list, and
// Hot this week without titles that have no official link.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ratedShelf, cleanRatings, ratedBadge, RATED_SECTION } from '../src/lib/reader-rated.mjs'
import { SHOW_AVERAGE_FROM, ratingOf } from '../src/lib/reviews.mjs'
import { comingUp, upcomingAnime } from '../src/lib/schedule.mjs'
import { homeShelf, loadReaderRatings } from '../src/lib/home-auto.js'
import { hasOfficialLink, searchingMiss } from '../src/lib/home-searching.mjs'
import { SECTIONS } from '../src/lib/home-plan.mjs'
import { runRatings, RATINGS_QUERY } from '../scripts/pull-ratings.mjs'

// ------------------------------------------------------------ Top rated

const book = (id, over = {}) => ({
  id, kind: 'manhwa', slug: `t-${id}`, title: `Title ${id}`, cover: `https://img/${id}.jpg`, score: 80,
  readLinks: [{ site: 'WEBTOON' }], watchLinks: [], ...over,
})
const catalogOf = (ids) => {
  const map = new Map(ids.map((id) => [id, { item: book(id) }]))
  return (id) => map.get(id)
}
// votes, total -> average total / votes.
const r = (id, votes, total) => ({ id, votes, total })

test('only titles with the minimum votes count, best average first, then most votes', () => {
  const rows = [
    r(1, 3, 12), // 4.0
    r(2, 10, 46), // 4.6
    r(3, 5, 23), // 4.6, fewer votes than 2
    r(4, 2, 10), // 5.0 but only 2 votes: does not count
    r(5, 4, 12), // 3.0
    r(6, 20, 80), // 4.0, more votes than 1
  ]
  const shelf = ratedShelf(rows, { lookup: catalogOf([1, 2, 3, 4, 5, 6]) })
  assert.ok(shelf)
  assert.equal(shelf.key, 'rated')
  assert.equal(shelf.title, 'Top rated by readers')
  assert.deepEqual(shelf.items.map((it) => it.id), [2, 3, 6, 1, 5])
  assert.equal(SHOW_AVERAGE_FROM, 3)
})

test('each card carries the readers average and count, and not the AniList score', () => {
  const shelf = ratedShelf([r(1, 12, 55), r(2, 3, 9), r(3, 3, 9), r(4, 3, 9)], { lookup: catalogOf([1, 2, 3, 4]) })
  const first = shelf.items[0]
  assert.equal(first.badge, '4.6 from 12 readers')
  assert.equal(first.readerAvg, 4.6)
  assert.equal(first.readerVotes, 12)
  assert.equal(first.score, null)
  assert.equal(first.cover, 'https://img/1.jpg')
  assert.equal(first.slug, 't-1')
  assert.equal(first.kind, 'manhwa')
})

test('the catalog record is never changed', () => {
  const rec = book(1)
  const lookup = (id) => (id === 1 ? { item: rec } : { item: book(id) })
  ratedShelf([r(1, 3, 15), r(2, 3, 15), r(3, 3, 15), r(4, 3, 15)], { lookup })
  assert.equal(rec.score, 80)
  assert.equal(rec.badge, undefined)
})

test('under four qualifying titles the shelf is not drawn', () => {
  const lookup = catalogOf([1, 2, 3, 4])
  assert.equal(ratedShelf([r(1, 3, 12), r(2, 3, 12), r(3, 3, 12)], { lookup }), null)
  // Today: two votes in the whole table.
  assert.equal(ratedShelf([r(1, 1, 5), r(2, 1, 4)], { lookup }), null)
  assert.equal(ratedShelf([], { lookup }), null)
  assert.ok(ratedShelf([r(1, 3, 12), r(2, 3, 12), r(3, 3, 12), r(4, 3, 12)], { lookup }))
  assert.equal(RATED_SECTION.floor, 4)
})

test('at most twelve titles', () => {
  const ids = Array.from({ length: 20 }, (_, i) => i + 1)
  const shelf = ratedShelf(ids.map((id) => r(id, 3 + id, 4 * (3 + id))), { lookup: catalogOf(ids) })
  assert.equal(shelf.items.length, 12)
  // All 4.0: the most votes go first.
  assert.equal(shelf.items[0].id, 20)
})

test('titles gone from the catalog, already on the page, or turned away by the filter drop out', () => {
  const lookup = catalogOf([1, 2, 3, 4, 5, 6])
  const rows = [1, 2, 3, 4, 5, 6, 7].map((id) => r(id, 3, 12))
  const shelf = ratedShelf(rows, { lookup, onPage: new Set([2]), keep: (item) => item.id !== 3 })
  assert.deepEqual(shelf.items.map((it) => it.id), [1, 4, 5, 6])
  assert.equal(ratedShelf(rows, { lookup, onPage: new Set([1, 2]), keep: (item) => item.id !== 3 }), null)
})

test('bad rows are ignored: broken averages, bad ids, duplicates', () => {
  const rows = [
    { anilist_id: 9, votes: 3, total: 12 },
    r(9, 5, 25),
    r(-1, 3, 12),
    r('x', 3, 12),
    r(10, 3, 30), // average 10: broken
    r(11, 3, 2), // average under 1: broken
    null,
  ]
  assert.deepEqual(cleanRatings(rows), [{ id: 9, votes: 3, total: 12 }])
  assert.deepEqual(cleanRatings(null), [])
  assert.equal(ratedBadge(ratingOf({ votes: 3, total: 14 })), '4.7 from 3 readers')
})

test('the nightly copy writes the qualifying totals and never throws for D1 trouble', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ratings-'))
  const quiet = () => {}
  let asked = null
  const ok = await runRatings({
    query: async (sql, params) => {
      asked = { sql, params }
      return [{ anilist_id: 5, votes: 4, total: 18 }, { anilist_id: 6, votes: 1, total: 5 }]
    },
    dataDir: dir,
    night: '2026-10-03',
    say: quiet,
  })
  assert.equal(ok.ok, true)
  assert.equal(asked.sql, RATINGS_QUERY)
  assert.deepEqual(asked.params, [SHOW_AVERAGE_FROM])
  assert.match(RATINGS_QUERY, /^SELECT .* FROM rating_totals WHERE votes >= \?/)
  const file = join(dir, 'reader-ratings.json')
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  assert.deepEqual(saved, { night: '2026-10-03', min: 3, titles: [{ id: 5, votes: 4, total: 18 }] })
  assert.deepEqual(loadReaderRatings(file), [{ id: 5, votes: 4, total: 18 }])

  // A refused token leaves the last copy exactly as it was.
  const before = readFileSync(file, 'utf8')
  const bad = await runRatings({ query: async () => { throw new Error('D1 answered 403') }, dataDir: dir, night: '2026-10-04', say: quiet })
  assert.equal(bad.ok, false)
  assert.equal(readFileSync(file, 'utf8'), before)

  // Dry run writes nothing.
  const dryDir = mkdtempSync(join(tmpdir(), 'ratings-'))
  await runRatings({ query: async () => [], dataDir: dryDir, night: '2026-10-03', dry: true, say: quiet })
  assert.equal(existsSync(join(dryDir, 'reader-ratings.json')), false)
})

test('a missing or torn ratings file reads as no ratings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ratings-'))
  assert.deepEqual(loadReaderRatings(join(dir, 'nope.json')), [])
  const torn = join(dir, 'torn.json')
  writeFileSync(torn, '{"titles": [')
  assert.deepEqual(loadReaderRatings(torn), [])
})

// ------------------------------------------------------------ Coming up

const NOW = Date.UTC(2026, 9, 3, 12) / 1000 // 3 Oct 2026, noon UTC
const DAY = 86400
const show = (id, over = {}) => ({
  id, slug: `a-${id}`, title: `Anime ${id}`, cover: `https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/${id}.jpg`,
  kind: 'anime', format: 'TV', watchLinks: [{ site: 'Crunchyroll' }], popularity: 1000, ...over,
})
const onAir = (id, inDays, number = 3, over = {}) =>
  show(id, { status: 'RELEASING', nextEpisode: { at: NOW + inDays * DAY, number }, ...over })
// A premiere announced to the day, `inDays` from NOW (midnight UTC that day).
const premiere = (id, inDays, over = {}) => {
  const d = new Date((NOW + inDays * DAY) * 1000)
  return show(id, {
    status: 'NOT_YET_RELEASED',
    startDate: [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()],
    startPrecision: 'day',
    ...over,
  })
}

test('one list, each show once, soonest first', () => {
  // Show 3 premieres in two days: its first episode is "airing this week" and
  // its premiere is "coming soon". It must appear once, as its episode.
  const first = premiere(3, 2, { nextEpisode: { at: NOW + 2 * DAY + 3600, number: 1 } })
  const airing = [onAir(1, 0.5), first, onAir(2, 4)]
  const dated = upcomingAnime([first, premiere(4, 10), premiere(5, 1, { format: 'MOVIE' })], NOW).dated
  const rows = comingUp(airing, dated)
  assert.deepEqual(rows.map((x) => x.id), [1, 5, 3, 2, 4])
  assert.equal(new Set(rows.map((x) => x.id)).size, rows.length)
  const three = rows.find((x) => x.id === 3)
  assert.equal(three.what, 'Episode 1')
  assert.equal(three.at, NOW + 2 * DAY + 3600)
  assert.equal(rows.find((x) => x.id === 5).what, 'Movie premiere')
  assert.equal(rows.find((x) => x.id === 4).what, 'TV series premiere')
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].at <= rows[i].at)
})

test('every row has a small cover, an address and a countdown time', () => {
  const rows = comingUp([onAir(1, 1)], upcomingAnime([premiere(2, 5)], NOW).dated)
  for (const row of rows) {
    assert.match(row.cover, /\/cover\/medium\//)
    assert.ok(row.slug)
    assert.ok(Number.isFinite(row.at))
    assert.equal(row.platforms, 1)
  }
})

test('the list keeps room for premieres on a busy week', () => {
  const airing = Array.from({ length: 30 }, (_, i) => onAir(100 + i, 0.1 + i * 0.1))
  const dated = Array.from({ length: 10 }, (_, i) => premiere(200 + i, 2 + i))
  const rows = comingUp(airing, upcomingAnime(dated, NOW).dated)
  assert.equal(rows.filter((x) => x.what.endsWith('premiere')).length, 6)
  assert.equal(rows.filter((x) => x.what.startsWith('Episode')).length, 8)
  assert.equal(rows.length, 14)
})

test('a premiere already in the list as an episode does not use up a premiere place', () => {
  const both = premiere(1, 1, { nextEpisode: { at: NOW + DAY + 60, number: 1 } })
  const dated = upcomingAnime([both, premiere(2, 3), premiere(3, 4)], NOW).dated
  const rows = comingUp([both], dated, { datedMax: 2 })
  assert.deepEqual(rows.map((x) => x.id), [1, 2, 3])
})

test('an episode with no number still reads well', () => {
  const rows = comingUp([onAir(1, 1, null)], [])
  assert.equal(rows[0].what, 'Next episode')
})

// ------------------------------------------------------------ Hot this week

test('a cover with no official link is one the card says "no official link yet" for', () => {
  assert.equal(hasOfficialLink(book(1)), true)
  assert.equal(hasOfficialLink(book(1, { readLinks: [] })), false)
  // Anime is judged by where to watch, like the card.
  assert.equal(hasOfficialLink(show(1)), true)
  assert.equal(hasOfficialLink(show(1, { watchLinks: [], readLinks: [{ site: 'x' }] })), false)
  assert.equal(hasOfficialLink(null), false)
})

const plan = (items, next = []) => ({
  night: '2026-10-03',
  sections: { searching: { enabled: true, title: 'Hot this week', why: 'why', items } },
  next: { searching: next },
})
const ids = (list) => list.map((id) => ({ id, badge: '' }))

test('Hot this week drops linkless titles and fills their places from the next picks', () => {
  const linkless = new Set([2, 4])
  const lookup = (id) => ({ item: book(id, linkless.has(id) ? { readLinks: [] } : {}) })
  const shelf = homeShelf(plan(ids([1, 2, 3, 4, 5, 6]), ids([7, 8, 9])), 'searching', { lookup, keep: hasOfficialLink })
  assert.deepEqual(shelf.items.map((it) => it.id), [1, 3, 5, 6, 7, 8])
  for (const it of shelf.items) assert.ok(hasOfficialLink(it))
})

test('the backfill never makes the shelf longer than the plan, and skips linkless next picks too', () => {
  const linkless = new Set([2, 7])
  const lookup = (id) => ({ item: book(id, linkless.has(id) ? { readLinks: [] } : {}) })
  const shelf = homeShelf(plan(ids([1, 2, 3, 4, 5]), ids([7, 8, 9, 10])), 'searching', { lookup, keep: hasOfficialLink })
  assert.deepEqual(shelf.items.map((it) => it.id), [1, 3, 4, 5, 8])
  // Nothing turned away: the next picks stay off the shelf.
  const full = homeShelf(plan(ids([1, 3, 4, 5]), ids([8, 9])), 'searching', { lookup, keep: hasOfficialLink })
  assert.deepEqual(full.items.map((it) => it.id), [1, 3, 4, 5])
})

test('with too few linked titles left the shelf is not drawn', () => {
  const lookup = (id) => ({ item: book(id, id > 2 ? { readLinks: [] } : {}) })
  assert.equal(homeShelf(plan(ids([1, 2, 3, 4, 5])), 'searching', { lookup, keep: hasOfficialLink }), null)
  assert.equal(SECTIONS.searching.floor, 4)
})

test('without a keep test the shelves behave exactly as before', () => {
  const lookup = (id) => ({ item: book(id, { readLinks: [] }) })
  const shelf = homeShelf(plan(ids([1, 2, 3, 4]), ids([5])), 'searching', { lookup })
  assert.deepEqual(shelf.items.map((it) => it.id), [1, 2, 3, 4])
})

test('the planner turns away a catalog title with no official link for Hot this week', () => {
  const s = { gPeople7: 40, gDays7: 7, g7: 50, g30: 60, sPeople7: 0, sDays7: 0, s7: 0, entries7: 10, quick7: 0 }
  const ctx = { searchMode: 'volume', floors: {} }
  assert.equal(searchingMiss(s, book(1, { readLinks: [], popularity: 5000 }), ctx), 'no official link yet')
  assert.notEqual(searchingMiss(s, book(1, { popularity: 5000 }), ctx), 'no official link yet')
})
