// What a post says to send people to the site (tasks/lessons.md): the story
// fields (story.mjs), the full caption (text.mjs composePost), the first
// comment with its optional Amazon line (site.mjs, shop.mjs), the labelled
// lines and the picture stroke on the image (render/parts.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { altNameOf, hashOf, nativeOf, plainBlurb, ratingOf, seasonTag, subgenreOf, synopsisOf, tagOf, tagsFor, uniqueTags, COMMUNITY_TAGS, MAX_HASHTAGS } from '../scripts/social/story.mjs'
import { composePost, emojiCount } from '../scripts/social/text.mjs'
import { captionFor, questionFor } from '../scripts/social/plan.mjs'
import { affiliateOn, commentFor, commentOf, linkOf, SITE } from '../scripts/social/site.mjs'
import { settingsOf } from '../scripts/social/post.mjs'
import { shopFinder, shopFinderOf, shopLabel, shopOf } from '../scripts/social/shop.mjs'
import { placesOf } from '../scripts/social/source.mjs'
import { kitOf, STROKE } from '../scripts/social/render/parts.mjs'
import { aboutOf, akaLine, ctaOf, keyFacts, onPlatform, placeRows, placesHead, statusWord } from '../scripts/social/types/shared.mjs'
import { BLOCKED, cand, record } from './social-kit.mjs'
import { walk } from './social-data.mjs'

/** The site's own data folder, its own Associates tag, and the sister site's name that no link may carry. */
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')
const OWN_TAG = 'manhwaindex-20'
const SISTER = /whereanime/i

// --- the story fields -------------------------------------------------------

test('story: the rating is the site\'s own figure, and a missing score is no rating', () => {
  assert.deepEqual([ratingOf(73), ratingOf(90), ratingOf(0), ratingOf(null)], ['7.3', '9.0', null, null])
})

test('story: another name is one the image can write, and never the title again', () => {
  const item = { title: 'Cleric of Decay', titleRomaji: 'Bupaeui Saje', titleNative: '부패의 사제', synonyms: ['Priest of Decay', '腐朽的祭司'] }
  assert.equal(altNameOf(item), 'Bupaeui Saje')
  assert.equal(nativeOf(item), '부패의 사제')
  // The romanised name is the title itself: the first Latin synonym is used.
  assert.equal(altNameOf({ title: 'Berserk', titleRomaji: 'Berserk', synonyms: ['بيرسيرك', 'Beruseruku'] }), 'Beruseruku')
  assert.equal(altNameOf({ title: 'Berserk', titleRomaji: 'BERSERK', synonyms: ['烙印勇士'] }), null)
  assert.equal(nativeOf({ title: 'Berserk', titleNative: 'Berserk' }), null)
  assert.equal(akaLine({ native: '부패의 사제', alt: 'Bupaeui Saje' }), 'Also known as 부패의 사제 (Bupaeui Saje).')
  assert.equal(akaLine({ native: null, alt: null }), null)
})

test('story: the synopsis is plain text cut at a sentence end, with no credit, spoiler or markup', () => {
  const blurb = 'Marnac was pulled into a <i>game</i> while playing its worst class. ~!He dies at the end.!~ Now he is the only cleric of the Order of Decay.<br><br>\n\n(Source: WEBTOON)\n\nNotes:\n- Chapter 3 was omitted.'
  assert.equal(plainBlurb(blurb), 'Marnac was pulled into a game while playing its worst class. Now he is the only cleric of the Order of Decay.')
  assert.equal(synopsisOf(blurb), 'Marnac was pulled into a game while playing its worst class. Now he is the only cleric of the Order of Decay.')
  // Only whole sentences, as many as fit.
  assert.equal(synopsisOf(blurb, { max: 70 }), 'Marnac was pulled into a game while playing its worst class.')
  assert.equal(synopsisOf('Too short.'), null)
  assert.equal(synopsisOf(`${'A very long opening sentence that never stops '.repeat(12)}.`), null)
  assert.equal(synopsisOf(null), null)
  assert.doesNotMatch(plainBlurb('Read **more** at https://x.com [here](https://y.com) __now__'), /https?:|\*|_|\[|\]/)
})

