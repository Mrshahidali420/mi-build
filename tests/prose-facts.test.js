import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { facts, buildOverview, BLOCKED_TAGS } from '../src/lib/prose.mjs'
import { titleAnswer, aboutParagraphs } from '../src/lib/title-answer.mjs'
import { seeded, nearDupRate, topSentences, sentencesOf } from '../scripts/measure-core.mjs'

const noteOf = (site) =>
  ({ WEBTOON: 'Free, ad-supported', Tapas: 'Free with coins', Crunchyroll: 'Free tier', Netflix: 'Subscription' })[site] || ''

const manhwa = (extra = {}) => ({
  id: 1,
  title: 'Moon Garden',
  kind: 'comic',
  country: 'KR',
  format: 'MANGA',
  status: 'FINISHED',
  startYear: 2018,
  endYear: 2022,
  chapters: 140,
  genres: ['Fantasy', 'Romance'],
  authors: [{ name: 'Han Seol', role: 'Story & Art' }],
  readLinks: [],
  ...extra,
})

const anime = (extra = {}) => ({
  id: 2,
  title: 'Star Relay',
  kind: 'anime',
  country: 'JP',
  format: 'TV',
  status: 'FINISHED',
  startYear: 2021,
  episodes: 12,
  season: 'SPRING',
  seasonYear: 2021,
  genres: ['Action'],
  studios: ['Studio Kite'],
  watchLinks: [],
  ...extra,
})

const keys = (item, kind) => facts(item, kind, noteOf, null).map((f) => f.key)
const all = (item, kind) => {
  const o = buildOverview(item, kind, noteOf, null)
  return [o.glance, ...o.more].join(' ')
}

/* ------------------------------------------------- each fact needs its field */

test('a title with links says where; one with none says so instead', () => {
  const linked = manhwa({ readLinks: [{ site: 'WEBTOON', url: 'u', language: 'English' }] })
  assert.ok(keys(linked, 'manhwa').includes('where'))
  assert.ok(!keys(linked, 'manhwa').includes('none'))
  assert.match(all(linked, 'manhwa'), /WEBTOON/)
  const bare = manhwa()
  assert.ok(keys(bare, 'manhwa').includes('none'))
  assert.ok(!keys(bare, 'manhwa').includes('where'))
  assert.match(all(bare, 'manhwa'), /no publisher has released it in English/)
})

test('English is only claimed for a link that says English', () => {
  const korean = manhwa({ readLinks: [{ site: 'KakaoPage', url: 'u', language: 'Korean' }] })
  const text = all(korean, 'manhwa')
  assert.match(text, /no official English edition/)
  assert.match(text, /KakaoPage in Korean/)
  const unknown = manhwa({ readLinks: [{ site: 'Somewhere', url: 'u', language: null }] })
  assert.doesNotMatch(all(unknown, 'manhwa'), /in English/)
})

test('the reading-order sentence needs a chain', () => {
  assert.ok(!keys(manhwa(), 'manhwa').includes('chain'))
  const chained = manhwa({
    chain: [
      { slug: 'a', title: 'Moon Garden', self: true },
      { slug: 'b', title: 'Moon Garden: Second Bloom' },
    ],
  })
  assert.ok(keys(chained, 'manhwa').includes('chain'))
  assert.match(all(chained, 'manhwa'), /Moon Garden: Second Bloom comes next/)
})

test('an adaptation says where it streams only when sites are stored', () => {
  const show = { slug: 's', title: 'Moon Garden', format: 'TV', episodes: 12, status: 'FINISHED', startYear: 2023 }
  const plain = all(manhwa({ adapt: { shows: [show] } }), 'manhwa')
  assert.doesNotMatch(plain, /streams on/)
  assert.match(plain, /animated|made into/)
  const streamed = all(manhwa({ adapt: { shows: [{ ...show, sites: ['Crunchyroll', 'Netflix'] }] } }), 'manhwa')
  assert.match(streamed, /streams on Crunchyroll and Netflix/)
})

test('sub or dub only from voice credits', () => {
  assert.ok(!keys(anime(), 'anime').includes('dub'))
  const dubbed = anime({ characters: [{ name: 'Aki', role: 'MAIN', voice: 'Ren Mori', voiceEn: 'Sam Lee' }] })
  assert.match(all(dubbed, 'anime'), /English dub; Sam Lee plays Aki/)
  const subbed = anime({
    staff: [{ role: 'Director', name: 'Kei Ono' }],
    characters: [{ name: 'Aki', role: 'MAIN', voice: 'Ren Mori' }],
  })
  assert.match(all(subbed, 'anime'), /Only a Japanese cast is listed/)
})

