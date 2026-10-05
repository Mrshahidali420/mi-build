// The guides section: body split, cards, hero, the "Featured in" index
// (src/lib/guides.mjs), and that the committed data files are in step with
// the Markdown guides (npm run guides:media).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  splitBody,
  collectIds,
  cardOf,
  heroOf,
  buildGuideIndex,
  featuredIn,
  groupByCategory,
  wordCount,
  methodNote,
  isoDay,
  longDay,
  CATEGORY_KEYS,
  FEATURED_MAX,
  byRank,
  picksOf,
  assignBanners,
  guideSitemapUrls,
} from '../src/lib/guides.mjs'
import { readGuideFiles, parseGuide } from '../scripts/guide-files.mjs'

const MEDIA = {
  c17: { id: 17, name: 'Naruto Uzumaki', image: 'https://img/c17.png', media: [20, 1735], path: '/character/naruto-uzumaki' },
  c99: { id: 99, name: 'No Page', image: 'https://img/c99.png', media: [1735], path: null },
  m20: { id: 20, title: 'Naruto', type: 'ANIME', cover: 'https://img/m20.jpg', banner: null, path: '/anime/naruto' },
  m1735: { id: 1735, title: 'Naruto: Shippuden', type: 'ANIME', cover: 'https://img/m1735.jpg', banner: 'https://img/b1735.jpg', path: '/anime/naruto-shippuden' },
  m30011: { id: 30011, title: 'Naruto', type: 'MANGA', cover: 'https://img/m30011.jpg', banner: null, path: '/manga/naruto' },
}

test('splitBody cuts at the entries marker', () => {
  const html = '<p>a</p><h2>Ranking</h2><!-- entries --><h2>After</h2><p>b</p>'
  assert.deepEqual(splitBody(html), { before: '<p>a</p><h2>Ranking</h2>', after: '<h2>After</h2><p>b</p>' })
})

test('splitBody without a marker cuts after two paragraphs', () => {
  const html = '<p>one</p>\n<p>two</p>\n<h2>x</h2><p>three</p>'
  assert.deepEqual(splitBody(html), { before: '<p>one</p>\n<p>two</p>', after: '\n<h2>x</h2><p>three</p>' })
})

test('splitBody puts the cards last when the body is short', () => {
  assert.deepEqual(splitBody('<p>only</p>'), { before: '<p>only</p>', after: '' })
  assert.deepEqual(splitBody(''), { before: '', after: '' })
})

test('collectIds gathers hero and entry ids once each, sorted', () => {
  const ids = collectIds([
    { hero: { media: 1735 }, entries: [{ character: 17 }, { character: 13, media: 20 }] },
    { hero: { character: 17 }, entries: [{ media: 20 }] },
  ])
  assert.deepEqual(ids, { characters: [13, 17], media: [20, 1735] })
})

test('cardOf: character art, series from the entry, links and alt text', () => {
  const card = cardOf({ rank: 2, character: 17, media: 1735, heading: 'Naruto Uzumaki', text: 't' }, MEDIA)
  assert.equal(card.image, 'https://img/c17.png')
  assert.equal(card.width, 230)
  assert.equal(card.seriesTitle, 'Naruto: Shippuden')
  assert.equal(card.seriesPath, '/anime/naruto-shippuden')
  assert.equal(card.characterPath, '/character/naruto-uzumaki')
  assert.equal(card.alt, 'Naruto Uzumaki from Naruto: Shippuden')
  assert.equal(card.verb, 'watch')
})

test('cardOf: series defaults to the character top title; manga reads', () => {
  assert.equal(cardOf({ character: 17, heading: 'N', text: 't' }, MEDIA).seriesTitle, 'Naruto')
  const manga = cardOf({ media: 30011, heading: 'Naruto manga', text: 't' }, MEDIA)
  assert.equal(manga.image, 'https://img/m30011.jpg')
  assert.equal(manga.verb, 'read')
  assert.equal(manga.characterPath, null)
})

test('cardOf survives a media file that has not been filled yet', () => {
  const card = cardOf({ rank: 1, character: 5, heading: 'Someone', text: 't' }, {})
  assert.equal(card.image, null)
  assert.equal(card.alt, 'Someone')
  assert.equal(card.seriesPath, null)
})

