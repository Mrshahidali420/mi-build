// Every template post type: it finds posts from the data alone, every wording
// of its caption passes the gate, its image tree is whole, and the renderer
// turns a tree into a 1080x1350 picture with the real font files.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { captionFor } from '../scripts/social/plan.mjs'
import { checkText, MAX_POST, MAX_POST_TAGS } from '../scripts/social/text.mjs'
import { kitOf, contain, toneOf, W, H } from '../scripts/social/render/parts.mjs'
import { loadArt, loadFonts, renderPost, WIDTH, HEIGHT } from '../scripts/social/render/engine.mjs'
import { THEME as SITE_THEME } from '../scripts/social/theme.mjs'
import { TYPES, TYPE_KEYS } from '../scripts/social/types/index.mjs'
import { factsOf } from '../scripts/social/types/fact.mjs'
import { scopesOf } from '../scripts/social/types/ranking.mjs'
import { samplePosts, argsOf } from '../scripts/social/samples.mjs'
import { NOW, DAY, BLOCKED } from './social-kit.mjs'
import { fakeArt, sampleData, walk } from './social-data.mjs'

/** The site's own fonts under made-up names and colours, with no mark file to read. */
const THEME = { ...SITE_THEME, name: 'Fixture Index', domain: 'example.com', color: { night: '#101010', raised: '#181818', accent: '#e0688a', paper: '#f0f0f0' }, mark: { file: null } }
const kit = kitOf(THEME, {})
const data = sampleData()
const typeOf = (key) => TYPES.find((t) => t.key === key)
const postsOf = (type) => type.find(data, { now: NOW })

test('types: the six Manhwa Index types are there, each with its own name and design', () => {
  assert.deepEqual([...TYPE_KEYS].sort(), ['character', 'fact', 'new-title', 'next', 'ranking', 'where'])
  assert.equal(new Set(TYPES.map((t) => t.template)).size, TYPES.length)
  for (const type of TYPES) {
    assert.ok(type.name && type.gapDays > 0 && type.captions.length >= 3, type.key)
    assert.equal(typeof type.find, 'function')
  }
})

