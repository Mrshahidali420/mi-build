// The counting behind the data guides (src/lib/data-guides.mjs): free
// options, this season's streams, platform tallies, English editions and the
// "best of a genre" ranking.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  platformsOf,
  platformLabel,
  englishFirst,
  freeRows,
  countPlatforms,
  seasonRows,
  platformTally,
  englishSplit,
  bestInGenre,
  thumbOf,
  factLine,
  notAdult,
  spreadPicks,
  percent,
  listWords,
} from '../src/lib/data-guides.mjs'

const comic = (id, extra = {}) => ({
  kind: 'comic',
  id,
  slug: `t-${id}`,
  title: `Title ${id}`,
  country: 'KR',
  popularity: 100,
  genres: [],
  readLinks: [],
  ...extra,
})
const link = (site, language = 'English') => ({ site, url: `https://example.com/${site}`, language })

test('platformsOf merges editions of one platform and keeps record order', () => {
  const item = comic(1, { readLinks: [link('WEBTOON'), link('KakaoPage', 'Korean'), link('WEBTOON', 'French')] })
  assert.deepEqual(platformsOf(item), [
    { site: 'WEBTOON', languages: ['English', 'French'] },
    { site: 'KakaoPage', languages: ['Korean'] },
  ])
  assert.deepEqual(platformsOf({}), [])
})

test('platformLabel names the language only when there is no English edition', () => {
  assert.equal(platformLabel({ site: 'WEBTOON', languages: ['English', 'Thai'] }), 'WEBTOON')
  assert.equal(platformLabel({ site: 'KakaoPage', languages: ['Korean'] }), 'KakaoPage (Korean)')
  assert.equal(platformLabel({ site: 'Somewhere', languages: [] }), 'Somewhere')
})

test('englishFirst moves English platforms to the front, order otherwise kept', () => {
  const rows = [
    { site: 'A', languages: ['Korean'] },
    { site: 'B', languages: ['English'] },
    { site: 'C', languages: ['Thai'] },
  ]
  assert.deepEqual(englishFirst(rows).map((r) => r.site), ['B', 'A', 'C'])
})

test('freeRows uses the /free page rule and sorts by popularity', () => {
  const items = [
    comic(1, { popularity: 10, readLinks: [link('WEBTOON')] }), // free
    comic(2, { popularity: 50, readLinks: [link('Manta')] }), // trial only: not free
    comic(3, { popularity: 30, readLinks: [link('KakaoPage', 'Korean'), link('Tapas')] }), // free
    comic(4, { popularity: 90, readLinks: [link('Unknown Site')] }), // no facts: not free
  ]
  const rows = freeRows(items)
  assert.deepEqual(rows.map((r) => r.item.id), [3, 1])
  assert.deepEqual(rows[0].free.map((p) => p.site), ['Tapas', 'KakaoPage'])
  assert.equal(rows[0].english, true)
  assert.equal(freeRows(items, { limit: 1 }).length, 1)
  assert.deepEqual(freeRows(items, { keep: (i) => i.id !== 3 }).map((r) => r.item.id), [1])
})

test('countPlatforms counts rows per platform, biggest first', () => {
  const rows = [{ free: [{ site: 'B' }, { site: 'A' }] }, { free: [{ site: 'A' }] }]
  assert.deepEqual(countPlatforms(rows), [
    { site: 'A', count: 2 },
    { site: 'B', count: 1 },
  ])
  assert.deepEqual(countPlatforms([{ x: [{ site: 'Z' }] }], (r) => r.x), [{ site: 'Z', count: 1 }])
})

test('seasonRows takes the build date season and splits streamed from unstreamed', () => {
  const anime = [
    { kind: 'anime', id: 1, seasonYear: 2026, season: 'FALL', popularity: 5, watchLinks: [link('Crunchyroll', null)] },
    { kind: 'anime', id: 2, seasonYear: 2026, season: 'FALL', popularity: 9, watchLinks: [link('Netflix', null)] },
    { kind: 'anime', id: 3, seasonYear: 2026, season: 'FALL', popularity: 7, watchLinks: [] },
    { kind: 'anime', id: 4, seasonYear: 2026, season: 'SUMMER', popularity: 99, watchLinks: [link('HIDIVE', null)] },
  ]
  const out = seasonRows(anime, { now: new Date(Date.UTC(2026, 9, 4)) })
  assert.equal(out.year, 2026)
  assert.equal(out.season, 'FALL')
  assert.deepEqual(out.rows.map((r) => r.item.id), [2, 1])
  assert.equal(out.unstreamed, 1)
  assert.equal(seasonRows(anime, { now: new Date(Date.UTC(2026, 7, 1)) }).rows[0].item.id, 4)
})