test('heroOf prefers the banner, then the cover, then a portrait', () => {
  assert.equal(heroOf({ hero: { media: 1735 } }, MEDIA).src, 'https://img/b1735.jpg')
  assert.equal(heroOf({ hero: { media: 1735 } }, MEDIA).wide, true)
  assert.equal(heroOf({ hero: { media: 20 } }, MEDIA).src, 'https://img/m20.jpg')
  assert.equal(heroOf({ hero: { character: 17 } }, MEDIA).src, 'https://img/c17.png')
  assert.equal(heroOf({ title: 'T', entries: [{ character: 17, heading: 'N', text: 't' }] }, MEDIA).src, 'https://img/c17.png')
  assert.equal(heroOf({ title: 'T' }, MEDIA), null)
})

test('buildGuideIndex maps characters and their series to guides', () => {
  const guides = [
    { slug: 'b-guide', title: 'B', description: 'd', category: 'power-scaling', updated: new Date('2026-10-04'), hero: { media: 1735 }, entries: [{ character: 17, media: 1735 }] },
    { slug: 'a-guide', title: 'A', description: 'd', category: 'cosplay', updated: '2026-10-01', entries: [{ character: 17 }] },
  ]
  const index = buildGuideIndex(guides, MEDIA)
  assert.deepEqual(index.guides.map((g) => g.slug), ['a-guide', 'b-guide'])
  assert.equal(index.guides[1].updated, '2026-10-04')
  assert.equal(index.guides[1].image, 'https://img/b1735.jpg')
  assert.deepEqual(index.featured.c17, ['a-guide', 'b-guide'])
  assert.deepEqual(index.featured.m20, ['a-guide', 'b-guide'])
  assert.deepEqual(index.featured.m1735, ['b-guide'])
})

test('featuredIn returns links for a character or a title, capped', () => {
  const index = {
    guides: Array.from({ length: 6 }, (_, i) => ({ slug: `g${i}`, title: `Guide ${i}` })),
    featured: { c17: ['g0', 'g1', 'g2', 'g3', 'g4', 'g5'], m20: ['g2', 'missing'] },
  }
  assert.equal(featuredIn(index, { character: 17 }).length, FEATURED_MAX)
  assert.deepEqual(featuredIn(index, { media: 20 }), [{ slug: 'g2', title: 'Guide 2', path: '/guides/g2', image: null, imageAlt: '' }])
  assert.deepEqual(featuredIn(index, { media: 1 }), [])
  assert.deepEqual(featuredIn(index, {}), [])
  assert.deepEqual(featuredIn(null, { media: 20 }), [])
})

test('groupByCategory keeps category order, newest first, drops empty groups', () => {
  const groups = groupByCategory([
    { slug: 'c', title: 'C', category: 'cosplay', updated: '2026-10-01' },
    { slug: 'p1', title: 'P1', category: 'power-scaling', updated: '2026-09-01' },
    { slug: 'p2', title: 'P2', category: 'power-scaling', updated: '2026-10-02' },
    { slug: 'd', title: 'D', category: 'data', updated: '2026-10-03' },
  ])
  assert.deepEqual(groups.map((g) => g.key), ['power-scaling', 'cosplay', 'data'])
  assert.deepEqual(groups[0].guides.map((g) => g.slug), ['p2', 'p1'])
})

test('wordCount, methodNote and dates', () => {
  assert.equal(wordCount('Two words <!-- entries -->', [{ heading: 'A', text: 'b c' }]), 5)
  assert.equal(methodNote('power-scaling').heading, 'How we rank')
  assert.equal(methodNote('cosplay').heading, 'How this guide is made')
  assert.equal(isoDay(new Date('2026-10-04T00:00:00Z')), '2026-10-04')
  assert.equal(longDay('2026-10-04'), '4 October 2026')
  assert.equal(isoDay('not a date'), '')
})

test('parseGuide reads frontmatter and body', () => {
  const { data, body } = parseGuide('---\ntitle: X\nentries:\n  - character: 1\n---\nHello')
  assert.equal(data.title, 'X')
  assert.equal(data.entries[0].character, 1)
  assert.equal(body, 'Hello')
  assert.throws(() => parseGuide('no frontmatter'))
})

// --- the committed files against the guides on disk ------------------------

const readData = (name) => JSON.parse(readFileSync(join(process.cwd(), 'data', name), 'utf8'))
const guides = readGuideFiles()
const media = readData('guide-media.json')