test('types: every type finds a post in the sample data, and every wording passes the gate', () => {
  for (const type of TYPES) {
    const posts = postsOf(type)
    assert.ok(posts.length > 0, `${type.key} found nothing`)
    for (const post of posts) {
      assert.ok(post.item && /^\/(manhwa|manga|manhua|novel|genre)\//.test(post.path) && post.label, `${type.key}: ${JSON.stringify(post).slice(0, 80)}`)
      const seen = new Set()
      for (let turn = 0; turn < type.captions.length; turn += 1) {
        const made = captionFor({ ...type, captions: [type.captions[turn]] }, post, 0, BLOCKED)
        assert.ok(made, `${type.key} wording ${turn + 1} failed for ${post.item}`)
        assert.equal(checkText(made.caption, { blockedTags: BLOCKED, max: MAX_POST, emoji: 4, maxTags: MAX_POST_TAGS }), null)
        // Hook, then a question, then the line about the first comment, then the hashtags.
        const parts = made.caption.split('\n\n')
        assert.match(parts[0], /\p{Extended_Pictographic}/u, `${type.key}: the hook opens with an emoji`)
        assert.ok(parts.at(-3).endsWith('?'), `${type.key}: ${made.caption}`)
        assert.match(parts.at(-2), /^👇 .*first comment/)
        assert.match(parts.at(-1), /^#\S+( #\S+)*$/)
        seen.add(made.caption)
      }
      assert.equal(seen.size, type.captions.length, `${type.key}: the wordings must differ`)
    }
  }
})

test('types: every image tree is whole (the right size, no missing text, sized pictures)', () => {
  for (const type of TYPES) {
    for (const post of postsOf(type)) {
      const tree = type.template({ ...post.view, art: fakeArt(post) }, kit)
      assert.deepEqual([tree.props.style.width, tree.props.style.height], [W, H], type.key)
      const { texts, images } = walk(tree)
      assert.ok(texts.includes('Fixture Index') && texts.includes('example.com'), `${type.key}: the site name and address close every image`)
      assert.ok(texts.some((text) => /link in the first comment$/.test(text)), `${type.key}: every image points at the first comment`)
      for (const text of texts) assert.doesNotMatch(text, /undefined|null|NaN|\[object/, `${type.key}: ${text}`)
      for (const image of images) assert.ok(image.width > 0 && image.height > 0 && image.src, `${type.key}: a picture without a size`)
      // A missing small picture leaves a flat panel, never a hole in the tree.
      assert.ok(type.template({ ...post.view, art: { hero: fakeArt(post).hero, thumbs: [] } }, kit))
    }
  }
})

test('types: what each one says comes from the record', () => {
  const where = postsOf(typeOf('where'))
  assert.ok(!where.some((p) => p.title === 'Old Scan')) // its only cover is the small one
  const solo = where.find((p) => p.title === 'Solo Leveling')
  // Every site the page lists, the Korean one too, with the page's own count line.
  assert.deepEqual(solo.view.sites, [{ name: 'Tapas', sub: 'Free to start' }, { name: 'KakaoPage', sub: 'Korean · Free to start' }])
  assert.deepEqual([solo.view.head, solo.view.more, solo.view.count, solo.view.countLine, solo.view.meta], ['2 legal places · 2 free to start', 0, '201', 'chapters, completed', 'Korean manhwa · 2018'])
  assert.deepEqual(solo.view.about, { rating: '8.4', genres: 'Action · Fantasy', status: 'Completed', alt: null })
  const paper = where.find((p) => p.title === 'Paper Sky')
  assert.deepEqual([paper.view.count, paper.view.countLine, paper.state], ['14', 'volumes, completed', 'It is completed.'])
  const gate = where.find((p) => p.title === 'Gate Runner 0')
  // No chapter count on the record: the year stands in, and the status is said plainly.
  assert.deepEqual([gate.view.count, gate.view.countLine, gate.view.meta, gate.state, gate.view.about.status], ['2023', 'Korean manhwa', 'Korean manhwa', 'It is ongoing.', 'Ongoing'])

  // Only a start date known to the day or the month, inside the last weeks, is "new".
  const fresh = postsOf(typeOf('new-title'))
  assert.deepEqual(fresh.map((p) => [p.title, p.started]), [['Fresh Ink', 'September 2026']])
  assert.deepEqual(fresh[0].view.lines, [['Started', 'September 2026'], ['What it is', 'Korean manhwa'], ['Genre', 'Romance · Drama'], ['Status', 'Ongoing'], ['Read it on', 'Tapas']])
  assert.equal(typeOf('new-title').find(sampleData(), { now: NOW + 90 * DAY }).length, 0)

  const scopes = scopesOf(data.titles)
  assert.deepEqual(scopes.map((s) => s.key), ['manhwa:ongoing', 'manhwa:action', 'manhwa:fantasy'])
  const [rank] = postsOf(typeOf('ranking'))
  assert.deepEqual([rank.item, rank.title, rank.view.heading], ['rank:manhwa:ongoing', null, 'ongoing manhwa'])
  // A genre ranking links the site's genre page; the ongoing one links the title in first place.
  const ranks = postsOf(typeOf('ranking'))
  assert.deepEqual(ranks.map((p) => p.path), ['/manhwa/gate-0', '/genre/action', '/genre/fantasy'])
  assert.deepEqual([ranks[1].label, ranks[1].view.cta], ['More action manhwa, with where to read each', 'More action manhwa: link in the first comment'])
  assert.deepEqual(rank.view.rows.map((r) => `${r.rank} ${r.title} ${r.count}`), ['1 Gate Runner 0 90K', '2 Gate Runner 1 80K', '3 Gate Runner 2 70K', '4 Gate Runner 3 60K', '5 Gate Runner 4 50K'])

  // The main cast with a real picture; a supporting role and a blank portrait are left out.
  const chars = postsOf(typeOf('character'))
  assert.deepEqual(chars.filter((p) => p.title === 'Solo Leveling').map((p) => [p.item, p.name]), [['char:901', 'Sung Jinwoo'], ['char:902', 'Cha Haein']])

  const [next] = postsOf(typeOf('next'))
  assert.deepEqual([next.title, next.names], ['Solo Leveling', ['Gate Runner 0', 'Gate Runner 1', 'Gate Runner 2']])
})

test('facts: only what the record states, and a fact it lacks is never offered', () => {
  const solo = data.byId.get(1)
  assert.deepEqual(factsOf(solo).map((f) => [f.kind, f.figure]), [['rated', '#7'], ['popular', '#12']]) // strongest first; a good score and a short run are not strong facts
  assert.equal(factsOf(solo)[0].say[0], "Solo Leveling is number 7 on AniList's all-time rating chart for manga, manhwa and manhua.")
  // A rank for one year is not an all-time rank; a series still running has no run to state.
  assert.deepEqual(solo.ranks, [{ rank: 7, type: 'RATED' }, { rank: 12, type: 'POPULAR' }])
  assert.deepEqual(factsOf(data.byId.get(10)), [])
  assert.deepEqual(factsOf(data.byId.get(40)).map((f) => [f.kind, f.figure]), [['score', '9.1']]) // volumes are not chapters
  // The sentence on the image names the title, and only the top 50 of a chart is offered.
  assert.ok(factsOf(solo).every((f) => f.line.startsWith('Solo Leveling is number')))
  assert.deepEqual(factsOf({ ...solo, ranks: [{ rank: 51, type: 'RATED' }] }), [])
})

test('parts: a picture is placed whole, and each tone keeps type readable', () => {
  assert.deepEqual(contain(0.5, 400, 400), { width: 200, height: 400 })
  assert.deepEqual(contain(2, 400, 400), { width: 400, height: 200 })
  assert.equal(toneOf(THEME, 'dark').ink, THEME.color.paper)
  assert.equal(toneOf(THEME, 'light').pop, THEME.color.night) // the accent is never type on cream
  assert.equal(toneOf(THEME, 'accent').bg, THEME.color.accent)
})

test('theme: the site name is set in the stencil face and the mark is the vector one', () => {
  assert.equal(SITE_THEME.font.brand, 'Saira Stencil One')
  assert.match(SITE_THEME.mark.file, /logo-mark\.svg$/)
  assert.deepEqual(SITE_THEME.color, { night: '#070b1c', raised: '#101733', accent: '#e0688a', paper: '#f5ecdd' })
})

test('samples: different posts per type, and the arguments of the sample command', async () => {
  const loadData = async (at) => sampleData(at)
  const facts = await samplePosts(typeOf('fact'), { per: 2, now: NOW, loadData })
  assert.equal(new Set(facts.map((s) => s.post.title)).size, 2)
  const fresh = await samplePosts(typeOf('new-title'), { per: 2, now: NOW, loadData })
  assert.equal(fresh.length, 1) // the sample catalog has one new title
  assert.deepEqual(argsOf(['--out', 'x', '--per', '3', '--types', 'fact,where', '--long']), { out: 'x', per: 3, only: ['fact', 'where'], long: true })
})

test('engine: the real fonts load and a template becomes a 1080x1350 picture', async () => {
  const { default: sharp } = await import('sharp')
  assert.ok(loadFonts(THEME).length >= 5)
  const cover = await sharp({ create: { width: 46, height: 65, channels: 3, background: '#3355aa' } }).jpeg().toBuffer()
  const fetch = async (url) => (/missing/.test(url) ? { ok: false } : { ok: true, arrayBuffer: async () => cover })
  const art = await loadArt('https://img.example/a.jpg', { fetch, sharp })
  assert.ok(art.src.startsWith('data:image/jpeg;base64,') && Math.abs(art.ratio - 46 / 65) < 0.01)
  assert.equal(await loadArt('https://img.example/missing.jpg', { fetch, sharp }), null)

  const type = typeOf('where')
  const [post] = postsOf(type)
  const { png, jpeg } = await renderPost(type, post, { theme: THEME, fetch })
  const meta = await sharp(png).metadata()
  assert.deepEqual([meta.width, meta.height, meta.format], [WIDTH, HEIGHT, 'png'])
  assert.equal((await sharp(jpeg).metadata()).format, 'jpeg')
  // The hero picture is required: without it nothing is drawn.
  await assert.rejects(renderPost(type, { ...post, art: { hero: 'https://img.example/missing.jpg' } }, { theme: THEME, fetch }), /main picture/)
})
