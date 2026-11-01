// Episode ratings on IMDb (scripts/social/ratings/*, types/rating*.mjs):
// reading IMDb's daily files, matching a show's episodes, the daily
// snapshot, and what the three rating types post.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { EPISODES_FILE, RATINGS_FILE, readEpisodes, readRatings } from '../scripts/social/ratings/imdb.mjs'
import { imdbEpisode, imdbMatchOf, keptMatch, lastAiredOf } from '../scripts/social/ratings/match.mjs'
import { FRESH_MS, airedAtOf, loadRatings, ratingRows, scoreOn, trackedTitles, updateSnapshot } from '../scripts/social/ratings/load.mjs'
import { memoryStore } from '../scripts/social/ledger.mjs'
import { TYPES } from '../scripts/social/types/index.mjs'
import { moveOf } from '../scripts/social/types/rating-move.mjs'
import { baseName, seasonOf, shortEpisode } from '../scripts/social/types/rating.mjs'
import { dateOf } from '../scripts/social/when.mjs'
import { NOW, DAY, HOUR, BLOCKED } from './social-kit.mjs'
import { sampleRatingData, walk } from './social-data.mjs'
import { captionFor } from '../scripts/social/plan.mjs'
import { checkText, MAX_POST, MAX_POST_TAGS } from '../scripts/social/text.mjs'
import { kitOf } from '../scripts/social/render/parts.mjs'
import { THEME } from '../scripts/social/theme.mjs'

const type = (key) => TYPES.find((t) => t.key === key)
const RATINGS_TSV = ['tconst\taverageRating\tnumVotes', 'tt501\t9.1\t2400', 'tt502\t8.0\t300', 'tt999\t7.0\t10'].join('\n')
const EPISODES_TSV = ['tconst\tparentTconst\tseasonNumber\tepisodeNumber', 'tt501\ttt5\t1\t7', 'tt502\ttt5\t1\t8', 'tt503\ttt5\t\\N\t\\N', 'tt900\ttt9\t1\t1'].join('\n')

test('imdb: only the rows asked for are kept, numbers parsed, the header and blanks skipped', async () => {
  const ratings = await readRatings(RATINGS_TSV.split('\n'), new Set(['tt501', 'tt502']))
  assert.deepEqual([...ratings], [['tt501', { score: 9.1, votes: 2400 }], ['tt502', { score: 8, votes: 300 }]])
  const episodes = await readEpisodes(EPISODES_TSV.split('\n'), new Set(['tt5']))
  assert.deepEqual(episodes.get('tt5'), [{ id: 'tt501', season: 1, episode: 7 }, { id: 'tt502', season: 1, episode: 8 }])
  assert.equal(episodes.has('tt9'), false)
})

test('match: the anchor episode sets the IMDb season and numbering; without it TMDB numbering is used', () => {
  const rows = [{ id: 'a', season: 1, episode: 30 }, { id: 'b', season: 1, episode: 31 }, { id: 'c', season: 2, episode: 6 }, { id: 'd', season: 2, episode: 7 }]
  // A long runner IMDb files in one season: AniList's episode 6 is IMDb's 30.
  assert.equal(imdbEpisode({ series: 'tt', season: 2, offset: 0, anchor: { ep: 7, id: 'b' } }, rows, 6), 'a')
  assert.equal(imdbEpisode({ series: 'tt', season: 2, offset: 0, anchor: { ep: 7, id: null } }, rows, 7), 'd')
  assert.equal(imdbEpisode({ series: 'tt', season: 2, offset: 0, anchor: { ep: 7, id: null } }, rows, 9), null)
  assert.equal(imdbEpisode({ miss: true }, rows, 6), null)
  assert.equal(lastAiredOf({ nextEpisode: { number: 8 } }), 7)
  assert.equal(lastAiredOf({ nextEpisode: null }), 0)
})