test('byRank and picksOf: rank order, unranked last, keys once, capped', () => {
  const entries = [{ rank: 2, character: 99 }, { character: 5 }, { rank: 1, character: 17 }, { rank: 3, media: 20 }, { rank: 4, character: 17 }]
  assert.deepEqual(byRank(entries).map((e) => e.character ?? e.media), [17, 99, 20, 17, 5])
  assert.deepEqual(picksOf({ entries }), ['c17', 'c99', 'm20', 'c5'])
  assert.deepEqual(picksOf({ entries }, 2), ['c17', 'c99'])
})

// id -> { banner, cover, type, popularity }, for assignBanners.
const BANNERS = {
  20: { banner: 'https://img/b20.jpg', cover: 'https://img/cv20.jpg', type: 'ANIME', popularity: 100 },
  1735: { banner: 'https://img/b1735.jpg', cover: 'https://img/cv1735.jpg', type: 'ANIME', popularity: 200 },
  30011: { banner: 'https://img/b30011.jpg', cover: 'https://img/cv30011.jpg', type: 'MANGA', popularity: 300 },
  813: { banner: 'https://img/b813.jpg', cover: 'https://img/cv813.jpg', type: 'ANIME', popularity: 50 },
  999: { banner: null, cover: 'https://img/cv999.jpg', type: 'ANIME', popularity: 10 },
}

test('assignBanners: a guide prefers its own hero banner first', () => {
  const guides = [{ slug: 'a', heroMedia: 1735, franchiseMedia: [20], entryMedia: [], importance: 0 }]
  assert.deepEqual(assignBanners(guides, BANNERS), [{ slug: 'a', banner: 'https://img/b1735.jpg', isFallbackCover: false }])
})

test('assignBanners: franchise banners rank anime before manga, then by popularity', () => {
  const guides = [{ slug: 'a', heroMedia: null, franchiseMedia: [30011, 20, 813], entryMedia: [], importance: 0 }]
  // 20 and 813 are both anime: 20 is more popular, so it is picked over 813
  // and over the manga candidate 30011, even though 30011 is listed first.
  assert.deepEqual(assignBanners(guides, BANNERS)[0].banner, 'https://img/b20.jpg')
})

test('assignBanners: entry media is the last resort before falling back', () => {
  const guides = [{ slug: 'a', heroMedia: 999, franchiseMedia: [], entryMedia: [813], importance: 0 }]
  assert.deepEqual(assignBanners(guides, BANNERS)[0], { slug: 'a', banner: 'https://img/b813.jpg', isFallbackCover: false })
})

test('assignBanners: unique across guides, importance decides who picks first', () => {
  const same = (slug, importance) => ({ slug, heroMedia: null, franchiseMedia: [20, 813], entryMedia: [], importance })
  // b is listed first but a is more important (lower number), so a claims
  // the better (more popular) candidate first.
  const out = assignBanners([same('b', 5), same('a', 1)], BANNERS)
  // Output keeps the input order.
  assert.deepEqual(out.map((g) => g.slug), ['b', 'a'])
  const bySlug = Object.fromEntries(out.map((g) => [g.slug, g.banner]))
  assert.equal(bySlug.a, 'https://img/b20.jpg')
  assert.equal(bySlug.b, 'https://img/b813.jpg')
  assert.notEqual(bySlug.a, bySlug.b)
})

test('assignBanners: no free candidate anywhere falls back to the hero cover, flagged', () => {
  const guides = [
    { slug: 'a', heroMedia: 20, franchiseMedia: [], entryMedia: [], importance: 0 },
    // b wants the same single banner as a and has nothing else to offer.
    { slug: 'b', heroMedia: 20, franchiseMedia: [], entryMedia: [], importance: 1 },
  ]
  const out = assignBanners(guides, BANNERS)
  assert.deepEqual(out[0], { slug: 'a', banner: 'https://img/b20.jpg', isFallbackCover: false })
  assert.deepEqual(out[1], { slug: 'b', banner: 'https://img/cv20.jpg', isFallbackCover: true })
})

test('assignBanners: a hero with no banner anywhere and no cover returns null', () => {
  const guides = [{ slug: 'a', heroMedia: null, franchiseMedia: [], entryMedia: [], importance: 0 }]
  assert.deepEqual(assignBanners(guides, BANNERS), [{ slug: 'a', banner: null, isFallbackCover: true }])
})

