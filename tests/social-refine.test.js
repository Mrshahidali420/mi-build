// The refinement round of 12 Oct 2026: what a post may end on, how a title
// wraps, which covers are placeholders, what the Amazon line says, and the
// rule that keeps one kind of post from running three times in a row.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { baseTitle, synopsisOf, taglineOf, tagsFor, TAGLINE_MAX } from '../scripts/social/story.mjs'
import { planNext, MAX_STREAK } from '../scripts/social/plan.mjs'
import { shopLabel } from '../scripts/social/shop.mjs'
import { isBlankCover } from '../scripts/social/render/engine.mjs'
import { linesOf, noOrphan, wrapUnits, INNER } from '../scripts/social/render/parts.mjs'
import { ctaOf, START_WITH_ONE } from '../scripts/social/types/shared.mjs'
import { animeYears, buildData } from '../scripts/social/source.mjs'
import { TYPES } from '../scripts/social/types/index.mjs'
import { factsOf } from '../scripts/social/types/fact.mjs'
import { isSeries } from '../scripts/social/types/new-title.mjs'
import { NOW, record } from './social-kit.mjs'
import { classic, running, sampleItems } from './social-data.mjs'

const NBSP = String.fromCharCode(160)

test('synopsis: it never ends on a teaser question, a lead-in colon, a scrap or an ellipsis', () => {
  const first = 'A boy finds a sword in the old forest near the village he grew up in.'
  assert.equal(synopsisOf(`${first} Will he survive?`), first)
  assert.equal(synopsisOf(`${first} The proof:`), first)
  assert.equal(synopsisOf(`${first} He comes back as a goblin?!`), first)
  assert.equal(synopsisOf(`${first} And then...`), first)
  assert.equal(synopsisOf(`${first} Not really.`), first) // two words say nothing
  assert.equal(synopsisOf('Will he survive the old forest near the village he grew up in, and at what cost?'), null)
})

test('tagline: the first sentence when it is whole and short, and nothing otherwise', () => {
  assert.equal(taglineOf('A deaf girl is bullied by the popular boy in her class. Years later he looks for her.'), 'A deaf girl is bullied by the popular boy in her class.')
  assert.equal(taglineOf('A boy fights... for "the right death." He is not alone.'), null) // dots inside read as a cut-off
  assert.equal(taglineOf('What would you do for one more day? He finds out.'), null)
  assert.equal(taglineOf(`${'A very long opening sentence that goes on. '.replace('.', '').repeat(4)}.`), null)
  assert.ok(TAGLINE_MAX <= 120)
  assert.equal(taglineOf(''), null)
})

test('hashtag: a season or part suffix and a subtitle are left out of the title tag', () => {
  assert.deepEqual(['Chitose Is in the Ramune Bottle 2nd Cour', 'Dandadan 3rd Season', 'Black Clover Season 2', 'Pokémon Horizons: The Series', 'Attack on Titan Final Season Part 2'].map(baseTitle), ['Chitose Is in the Ramune Bottle', 'Dandadan', 'Black Clover', 'Pokémon Horizons', 'Attack on Titan'])
  // One word before the colon is not a name on its own; a title with no suffix is untouched.
  assert.deepEqual(['Frieren: Beyond Journey’s End', 'Solo Leveling', 'Re:Zero'].map(baseTitle), ['Frieren: Beyond Journey’s End', 'Solo Leveling', 'Re:Zero'])
  assert.equal(tagsFor({ title: 'Chitose Is in the Ramune Bottle 2nd Cour', genres: [] })[0], '#ChitoseIsInTheRamuneBottle')
})

test('wrapping: a line never ends on a separator, and a short last word is not left alone', () => {
  const lines = wrapUnits('Drama · Psychological · Mystery', 20)
  assert.deepEqual(lines, ['Drama', 'Psychological'])
  assert.deepEqual(wrapUnits('Action · Fantasy · Drama', 18), ['Action · Fantasy', 'Drama'])
  assert.ok(lines.every((line) => !/·\s*$/.test(line)))
  assert.equal(noOrphan('Pokémon Horizons: The Series'), `Pokémon Horizons: The${NBSP}Series`)
  assert.equal(noOrphan("The Swordmaster's Son"), "The Swordmaster's Son") // tying these would strand "The"
  assert.equal(noOrphan('DARK MACHINE THE ANIMATION'), 'DARK MACHINE THE ANIMATION')
  assert.deepEqual([linesOf('PSYREN', 84, INNER), linesOf('Mahou Shoujo Ikusei Keikaku: restart', 56, INNER), linesOf('', 56, INNER)], [1, 2, 0])
})

const solid = (color) => sharp({ create: { width: 120, height: 170, channels: 3, background: color } })

test('covers: a logo on plain white or black is a placeholder; real art is not', async () => {
  const logo = await solid('#ffffff').composite([{ input: await sharp({ create: { width: 40, height: 20, channels: 3, background: '#cc2222' } }).png().toBuffer(), left: 40, top: 70 }]).png().toBuffer()
  assert.equal(await isBlankCover(logo, sharp), true)
  assert.equal(await isBlankCover(await solid('#000000').png().toBuffer(), sharp), true)
  const art = await solid('#3366aa').composite([{ input: await sharp({ create: { width: 60, height: 90, channels: 3, background: '#eeeeee' } }).png().toBuffer(), left: 30, top: 40 }]).png().toBuffer()
  assert.equal(await isBlankCover(art, sharp), false)
})