test('match: TMDB external ids give the series and the anchor; a kept miss is not looked up again', async () => {
  const asked = []
  const get = async (path) => {
    asked.push(path)
    return { '/tv/5/external_ids': { imdb_id: 'tt5' }, '/tv/5/season/1/episode/7/external_ids': { imdb_id: 'tt501' } }[path] || null
  }
  const title = { id: 100, title: 'Steel Harbor', status: 'RELEASING', nextEpisode: { number: 8, at: NOW + DAY } }
  const m = await imdbMatchOf(get, title, { tmdbCache: { 100: { id: 5, season: 1, at: NOW } }, tmdbFound: {}, now: NOW })
  assert.deepEqual(m, { tmdb: 5, series: 'tt5', season: 1, offset: 0, anchor: { ep: 7, id: 'tt501' }, at: NOW })
  assert.deepEqual(asked, ['/tv/5/external_ids', '/tv/5/season/1/episode/7/external_ids'])
  assert.equal(keptMatch({ 100: { miss: true, at: NOW - DAY } }, title, NOW), 'miss')
  assert.equal(keptMatch({ 100: { miss: true, at: NOW - 4 * DAY } }, title, NOW), undefined)
})

test('snapshot: one point a day, new episodes added, old ones dropped; base is the score on the day of our post', () => {
  const day1 = NOW - DAY
  const a = updateSnapshot(null, { now: day1, ratings: new Map([['tt1', { score: 9.0, votes: 900 }]]), add: [{ id: 'tt1', titleId: 1, ep: 3, aired: day1 - HOUR }, { id: 'old', titleId: 1, ep: 1, aired: NOW - 30 * DAY }] })
  assert.deepEqual(Object.keys(a.eps), ['tt1'])
  const b = updateSnapshot(a, { now: NOW, ratings: new Map([['tt1', { score: 9.3, votes: 1500 }]]) })
  assert.deepEqual(b.eps.tt1.hist.map(([, s]) => s), [9.0, 9.3])
  const again = updateSnapshot(b, { now: NOW + HOUR, ratings: new Map([['tt1', { score: 9.4, votes: 1600 }]]) })
  assert.equal(again.eps.tt1.hist.length, dateOf(NOW + HOUR) === dateOf(NOW) ? 2 : 3)
  assert.equal(scoreOn(b.eps.tt1.hist, dateOf(day1)), 9.0)
  const rows = ratingRows(b, [{ type: 'rating', item: 'tt1', status: 'posted', at: day1 }])
  assert.deepEqual(rows, [{ id: 'tt1', titleId: 1, ep: 3, aired: day1 - HOUR, score: 9.3, votes: 1500, base: 9.0 }])
})

test('load: reads the files once a day, keeps the snapshot and the matches in the ledger', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'imdb-'))
  writeFileSync(join(dir, RATINGS_FILE), gzipSync(RATINGS_TSV))
  writeFileSync(join(dir, EPISODES_FILE), gzipSync(EPISODES_TSV))
  const book = memoryStore({ v: 1, entries: [], tmdbIds: { 100: { id: 5, season: 1, at: NOW } } })
  const get = async (path) => ({ '/tv/5/external_ids': { imdb_id: 'tt5' }, '/tv/5/season/1/episode/7/external_ids': { imdb_id: 'tt501' } })[path] || null
  const title = { id: 100, title: 'Steel Harbor', section: 'anime', status: 'RELEASING', popularity: 9000, nextEpisode: { number: 8, at: NOW + DAY } }
  const data = { titles: [title, { ...title, id: 7, popularity: 100 }], schedule: [] }
  const lines = []
  const first = await loadRatings({ book, now: NOW, data, get, dir, say: (l) => lines.push(l) })
  assert.deepEqual(first.rows.map((r) => [r.id, r.ep, r.score, r.votes]), [['tt501', 7, 9.1, 2400]])
  const kept = (await book.read()).data
  assert.equal(kept.imdbIds[100].series, 'tt5')
  assert.equal(kept.ratings.at, NOW)
  assert.match(lines.join(' '), /1 airing shows, 1 on IMDb/)
  // Later the same day: the snapshot alone, nothing read.
  const later = await loadRatings({ book, now: NOW + FRESH_MS / 2, data, get: async () => assert.fail('no lookups'), dir: '/nowhere' })
  assert.equal(later.rows.length, 1)
  assert.equal(trackedTitles(data.titles).length, 1)
  // A comic is never followed: only the anime made from one.
  assert.equal(trackedTitles([{ ...title, section: 'manhwa' }]).length, 0)
  assert.equal(airedAtOf(title, 6, []), NOW + DAY - 2 * 7 * DAY)
})