test('guideSitemapUrls: hub, written guides with their day, data guides with the build day', () => {
  const urls = guideSitemapUrls('https://s', [{ slug: 'a', updated: '2026-10-01' }, { slug: 'b', updated: new Date('2026-09-30') }], [{ slug: 'd', updated: '2026-01-01' }], '2026-10-05')
  assert.deepEqual(urls, [
    { loc: 'https://s/guides', lastmod: '2026-10-05', priority: '0.8' },
    { loc: 'https://s/guides/a', lastmod: '2026-10-01', priority: '0.7' },
    { loc: 'https://s/guides/b', lastmod: '2026-09-30', priority: '0.7' },
    { loc: 'https://s/guides/d', lastmod: '2026-10-05', priority: '0.7' },
  ])
})

test('the sitemap lists the guides in their own part, not in core', () => {
  const code = readFileSync(join(process.cwd(), 'src/lib/sitemap-urls.js'), 'utf8')
  assert.ok(code.includes("split('guides', guideSitemapUrls("))
  const core = code.slice(code.indexOf('function coreUrls'), code.indexOf('const comicUrls'))
  assert.ok(!core.includes('/guides'))
})

test('data/guide-index.json is in step with the guides (run npm run guides:media)', () => {
  // image/wide/banner/isFallbackCover come from assignBanners, a separate
  // AniList-backed pass (scripts/guide-media.mjs); everything else here must
  // still match buildGuideIndex exactly.
  const built = JSON.parse(JSON.stringify(buildGuideIndex(guides, media)))
  const onDisk = readData('guide-index.json')
  assert.deepEqual(onDisk.featured, built.featured)
  const strip = ({ image, wide, isFallbackCover, banner, ...rest }) => rest
  assert.deepEqual(onDisk.guides.map(strip), built.guides.map(strip))
})

test('every written guide has its own banner on disk, and no two share one', () => {
  // assignBanners writes its result into each row's image/wide/isFallbackCover
  // (scripts/guide-media.mjs), so `image` is the assigned banner here.
  const onDisk = readData('guide-index.json')
  const seen = new Map()
  for (const g of onDisk.guides) {
    assert.ok(g.image, `${g.slug}: missing a banner (run npm run guides:media)`)
    const earlier = seen.get(g.image)
    assert.ok(!earlier, `${g.slug} and ${earlier}: duplicate banner ${g.image}`)
    seen.set(g.image, g.slug)
  }
})

test('every data guide has its own banner too, unique against the written guides', () => {
  const onDisk = readData('guide-index.json')
  const dataBanners = readData('guide-data-banners.json')
  const seen = new Map(onDisk.guides.map((g) => [g.image, g.slug]))
  for (const [slug, row] of Object.entries(dataBanners)) {
    assert.ok(row?.banner, `${slug}: missing a banner (run npm run guides:media)`)
    const earlier = seen.get(row.banner)
    assert.ok(!earlier, `${slug} and ${earlier}: duplicate banner ${row.banner}`)
    seen.set(row.banner, slug)
  }
})

test('every id a guide names has its media record', () => {
  const { characters, media: titles } = collectIds(guides)
  for (const id of characters) assert.ok(media[`c${id}`], `character ${id} missing: run npm run guides:media`)
  for (const id of titles) assert.ok(media[`m${id}`], `media ${id} missing: run npm run guides:media`)
})

test('every guide has sound frontmatter', () => {
  const slugs = new Set(guides.map((g) => g.slug))
  for (const g of guides) {
    assert.ok(CATEGORY_KEYS.includes(g.category), `${g.slug}: unknown category ${g.category}`)
    assert.ok(g.description.length >= 140 && g.description.length <= 170, `${g.slug}: description is ${g.description.length} characters`)
    for (const r of g.related || []) assert.ok(slugs.has(r), `${g.slug}: related guide ${r} does not exist`)
    for (const e of g.entries || []) {
      assert.ok(e.character || e.media, `${g.slug}: entry "${e.heading}" has no id`)
      // An unquoted comma inside { label, value } splits the value in two.
      for (const s of e.stats || []) {
        const open = (s.value.match(/\(/g) || []).length
        const shut = (s.value.match(/\)/g) || []).length
        assert.equal(open, shut, `${g.slug}: stat "${s.label}" looks cut short; quote values that hold a comma`)
      }
    }
    const ranks = (g.entries || []).map((e) => e.rank).filter(Boolean)
    assert.equal(new Set(ranks).size, ranks.length, `${g.slug}: duplicate ranks`)
  }
})