test('amazon line: the words fit the product and the post', () => {
  const book = { t: 'book', n: 'Vol. 1' }
  assert.equal(shopLabel(book, { kind: 'anime', source: 'MANGA' }, 'Manga'), 'Read the manga it is based on')
  assert.equal(shopLabel(book, { kind: 'anime', source: 'LIGHT_NOVEL' }, 'Light novel'), 'Read the light novel it is based on')
  // An original anime is not "based on" the manga made after it; a comic's own volume is just the volume.
  assert.equal(shopLabel(book, { kind: 'anime', source: 'ORIGINAL' }, 'Manga'), 'Get the manga on Amazon')
  assert.equal(shopLabel(book, { kind: 'manga' }, 'Manhwa'), 'Get the manhwa on Amazon')
  assert.equal(shopLabel(book, { kind: 'manga' }, null), 'Get the English edition on Amazon')
  assert.equal(shopLabel({ t: 'disc', n: 'The Complete Series Blu-ray' }, { kind: 'anime' }, null), 'Get the Blu-ray on Amazon')
  assert.equal(shopLabel({ t: 'figure', n: 'Nendoroid' }, { kind: 'anime' }, null), 'Get the figure on Amazon')
  for (const pick of [{ t: 'figure' }, { t: 'disc', n: 'DVD' }, { t: 'poster' }]) assert.doesNotMatch(shopLabel(pick, { kind: 'anime', source: 'MANGA' }, null), /book|read/i)
})