test('rating: high scores with enough votes, best first, once per episode', () => {
  const posts = type('rating').find(sampleRatingData(), { now: NOW })
  assert.deepEqual(posts.map((p) => [p.item, p.score]), [['tt0200006', '9.4'], ['tt0200007', '9.1'], ['tt0201012', '8.7']])
  assert.equal(posts[0].episode, 6)
  // The anime made from a manhwa the index has leads to that manhwa; one without leads to its own page.
  assert.equal(posts[0].noun, 'manhwa')
  assert.equal(posts[0].path, '/manhwa/solo-leveling-1')
  assert.equal(posts[0].view.cta, 'Read the manhwa: link in the first comment')
  assert.equal(posts[2].noun, null)
  assert.equal(posts[2].view.cta, 'Where to watch: link in the first comment')
})

test('rating move: up and down by 0.2 or more since our post; small moves are not news', () => {
  const posts = type('rating-move').find(sampleRatingData(), { now: NOW })
  assert.deepEqual(posts.map((p) => [p.item, p.before, p.score]), [['tt0203004:down', '8.6', '8.2'], ['tt0200006:up', '9.1', '9.4']])
  assert.equal(moveOf({ base: 9.0, score: 9.14, votes: 5000 }), null)
  assert.equal(moveOf({ base: 9.0, score: 9.2, votes: 5000 }), 'up')
  assert.equal(moveOf({ base: 9.0, score: 9.4, votes: 50 }), null)
})

test('rating week: the best episode of each show from the last seven days, top four, at least three', () => {
  const [post] = type('rating-week').find(sampleRatingData(), { now: NOW })
  assert.equal(post.item, 'week')
  assert.equal(post.title, null)
  assert.deepEqual(post.view.items.map((i) => i.score), ['9.4', '8.7', '8.2'])
  const thin = { ...sampleRatingData(), ratings: { rows: sampleRatingData().ratings.rows.slice(0, 2) } }
  assert.deepEqual(type('rating-week').find(thin, { now: NOW }), [])
})

test('rating card words: the season a title names, and the short episode mark', () => {
  assert.deepEqual([seasonOf('Aoashi Season 2'), seasonOf('Black Clover 2nd Season'), seasonOf('Overgeared')], [2, 2, null])
  assert.deepEqual([shortEpisode('Aoashi Season 2', 5), shortEpisode('Overgeared', 6)], ['S2.EP5', 'EP6'])
  assert.equal(baseName('Aoashi Season 2'), 'Aoashi')
})

test('rating posts: every wording passes the gate, never names a country, and every card carries its link line', () => {
  const data = sampleRatingData()
  const kit = kitOf(THEME, {})
  const fake = { src: 'data:image/jpeg;base64,AA==', ratio: 0.71 }
  for (const key of ['rating', 'rating-move', 'rating-week']) {
    const posts = type(key).find(data, { now: NOW })
    assert.ok(posts.length, key)
    for (const post of posts) {
      for (let turn = 0; turn < type(key).captions.length; turn += 1) {
        const made = captionFor({ ...type(key), captions: [type(key).captions[turn]] }, post, 0, BLOCKED)
        assert.ok(made, `${key} wording ${turn + 1}`)
        assert.equal(checkText(made.caption, { blockedTags: BLOCKED, max: MAX_POST, emoji: 4, maxTags: MAX_POST_TAGS }), null)
        assert.doesNotMatch(made.caption, /japan/i)
      }
      const art = key === 'rating-week' ? { frames: post.art.frames.map(() => fake) } : { hero: fake }
      const { texts } = walk(type(key).template({ ...post.view, art }, kit))
      assert.ok(texts.some((text) => /link in the first comment/.test(text)), `${key}: ${texts.join('|')}`)
    }
  }
})