test('story: hashtags come from the record, one word each, seven at most, never twice', () => {
  assert.deepEqual([tagOf('PSYREN'), tagOf('One Piece'), tagOf('Frieren: Beyond Journey’s End'), tagOf('Sci-Fi', { lower: true })], ['#PSYREN', '#OnePiece', '#FrierenBeyondJourneysEnd', '#scifi'])
  assert.deepEqual([tagOf(''), tagOf('86'), tagOf('葬送のフリーレン'), tagOf('A Title That Goes On And On Well Past Thirty Letters')], [null, null, null, null])
  assert.equal(seasonTag({ name: 'FALL', year: 2026 }), '#FallAnime2026')
  assert.equal(seasonTag(null), null)
  assert.equal(subgenreOf({ tags: ['Male Protagonist', 'Dark Fantasy', 'Isekai'] }), 'Isekai')
  assert.equal(subgenreOf({ tags: ['Male Protagonist'] }), null)
  const tags = tagsFor({ title: 'Solo Leveling', platforms: ['Crunchyroll'], season: { name: 'WINTER', year: 2024 }, subgenre: 'Dungeon', section: 'anime', genres: ['Action'], studio: 'A-1 Pictures' })
  assert.deepEqual(tags, ['#SoloLeveling', '#Crunchyroll', '#WinterAnime2024', '#Dungeon', '#anime', '#action', '#AnimeRecommendation'])
  assert.ok(tags.length <= MAX_HASHTAGS)
  assert.deepEqual(uniqueTags(['#Anime', '#anime', null, '#x']), ['#Anime', '#x'])
  assert.ok(Object.values(COMMUNITY_TAGS).every((list) => list.length <= 2))
  assert.equal(hashOf('1:7'), hashOf('1:7'))
})

// --- the caption -----------------------------------------------------------

const PARTS = { hook: '🚨 New episode alert 🚨 Frieren episode 7 airs today.', synopsis: 'An elf mage outlives her party and sets out again.', facts: ['It streams on Crunchyroll.', null, '⭐ 9.1 out of 10 on AniList.'], question: 'Are you watching Frieren on Crunchyroll?', cta: ctaOf('episode', 0) }

test('caption: hook, synopsis, facts, question, the comment line, then the hashtags', () => {
  const text = composePost(PARTS, ['#Frieren', '#anime'])
  // Above the fold: the hook, then the single most useful fact on line 2.
  assert.deepEqual(text.split('\n\n'), [`${PARTS.hook}\nIt streams on Crunchyroll.`, PARTS.synopsis, '⭐ 9.1 out of 10 on AniList.', PARTS.question, PARTS.cta, '#Frieren #anime'])
  assert.equal(emojiCount(text), 4)
  // A part the record lacks is left out; the hook and the comment line are never optional.
  assert.equal(composePost({ ...PARTS, synopsis: null, question: null }, []).split('\n\n').length, 3)
  assert.equal(composePost({ ...PARTS, hook: null }, []), null)
  assert.equal(composePost({ ...PARTS, cta: null }, []), null)
})