test('comment line: a list post whose comment opens one title says so', () => {
  assert.equal(START_WITH_ONE, 'Start with #1: link in the first comment')
  for (const turn of [0, 1, 2]) {
    assert.match(ctaOf('first', turn), /#1|number one/i)
    assert.doesNotMatch(ctaOf('first', turn), /each one|whole list|full list/i)
    assert.match(ctaOf('list', turn), /first comment/)
  }
})

// --- the mix of kinds --------------------------------------------------------

const wording = [(p) => ({ hook: `🔥 ${p.item} is here.`, facts: ['One fact.'], cta: '👇 Link in the first comment.' })]
const kind = (key, items, over = {}) => ({ key, urgent: false, gapDays: 0, titleGap: false, window: 1, find: () => items.map((item) => ({ item, title: null, path: '/x' })), captions: wording, ...over })
const said = (...keys) => keys.map((type, i) => ({ type, item: `old-${i}`, at: 1000 + i, day: '2026-10-11', page: 'x' }))
const next = (kinds, history, slotsLeft = Infinity) => planNext({ kinds, data: {}, history, now: 10_000_000, rng: () => 0, slotsLeft })?.type.key

test('mix: the same kind never runs back to back while another kind has something to post', () => {
  const a = kind('a', ['a1', 'a2'])
  const b = kind('b', ['b1'])
  assert.equal(next([a, b], said('b', 'a')), 'b')
  assert.equal(next([a, b], said('a', 'b')), 'a')
  // Nothing else to post: the kind repeats rather than leave the Page silent.
  assert.equal(next([a, kind('b', [])], said('b', 'a')), 'a')
  assert.equal(next([a], said('a', 'a', 'a')), 'a')
})

test('mix: news may go first, but never a third time in a row while another kind is waiting', () => {
  const news = kind('news', ['n1', 'n2', 'n3'], { urgent: true })
  const fact = kind('fact', ['f1'])
  assert.equal(MAX_STREAK, 2)
  // News outranks the rotation, and may run twice when the day is short of slots.
  assert.equal(next([fact, news], said('fact')), 'news')
  assert.equal(next([fact, news], said('fact', 'news'), 2), 'news')
  assert.equal(next([fact, news], said('news', 'news'), 2), 'fact')
  // With nothing else to post, the news goes out all the same.
  assert.equal(next([kind('fact', []), news], said('news', 'news'), 2), 'news')
})

// --- this site's types --------------------------------------------------------

const typeOf = (key) => TYPES.find((t) => t.key === key)
const fresh = (over) => running(6, { popularity: 800, startYear: 2026, startDate: [2026, 9, 5], startPrecision: 'day', ...over })

test('new title: only a series still coming out; never a one-shot, a bonus or a special chapter', () => {
  const items = [
    fresh({ id: 60, slug: 'fresh-ink', title: 'Fresh Ink' }),
    fresh({ id: 61, slug: 'quit-laughing', title: 'Quit Laughing', format: 'ONE_SHOT', status: 'FINISHED', popularity: 3000 }),
    fresh({ id: 62, slug: 'bonus', title: 'The Promised Land: Special Bonus Chapter', popularity: 2000 }),
    fresh({ id: 63, slug: 'done', title: 'Done Already', status: 'FINISHED', popularity: 1500 }),
    fresh({ id: 64, slug: 'shot', title: 'Still A One Shot', format: 'ONE_SHOT', popularity: 1200 }),
  ]
  assert.deepEqual(typeOf('new-title').find(buildData(items, NOW), { now: NOW }).map((p) => p.title), ['Fresh Ink'])
  assert.deepEqual([{ status: 'RELEASING', format: 'MANGA', title: 'A' }, { status: 'RELEASING', format: 'ONE_SHOT', title: 'A' }, { status: 'RELEASING', format: 'MANGA', title: 'A: Side Story' }, { status: 'FINISHED', format: 'MANGA', title: 'A' }].map(isSeries), [true, false, false, false])
})

test('fact card: the strongest fact only, it names the title, and a weak one gives no card', () => {
  const anime = { ...record({ id: 500, slug: 'old-tale-anime', title: 'Old Tale', startYear: 2004 }), kind: 'anime', watchLinks: [{ site: 'Crunchyroll', url: 'https://crunchyroll.com/x', language: 'English' }] }
  const sequel = { ...anime, id: 501, slug: 'old-tale-2', title: 'Old Tale: Second Act', startYear: 1996 }
  const comic = record({ id: 70, slug: 'old-tale', title: 'Old Tale', country: 'JP', startYear: 1994, endYear: 2001, chapters: 162, score: 80, ranks: [], animeInIndex: [{ slug: 'old-tale-2' }, { slug: 'old-tale-anime' }] })
  const data = buildData([comic, anime, sequel], NOW)
  const tale = data.byId.get(70)
  // The anime of the same name counts, not a differently named one that happens to be older.
  assert.equal(tale.animeYear, 2004)
  assert.deepEqual(factsOf(tale).map((f) => [f.kind, f.figure]), [['wait', '10 years']])
  assert.match(factsOf(tale)[0].line, /Old Tale \(1994\) and its anime \(2004\)/)
  assert.equal(animeYears([comic])(tale), null) // no anime record: nothing is claimed
  // A long finished run beats a long wait only when it is the stronger of the two.
  const long = { ...tale, chapters: 1100, endYear: 2016, animeYear: null }
  assert.deepEqual(factsOf(long).map((f) => f.kind), ['run', 'years'])
  assert.deepEqual(factsOf({ ...tale, animeYear: 1999 }), [])
  const posts = typeOf('fact').find(buildData(sampleItems(), NOW), { now: NOW })
  assert.equal(new Set(posts.map((p) => p.title)).size, posts.length)
  assert.ok(posts.every((p) => p.view.line.includes(p.title) && !('title' in p.view)))
})

test('read next: each pick carries its score, and a blank cover gives way to the next pick', () => {
  const items = [classic({ recIds: [10, 11, 12, 13].map((id) => ({ id })) }), ...Array.from({ length: 5 }, (_, n) => running(n))]
  const [post] = typeOf('next').find(buildData(items, NOW), { now: NOW })
  assert.deepEqual(post.view.recs, [{ title: 'Gate Runner 0', rating: '7.0' }, { title: 'Gate Runner 1', rating: '7.1' }, { title: 'Gate Runner 2', rating: '7.2' }])
  const swapped = post.without([1])
  assert.deepEqual(swapped.names, ['Gate Runner 0', 'Gate Runner 2', 'Gate Runner 3'])
  assert.equal(swapped.art.thumbs.length, 3)
  assert.equal(swapped.without([0, 1]), null) // no fourth pick left: the engine keeps what it has
})

test('ranking: the closing line fits where the comment leads', () => {
  const ranks = typeOf('ranking').find(buildData(sampleItems(), NOW), { now: NOW })
  const ongoing = ranks.find((p) => p.item === 'rank:manhwa:ongoing')
  const genre = ranks.find((p) => p.item === 'rank:manhwa:action')
  assert.deepEqual([ongoing.leads, ongoing.view.cta, genre.leads], ['first', 'Start with #1: link in the first comment', 'list'])
  assert.match(typeOf('ranking').captions[0](ongoing).cta, /#1/)
  assert.match(typeOf('ranking').captions[0](genre).cta, /full list/)
  assert.match(genre.path, /^\/genre\//)
})

test('character and where: a line about the story when the record has a whole first sentence', () => {
  const told = classic({ description: 'A weak hunter wakes up with a power no one else has. Then it grows.' })
  const data = buildData([told, ...Array.from({ length: 5 }, (_, n) => running(n))], NOW)
  const [char] = typeOf('character').find(data, { now: NOW })
  assert.equal(char.view.tagline, 'A weak hunter wakes up with a power no one else has.')
  assert.deepEqual(char.art.thumbs, [data.byId.get(1).image])
  assert.ok(!char.view.lines.some(([label]) => label === 'Read it on') && char.view.sites.length > 0)
  const where = typeOf('where').find(data, { now: NOW })
  assert.equal(where.find((p) => p.title === 'Solo Leveling').view.tagline, 'A weak hunter wakes up with a power no one else has.')
  // No blurb: the line says what the page counts instead.
  assert.match(where.find((p) => p.title === 'Gate Runner 0').view.tagline, /^It is ongoing\./)
})