test('platformTally counts each title once per platform, by section', () => {
  const items = [
    comic(1, { popularity: 5, readLinks: [link('WEBTOON'), link('WEBTOON', 'Thai')] }),
    comic(2, { country: 'JP', popularity: 9, readLinks: [link('WEBTOON', 'Japanese'), link('MANGA Plus')] }),
    comic(3, { country: 'CN', popularity: 1, readLinks: [link('Bilibili Comics', 'Chinese')] }),
    { kind: 'novel', id: 4, country: 'JP', popularity: 50, readLinks: [link('WEBTOON')] },
  ]
  const tally = platformTally(items, { topSize: 1 })
  const webtoon = tally.find((p) => p.site === 'WEBTOON')
  assert.equal(tally[0].site, 'WEBTOON')
  assert.equal(webtoon.total, 2)
  assert.equal(webtoon.manhwa, 1)
  assert.equal(webtoon.manga, 1)
  assert.equal(webtoon.english, 1)
  assert.deepEqual(webtoon.top.map((i) => i.id), [2])
  assert.equal(tally.find((p) => p.site === 'Bilibili Comics').manhua, 1)
})

test('englishSplit counts English, other-language-only and unlinked titles', () => {
  const items = [
    comic(1, { popularity: 1, readLinks: [link('Tapas')] }),
    comic(2, { popularity: 8, readLinks: [link('KakaoPage', 'Korean'), link('Tappytoon')] }),
    comic(3, { readLinks: [link('Naver Webtoon', 'Korean')] }),
    comic(4),
  ]
  const out = englishSplit(items, { limit: 5 })
  assert.equal(out.total, 4)
  assert.equal(out.english, 2)
  assert.equal(out.otherOnly, 1)
  assert.equal(out.none, 1)
  assert.deepEqual(out.rows.map((r) => r.item.id), [2, 1])
  assert.deepEqual(out.rows[0].english.map((p) => p.site), ['Tappytoon'])
  // keep() trims the list, never the counts
  const kept = englishSplit(items, { keep: (i) => i.id !== 2 })
  assert.equal(kept.english, 2)
  assert.deepEqual(kept.rows.map((r) => r.item.id), [1])
})

test('bestInGenre ranks the popular pool by score, needing a link and a score', () => {
  const items = [
    comic(1, { genres: ['Action'], popularity: 100, score: 70, readLinks: [link('WEBTOON')] }),
    comic(2, { genres: ['Action'], popularity: 90, score: 88, readLinks: [link('Tapas')] }),
    comic(3, { genres: ['Action'], popularity: 5, score: 99, readLinks: [link('Tapas')] }), // outside the pool
    comic(4, { genres: ['Action'], popularity: 80, score: 95, readLinks: [] }), // no official link
    comic(5, { genres: ['Romance'], popularity: 99, score: 99, readLinks: [link('Lezhin')] }), // other genre
    comic(6, { genres: ['Action'], popularity: 70, score: null, readLinks: [link('Tapas')] }), // no score
    comic(7, { genres: ['Action'], popularity: 95, score: 88, readLinks: [link('Tapas')] }), // tie: popularity
  ]
  const out = bestInGenre(items, 'Action', { pool: 3 })
  assert.deepEqual(out.map((r) => r.item.id), [7, 2, 1])
  assert.deepEqual(out[0].platforms, [{ site: 'Tapas', languages: ['English'] }])
  assert.equal(bestInGenre(items, 'Action', { pool: 3, limit: 1 }).length, 1)
})

test('notAdult drops what the homepage rules drop', () => {
  const keep = notAdult({ adultGenres: ['Hentai'], tagBlock: [], titleWordBlock: [] })
  assert.equal(keep(comic(1, { genres: ['Hentai'] })), false)
  assert.equal(keep(comic(2, { genres: ['Romance'] })), true)
})

test('thumbOf swaps an AniList large cover for the medium copy', () => {
  assert.equal(
    thumbOf('https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx1-a.jpg'),
    'https://s4.anilist.co/file/anilistcdn/media/manga/cover/medium/bx1-a.jpg',
  )
  assert.equal(thumbOf('https://example.com/x.jpg'), 'https://example.com/x.jpg')
  assert.equal(thumbOf(null), null)
})

test('factLine joins what is known and leaves out the rest', () => {
  assert.equal(factLine({ score: 84, status: 'FINISHED', startYear: 2018 }), 'Rated 84% · Finished · 2018')
  assert.equal(factLine({ kind: 'anime', status: 'RELEASING', episodes: 12 }), 'Still releasing · 12 episodes')
  assert.equal(factLine({}), '')
})

test('spreadPicks takes one per group first, skips guides with no image', () => {
  const groups = [
    { guides: [{ slug: 'a1', image: 'x' }, { slug: 'a2', image: 'x' }, { slug: 'a3', image: 'x' }] },
    { guides: [{ slug: 'b1', image: null }, { slug: 'b2', image: 'x' }] },
    { guides: [{ slug: 'c1', image: 'x' }] },
  ]
  assert.deepEqual(spreadPicks(groups, 4).map((g) => g.slug), ['a1', 'b2', 'c1', 'a2'])
  assert.deepEqual(spreadPicks(groups, 10).map((g) => g.slug), ['a1', 'b2', 'c1', 'a2', 'a3'])
  assert.deepEqual(spreadPicks([], 3), [])
})

test('percent and listWords read naturally', () => {
  assert.equal(percent(1, 3), '33%')
  assert.equal(percent(5, 0), '0%')
  assert.equal(listWords(['A']), 'A')
  assert.equal(listWords(['A', 'B']), 'A and B')
  assert.equal(listWords(['A', 'B', 'C']), 'A, B and C')
  assert.equal(listWords([]), '')
})