test('caption: a few emojis at most, no link, no forbidden word, at most seven hashtags', () => {
  assert.equal(composePost({ ...PARTS, hook: '🚨🚨🚨 Too loud.' }, []), null)
  assert.equal(composePost({ ...PARTS, question: 'Ready? 🔥🔥' }, []), null)
  assert.equal(composePost({ ...PARTS, synopsis: 'See https://x.com for more of this story today.' }, []), null)
  assert.equal(composePost({ ...PARTS, facts: ['Buy it on Amazon.'] }, []), null)
  assert.equal((composePost(PARTS, Array.from({ length: 12 }, (_, i) => `#t${i}`)).match(/#/g) || []).length, 7)
})

test('caption: a synopsis that trips the gate is dropped, the post is kept, and the question never changes', () => {
  const type = { key: 'x', captions: [(p) => ({ hook: `👀 ${p.title}.`, facts: ['A fact.'], cta: ctaOf('watch', 0) })], questions: [(p) => `Have you watched ${p.title}?`, (p) => onPlatform(p, 'Are you following')], tags: () => ['#anime'] }
  const post = { item: '9', title: 'Frieren', platform: 'Crunchyroll', synopsis: 'A quiet story about time, loss and an elf who starts to care.' }
  assert.ok(captionFor(type, post, 0, BLOCKED).caption.includes(post.synopsis))
  const gory = captionFor(type, { ...post, synopsis: 'A story full of Gore and little else, told over many years.' }, 0, BLOCKED)
  assert.ok(gory && !/Gore/.test(gory.caption))
  assert.equal(questionFor(type, post), questionFor(type, post))
  assert.deepEqual([onPlatform(post, 'Are you following'), onPlatform({ title: 'Frieren', platform: null }, 'Are you following')], ['Are you following Frieren on Crunchyroll?', 'Are you following Frieren?'])
})

test('words: the status is said the way readers say it, and no schedule is claimed', () => {
  const of = (status, verb) => statusWord({ status, verb })
  assert.deepEqual([of('RELEASING', 'read'), of('RELEASING', 'watch'), of('FINISHED', 'read'), of('HIATUS', 'read'), of('NOT_YET_RELEASED', 'watch'), of(null, 'read')], ['Ongoing', 'Currently airing', 'Completed', 'On hiatus', 'Not yet released', null])
  const facts = keyFacts({ rating: '7.3', genres: ['Action', 'Fantasy'], native: null, alt: 'Bupaeui Saje' })
  assert.deepEqual(facts, ['⭐ 7.3 out of 10 on AniList.', 'Genres: Action and Fantasy.', 'Also known as Bupaeui Saje.'])
  assert.deepEqual(keyFacts({ rating: null, genres: [], native: null, alt: null }), [null, null, null])
  assert.doesNotMatch(JSON.stringify(facts), /still coming out|weekly|every week/i)
})

// --- the first comment ------------------------------------------------------

const SHOP = { name: 'Vol. 1', type: 'book', label: 'Get the book on Amazon', url: 'https://www.amazon.com/dp/1569319006?tag=tag1' }

test('comment: the site link alone until FB_AFFILIATE_COMMENT is exactly true', () => {
  assert.deepEqual([affiliateOn({}), affiliateOn({ FB_AFFILIATE_COMMENT: 'yes' }), affiliateOn({ FB_AFFILIATE_COMMENT: 'true' })], [false, false, true])
  assert.equal(settingsOf({}).affiliate, false)
  assert.equal(settingsOf({ FB_AFFILIATE_COMMENT: 'true' }).affiliate, true)
  const post = { label: 'Where to read it', path: '/manhwa/x', shop: SHOP }
  assert.equal(commentFor(post), `Where to read it: ${linkOf('/manhwa/x')}`)
  assert.equal(commentFor(post, { affiliate: false }), commentFor({ ...post, shop: null }, { affiliate: true }))
})

test('comment: switched on, the site link stays first and the Amazon line says nothing more', () => {
  const lines = commentFor({ label: 'Where to read it', path: '/manhwa/x', shop: SHOP }, { affiliate: true }).split('\n')
  assert.deepEqual(lines, [`Where to read it: ${linkOf('/manhwa/x')}`, `Get the book on Amazon: ${SHOP.url}`])
  assert.ok(lines[0].includes(SITE.origin))
  assert.doesNotMatch(lines.join(' '), /associate|earn|commission|affiliate/i)
  // The classic post carries the same two lines.
  const c = { ...cand(record()), shop: SHOP }
  assert.equal(commentOf(c, { affiliate: true }).split('\n')[1], `Get the book on Amazon: ${SHOP.url}`)
  assert.equal(commentOf(c).split('\n').length, 1)
})

test('shop: only a real product page of this title, and never without a tag', () => {
  assert.equal(shopOf({ a: '1569319006', n: 'Vol. 1', t: 'book' }, 'tag1').url, 'https://www.amazon.com/dp/1569319006?tag=tag1')
  assert.equal(shopOf({ a: '1569319006', t: 'figure' }, 'tag1', shopLabel({ t: 'figure' }, {}, null)).label, 'Get the figure on Amazon')
  assert.equal(shopOf({ a: '1569319006', t: 'book' }, ''), null)
  assert.equal(shopOf(null, 'tag1'), null)
  const find = shopFinderOf({ hand: { titles: { 20: [{ a: '1569319006', n: 'Naruto, Vol. 1', t: 'book' }] } }, products: null, formats: null, tag: 'tag1' })
  assert.equal(find({ id: 20 }).url, 'https://www.amazon.com/dp/1569319006?tag=tag1')
  assert.equal(find({ id: 21 }), null) // no pick: no line, never a search
  assert.equal(shopFinderOf({ hand: null, products: null, tag: 'tag1' })({ id: 20 }), null)
})

test('shop: every link the poster can make carries manhwaindex-20, never whereanime\'s tag', () => {
  const find = shopFinder({ dir: DATA })
  const ids = new Set(['picks.json', 'product-picks.json'].flatMap((name) => Object.keys(JSON.parse(readFileSync(join(DATA, name), 'utf8')).titles)))
  let links = 0
  for (const id of ids) {
    const shop = find({ id: Number(id), relations: [] })
    if (!shop) continue
    const url = new URL(shop.url)
    assert.equal(url.hostname, 'www.amazon.com', shop.url)
    assert.match(url.pathname, /^\/dp\/[A-Z0-9]{10}$/i, shop.url)
    assert.equal(url.searchParams.get('tag'), OWN_TAG, shop.url)
    assert.deepEqual([...url.searchParams.keys()], ['tag'], shop.url)
    const comment = commentFor({ label: 'Where to read it', path: '/manhwa/x', shop }, { affiliate: true })
    assert.ok(comment.startsWith(`Where to read it: ${SITE.origin}/manhwa/x\n`) && comment.endsWith(shop.url))
    assert.doesNotMatch(comment, SISTER, comment)
    assert.doesNotMatch(comment, /associate/i)
    links += 1
  }
  assert.ok(links > 100, `only ${links} links were checked`)
})

// --- the list of official sites ---------------------------------------------

test('places: every site the page lists, once, an English one first', () => {
  const links = [
    { site: 'Naver Webtoon', url: 'https://a', language: 'Korean' },
    { site: 'WEBTOON', url: 'https://b', language: 'Chinese' },
    { site: 'WEBTOON', url: 'https://c', language: 'English' },
    { site: 'Broken', url: '' },
  ]
  const places = placesOf(links)
  assert.deepEqual(places.map((p) => [p.site, p.language]), [['WEBTOON', null], ['Naver Webtoon', 'Korean']])
  assert.ok(places.every((p) => typeof p.free === 'boolean'))
  assert.deepEqual([placesHead(1, 0), placesHead(3, 2)], ['1 legal place', '3 legal places · 2 free to start'])
  const many = Array.from({ length: 8 }, (_, i) => ({ site: `Site ${i}`, language: i === 7 ? 'Korean' : null, free: i === 0 }))
  const { rows, more } = placeRows(many)
  assert.deepEqual([rows.length, more, rows[0].sub], [4, 4, 'Free to start'])
  assert.deepEqual(placeRows(many.slice(6)).rows.map((r) => r.sub), [null, 'Korean'])
})

// --- the image ---------------------------------------------------------------

const THEME = { name: 'Fixture', domain: 'example.com', color: { night: '#101010', raised: '#181818', accent: '#c3e64f', paper: '#f0f0f0' }, font: { display: 'D', text: 'T', displayBold: 700, displayBlack: 900, textRegular: 400, textMedium: 500, textBold: 800 }, fonts: [], mark: { file: null } }
const kit = kitOf(THEME, {})

test('image: quick context is labelled lines of plain type, and a missing fact leaves no line', () => {
  const about = aboutOf({ rating: '7.3', genres: ['Action', 'Fantasy', 'Drama', 'Comedy'], status: 'RELEASING', verb: 'read', alt: 'Bupaeui Saje' })
  assert.deepEqual(about, { rating: '7.3', genres: 'Action · Fantasy · Drama', status: 'Ongoing', alt: 'Bupaeui Saje' })
  const { texts } = walk(kit.about(about, kit.tone('dark'), { width: 400 }))
  // In a narrow column the genres wrap between two of them, never after a separator.
  assert.deepEqual(texts, ['Score', '7.3', 'on AniList', 'Genre', 'Action · Fantasy', 'Drama', 'Status', 'Ongoing', 'Alt title', 'Bupaeui Saje'])
  assert.deepEqual(walk(kit.about({ rating: null, genres: 'Action', status: null, alt: null }, kit.tone('dark'))).texts, ['Genre', 'Action'])
  assert.equal(kit.about({ rating: null, genres: null, status: null, alt: null }, kit.tone('dark')), null)
  assert.deepEqual(aboutOf({ rating: '7.3', genres: [], status: 'FINISHED', verb: 'read', alt: 'X' }, { status: false, alt: false }), { rating: '7.3', genres: null, status: null, alt: null })
  // No shape sits behind a label or a value: no fill, no rounded corner.
  const flat = JSON.stringify(kit.about(about, kit.tone('dark')))
  assert.doesNotMatch(flat, /borderRadius|backgroundColor|boxShadow|gradient/)
})

test('image: a picture gets a thin solid line round it, inside its own size', () => {
  const picture = { src: 'data:image/jpeg;base64,AA==', ratio: 0.5 }
  const big = kit.art(picture, 400, 800)
  assert.deepEqual([big.props.style.width, big.props.style.height, big.props.style.padding, big.props.style.backgroundColor], [400, 800, STROKE.large, THEME.color.paper])
  assert.deepEqual([big.props.children.props.width, big.props.children.props.height], [400 - STROKE.large * 2, 800 - STROKE.large * 2])
  assert.equal(kit.art(picture, 60, 120).props.style.padding, STROKE.small)
  assert.doesNotMatch(JSON.stringify(big), /boxShadow|gradient|blur/)
  // A missing picture is a flat panel of the same size.
  assert.deepEqual([kit.art(null, 60, 120).props.style.width, kit.art(null, 60, 120).props.children], [60, undefined])
})

test('image: the line about the first comment sits above the brand line', () => {
  const page = kit.page(kit.tone('dark'), { cta: 'Every legal place to read it: link in the first comment' }, kit.box({}))
  const { texts } = walk(page)
  assert.deepEqual(texts.slice(-3), ['Every legal place to read it: link in the first comment', 'Fixture', 'example.com'])
  assert.deepEqual(walk(kit.page(kit.tone('dark'), kit.box({}))).texts, ['Fixture', 'example.com'])
})
