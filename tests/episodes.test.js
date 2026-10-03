// The episode list on anime title pages: how airing.json from the sister
// ingest and the record's own fields merge into dated rows (src/lib/episodes.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseStreamingTitle,
  indexAiring,
  buildEpisodes,
  attachEpisodes,
  airDate,
  isoDate,
  MIN_DATED_EPISODES,
} from '../src/lib/episodes.mjs'

const DAY = 86400
const T0 = 1783611660 // 9 Jul 2026

const show = (extra = {}) => ({ kind: 'anime', id: 196187, status: 'RELEASING', episodes: 12, ...extra })
const weekly = (from, to) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ at: T0 + (from - 1 + i) * 7 * DAY, episode: from + i }))

test('a streaming title reads its number and name, in every dash AniList uses', () => {
  assert.deepEqual(parseStreamingTitle('Episode 4 - The Promise'), { number: 4, title: 'The Promise' })
  assert.deepEqual(parseStreamingTitle('Episode 12 – Last Light'), { number: 12, title: 'Last Light' })
  assert.deepEqual(parseStreamingTitle('Episode 7: Home'), { number: 7, title: 'Home' })
  assert.deepEqual(parseStreamingTitle('Episode 3'), { number: 3, title: '' })
  assert.equal(parseStreamingTitle('Special - Recap'), null)
  assert.equal(parseStreamingTitle(null), null)
})

test('history rows become dated rows, oldest first, with titles where named', () => {
  const item = show({
    streamingEpisodes: [{ title: 'Episode 2 - Smoke Break' }, { title: 'Episode 1 - The Back Door' }],
  })
  const rows = buildEpisodes(item, weekly(1, 3).reverse())
  assert.deepEqual(rows, [
    [1, 'The Back Door', T0],
    [2, 'Smoke Break', T0 + 7 * DAY],
    [3, '', T0 + 14 * DAY],
  ])
})

test('titles counted across seasons are shifted to this season\'s own numbers', () => {
  // Season 3 of 3: the platform calls its episodes 25 to 36.
  const item = show({
    status: 'FINISHED',
    streamingEpisodes: [{ title: 'Episode 36 - The End' }, { title: 'Episode 26 - Second' }, { title: 'Episode 25 - First' }],
  })
  const rows = buildEpisodes(item, weekly(1, 12))
  assert.equal(rows[0][1], 'First')
  assert.equal(rows[1][1], 'Second')
  assert.equal(rows[11][1], 'The End')
  assert.equal(rows[5][1], '')
})

test('titles inside the season are never shifted', () => {
  const item = show({ streamingEpisodes: [{ title: 'Episode 12 - Last' }, { title: 'Episode 1 - First' }] })
  const rows = buildEpisodes(item, weekly(1, 12))
  assert.equal(rows[0][1], 'First')
  assert.equal(rows[11][1], 'Last')
})

test('an episode seen twice keeps its first air date', () => {
  const history = [
    { at: T0 + 30 * DAY, episode: 1 },
    { at: T0, episode: 1 },
    { at: T0 + 7 * DAY, episode: 2 },
  ]
  const window = [{ at: T0 + 60 * DAY, episode: 2, mediaId: 196187 }]
  const rows = buildEpisodes(show(), history, window)
  assert.deepEqual(rows.map((r) => r[2]), [T0, T0 + 7 * DAY])
})

test('the schedule window and nextEpisode add dates the history lacks', () => {
  const window = [{ at: T0 + 7 * DAY, episode: 2, mediaId: 196187 }]
  const item = show({ nextEpisode: { at: T0 + 14 * DAY, number: 3 } })
  const rows = buildEpisodes(item, [{ at: T0, episode: 1 }], window)
  assert.deepEqual(rows.map((r) => r[0]), [1, 2, 3])
})

test('nothing is invented: no airing rows, no list, even with a nextEpisode and titles', () => {
  const item = show({
    nextEpisode: { at: T0, number: 5 },
    streamingEpisodes: [{ title: 'Episode 1 - A' }, { title: 'Episode 2 - B' }],
  })
  assert.deepEqual(buildEpisodes(item, [], []), [])
  assert.deepEqual(buildEpisodes(item, undefined, undefined), [])
})

test('a title with no date is left out, never listed as a guess', () => {
  const item = show({ streamingEpisodes: [{ title: 'Episode 9 - Undated' }] })
  const rows = buildEpisodes(item, weekly(1, 2))
  assert.equal(rows.some((r) => r[0] === 9), false)
})

test('fewer dated episodes than the minimum gives no list', () => {
  assert.equal(MIN_DATED_EPISODES, 2)
  assert.deepEqual(buildEpisodes(show(), [{ at: T0, episode: 1 }]), [])
})

test("a finished show never lists a number past its own episode count", () => {
  const rows = buildEpisodes(show({ status: 'FINISHED', episodes: 3 }), weekly(1, 5))
  assert.deepEqual(rows.map((r) => r[0]), [1, 2, 3])
  // Still airing: the planned count is not a ceiling.
  assert.equal(buildEpisodes(show({ episodes: 3 }), weekly(1, 5)).length, 5)
})

test('only anime get a list', () => {
  assert.deepEqual(buildEpisodes({ kind: 'comic', id: 1 }, weekly(1, 3)), [])
})

test('indexAiring keeps good rows, drops bad ones and refuses what is not an airing file', () => {
  const airing = indexAiring({
    window: { from: 0, to: 1 },
    schedule: [
      { at: T0, episode: 4, mediaId: 7 },
      { at: 'soon', episode: 5, mediaId: 7 },
      { at: T0, episode: 6 },
    ],
    history: { 21: [{ at: T0, episode: 1 }, { at: 0, episode: 2 }, { episode: 3 }], 22: [], 23: 'x' },
    incomplete: {},
  })
  assert.deepEqual([...airing.history.keys()], [21])
  assert.equal(airing.history.get(21).length, 1)
  assert.deepEqual([...airing.window.keys()], [7])
  assert.equal(airing.window.get(7).length, 1)
  assert.equal(indexAiring(null), null)
  assert.equal(indexAiring([]), null)
  assert.equal(indexAiring({ files: [] }), null)
})

test('attachEpisodes folds rows into matching anime and leaves every other record untouched', () => {
  const airing = indexAiring({ schedule: [], history: { 196187: weekly(1, 3) } })
  const other = show({ id: 99 })
  const input = [show(), other]
  const { anime, count } = attachEpisodes(input, airing)
  assert.equal(count, 1)
  assert.equal(anime[0].episodeList.length, 3)
  assert.equal(anime[1], other)
  assert.equal('episodeList' in input[0], false, 'the input record is not changed')
})

test('no airing file: every record comes back as it was', () => {
  const input = [show()]
  const { anime, count } = attachEpisodes(input, null)
  assert.equal(count, 0)
  assert.equal(anime, input)
})

test('dates print in UTC', () => {
  assert.equal(airDate(T0), '9 Jul 2026')
  assert.equal(isoDate(T0), '2026-07-09')
  assert.equal(airDate(0), '')
})