test('staff, songs, cast, readers, chart and recs each need their own field', () => {
  const bare = anime()
  for (const key of ['makers', 'themes', 'cast', 'readers', 'chart', 'rec', 'mal']) {
    assert.ok(!keys(bare, 'anime').includes(key), `${key} without data`)
  }
  const full = anime({
    staff: [{ role: 'Director', name: 'Kei Ono' }, { role: 'Music', name: 'Yu Sato' }],
    themes: [{ type: 'OP', title: 'Run', artists: ['Band A'] }, { type: 'ED', title: 'Rest', artists: [] }],
    characters: [{ name: 'Aki', role: 'MAIN' }, { name: 'Bo', role: 'SUPPORTING' }],
    readers: { completed: 5000, current: 300 },
    ranks: [{ rank: 40, type: 'POPULAR', allTime: true }],
    recs: [{ title: 'Other Show', kind: 'anime' }],
    extra: { mal: { score: 8.1, scoredBy: 12000 } },
  })
  const text = all(full, 'anime')
  assert.match(text, /Kei Ono directed it, and Yu Sato wrote the music/)
  assert.match(text, /2 theme songs; the first opening is “Run” by Band A/)
  assert.match(text, /Aki leads a cast of 2 named characters/)
  assert.match(text, /5,000 AniList members have finished it/)
  assert.match(text, /#40 on AniList's all-time most popular chart/)
  assert.match(text, /Other Show/)
  assert.match(text, /MyAnimeList it scores 8.1/)
})

test('a rank is printed only when it is near the top', () => {
  const item = manhwa({ score: 82 })
  assert.match(all(item, 'manhwa'), /score it 82 out of 100/)
  const ranked = buildOverview(item, 'manhwa', noteOf, { top: 3, label: 'manhwa' })
  assert.match([ranked.glance, ...ranked.more].join(' '), /top 3% of the manhwa we list/)
})

/* -------------------------------------------------------------- house rules */

test('a blocked tag or genre never reaches the text', () => {
  const blocked = [...BLOCKED_TAGS]
  const item = manhwa({ genres: ['Ecchi', 'Romance', 'Hentai'], tags: ['Harem', 'Boys Love', 'Office', 'Gore'] })
  const text = all(item, 'manhwa').toLowerCase()
  for (const tag of blocked) assert.ok(!text.includes(tag.toLowerCase()), tag)
  assert.match(text, /romance/)
  assert.match(text, /office/)
})

test('the same record always gives the same text', () => {
  const item = manhwa({ readLinks: [{ site: 'Tapas', url: 'u', language: 'English' }], tags: ['Office'] })
  assert.deepEqual(buildOverview(item, 'manhwa', noteOf, null), buildOverview(structuredClone(item), 'manhwa', noteOf, null))
})

test('the title appears at most once per paragraph, and no stock lines survive', () => {
  const item = anime({
    watchLinks: [{ site: 'Crunchyroll', url: 'u' }, { site: 'Netflix', url: 'v' }],
    staff: [{ role: 'Director', name: 'Kei Ono' }],
    characters: [{ name: 'Aki', role: 'MAIN', voice: 'Ren Mori', voiceEn: 'Sam Lee' }],
    readers: { completed: 900, current: 80 },
  })
  const o = buildOverview(item, 'anime', noteOf, null)
  for (const p of [o.glance, ...o.more]) {
    assert.ok((p.match(/Star Relay/g) || []).length <= 1, p)
    assert.doesNotMatch(p, /@/)
    assert.doesNotMatch(p, /rebuilt every day|hosts no|online free|AI\b/i)
  }
})

test('the page answer uses the glance, and an older record falls back cleanly', () => {
  const item = manhwa({ readLinks: [{ site: 'WEBTOON', url: 'u', language: 'English' }] })
  const overview = buildOverview(item, 'manhwa', noteOf, null)
  assert.equal(titleAnswer({ ...item, overview }, 'manhwa'), overview.glance)
  const old = { ...item, overview: { lede: 'x', paragraphs: ['Old one.'] } }
  assert.match(titleAnswer(old, 'manhwa'), /^You can legally read Moon Garden/)
  assert.doesNotMatch(titleAnswer(old, 'manhwa'), /hosts no|Every link on this page/)
  assert.deepEqual(aboutParagraphs(old.overview), ['Old one.'])
})

/* ---------------------------------------------------------- skeleton check */

const SITES = [
  ['WEBTOON', 'English'], ['Tapas', 'English'], ['Tappytoon', 'English'], ['KakaoPage', 'Korean'],
  ['Naver Series', 'Korean'], ['Piccoma', 'Japanese'], ['Lezhin', 'English'], ['Bilibili Comics', 'Chinese'],
]
const GENRES = ['Action', 'Comedy', 'Drama', 'Fantasy', 'Romance', 'Slice of Life', 'Sports', 'Mystery', 'Horror', 'Sci-Fi']
const TAGS = ['Office', 'School', 'Revenge', 'Martial Arts', 'Time Skip', 'Cooking', 'Idol', 'Magic', 'Isekai', 'Politics']
const STATUSES = ['FINISHED', 'FINISHED', 'RELEASING', 'HIATUS', 'CANCELLED']

/** 500 varied comic records from a fixed seed. */
function fixtures(n = 500) {
  const r = seeded(11)
  const pickN = (list, k) => [...list].sort(() => r() - 0.5).slice(0, k)
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1))
  return Array.from({ length: n }, (_, i) => {
    const start = int(1995, 2024)
    const status = STATUSES[int(0, STATUSES.length - 1)]
    const links = r() < 0.4 ? pickN(SITES, int(1, 4)).map(([site, language]) => ({ site, url: 'u', language })) : []
    const chainLen = r() < 0.15 ? int(2, 4) : 0
    return {
      id: i + 10,
      title: `Title ${i}`,
      kind: 'comic',
      country: ['KR', 'JP', 'CN'][int(0, 2)],
      format: r() < 0.05 ? 'ONE_SHOT' : 'MANGA',
      status,
      startYear: start,
      endYear: status === 'FINISHED' ? start + int(0, 8) : null,
      chapters: r() < 0.8 ? int(1, 400) : null,
      volumes: r() < 0.5 ? int(1, 40) : null,
      genres: pickN(GENRES, int(1, 3)),
      tags: r() < 0.6 ? pickN(TAGS, int(1, 4)) : [],
      authors: [{ name: `Author ${i}`, role: r() < 0.7 ? 'Story & Art' : 'Story' }],
      readLinks: links,
      readers: r() < 0.7 ? { completed: int(0, 50000), current: int(0, 9000), planning: int(0, 20000), dropped: int(0, 3000) } : undefined,
      score: r() < 0.5 ? int(40, 90) : undefined,
      chain: chainLen
        ? Array.from({ length: chainLen }, (_, k) => ({ slug: `c${k}`, title: k === 0 ? `Title ${i}` : `Part ${k} of ${i}`, self: k === 0 }))
        : null,
      recs: r() < 0.4 ? [{ title: `Rec ${i}`, kind: 'comic' }] : [],
      favourites: int(0, 3000),
    }
  })
}

test('500 varied records do not share one skeleton', () => {
  const texts = fixtures().map((item) => {
    const o = buildOverview(item, 'manhwa', noteOf, null)
    return {
      linked: item.readLinks.length > 0,
      text: [o.glance, ...o.more].join(' '),
      names: [item.title, ...item.authors.map((a) => a.name)],
    }
  })
  // Pages with official links: the Step 1 target (<= 0.25).
  const linked = nearDupRate(texts.filter((t) => t.linked))
  assert.ok(linked <= 0.25, `near-dup rate with links ${linked}`)
  // Thin pages with no link carry few facts, so they still pair up more often
  // (Step 2 adds their own facts). Guard against sliding back to one skeleton.
  const overall = nearDupRate(texts)
  assert.ok(overall <= 0.4, `near-dup rate overall ${overall}`)
  const top = topSentences(texts.map((t) => t.text))[0]
  assert.ok(top.share <= 0.05, `"${top.sentence}" on ${top.share}`)
  assert.ok(texts.every((t) => sentencesOf(t.text).length >= 2))
})

test('real shard records, when present, stay well away from the old single skeleton', async () => {
  if (!existsSync(new URL('../public/d/t/0.txt', import.meta.url))) return
  const { loadSample, measureRecords } = await import('../scripts/measure-shards.mjs')
  const { report } = measureRecords(loadSample({ n: 600, files: 12, seed: 3 }), 'new')
  // The old writer scored 0.99 on this measure. Thin no-link records still
  // pair up often (see tasks/measure); this guards against sliding back.
  assert.ok(report.own.all.nearDupRate <= 0.65, `near-dup ${report.own.all.nearDupRate}`)
  assert.ok(report.own.titleWithLinks.nearDupRate <= 0.35, `links near-dup ${report.own.titleWithLinks.nearDupRate}`)
  assert.ok(report.own.all.topSentences[0].share <= 0.06, JSON.stringify(report.own.all.topSentences[0]))
})
