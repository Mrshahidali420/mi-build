// The airing news, as on WhereAnime (where-build tasks/airing-queue-plan.md):
// caps per kind on the old queue (FB_TYPE_CAPS), and the types out now,
// final episode and episodes out today, for anime made from comics; the
// link goes to the comic the anime is made from when the index has it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kindsNow, underCap } from '../scripts/social/attempt.mjs'
import { captionFor, planNext } from '../scripts/social/plan.mjs'
import { settingsOf, typeCapsOf } from '../scripts/social/post.mjs'
import { kitOf } from '../scripts/social/render/parts.mjs'
import { commentFor } from '../scripts/social/site.mjs'
import { dateOf } from '../scripts/social/when.mjs'
import { TYPES, REELS } from '../scripts/social/types/index.mjs'
import outNow, { AFTER_MS } from '../scripts/social/types/out-now.mjs'
import finale from '../scripts/social/types/finale.mjs'
import today from '../scripts/social/types/today.mjs'
import { NOW, HOUR, BLOCKED } from './social-kit.mjs'
import { sampleAiringData, walk } from './social-data.mjs'

const THEME = { name: 'Fixture Index', domain: 'example.com', color: { night: '#0b0a12', raised: '#1a1824', accent: '#c4e650', paper: '#f4f1ea' }, font: { display: 'D', text: 'T', displayBold: 700, displayBlack: 800, textRegular: 400, textMedium: 500, textBold: 700 } }
const kit = kitOf(THEME, {})
const typeOf = (key) => TYPES.find((t) => t.key === key)
const posted = (type, minutesAgo, over = {}) => ({ type, status: 'posted', at: NOW - minutesAgo * 60_000, day: dateOf(NOW - minutesAgo * 60_000), ...over })

test('caps: FB_TYPE_CAPS is read as kind -> most posts in 24 hours, bad parts left out', () => {
  assert.deepEqual([...typeCapsOf('where:30, character:30,fact:2,bad,x:0,y:-1,z:1.5')], [['where', 30], ['character', 30], ['fact', 2]])
  assert.equal(typeCapsOf('').size, 0)
  assert.deepEqual([...settingsOf({ FB_TYPE_CAPS: 'fanart:1' }).typeCaps], [['fanart', 1]])
})

test('caps: a kind at its cap of posts in the rolling 24 hours waits; the rest go on', () => {
  const kinds = ['classic', { key: 'where' }, { key: 'fact' }, { key: 'out-now', urgent: true }]
  const caps = typeCapsOf('where:2,fact:1,classic:1')
  const history = [posted('where', 60), posted('where', 30), posted('fact', 25 * 60), { status: 'posted', at: NOW - 10 * 60_000 }]
  assert.deepEqual(underCap(kinds, history, NOW, caps).map((k) => k.key || k), ['fact', 'out-now'])
  assert.deepEqual(kindsNow(kinds, history, NOW, 3, null, caps).map((k) => k.key || k), ['fact', 'out-now'])
  assert.equal(kindsNow(kinds, history, NOW, 3).length, 4)
})

test('out now: an episode that aired in the last four hours, most popular first; few followers is not enough', () => {
  const data = sampleAiringData()
  assert.deepEqual(outNow.find(data, { now: NOW }).map((p) => p.item), ['200:7:out', '201:12:out'])
  assert.deepEqual(outNow.find(data, { now: NOW - 3 * HOUR }).map((p) => p.item), [])
  // Three hours on: the one two hours back has left the four hours, the one due in an hour has come.
  assert.deepEqual(outNow.find(data, { now: NOW - 1 * HOUR + AFTER_MS - 60_000 }).map((p) => p.item), ['200:7:out', '203:5:out'])
})

test('the link: the comic the anime is made from when the index has it, else the anime page', () => {
  const [solo, harbor] = outNow.find(sampleAiringData(), { now: NOW })
  assert.equal(solo.path, '/manhwa/solo-leveling-1')
  assert.match(commentFor(solo).split('\n')[0], /^Read the manhwa it is based on: https:\/\/\S+\/manhwa\/solo-leveling-1$/)
  assert.equal(harbor.path, '/anime/quiet-harbor')
  assert.match(commentFor(harbor), /^Where to watch it: /)
})

test('out now and final episode are their own posts even when the title had a post today', () => {
  const data = sampleAiringData()
  const history = [posted('where', 30, { title: 'Solo Leveling Season 2', item: '200' }), posted('where', 20, { title: 'Quiet Harbor', item: '201' })]
  assert.equal(planNext({ kinds: [outNow], data, history, now: NOW, rng: () => 0 }).post.item, '200:7:out')
  assert.equal(planNext({ kinds: [finale], data, history, now: NOW, rng: () => 0 }).post.item, '201:final')
})

test('final episode: only the last episode of a show, on its day', () => {
  const data = sampleAiringData()
  assert.deepEqual(finale.find(data, { now: NOW }).map((p) => [p.item, p.aired]), [['201:final', true]])
  assert.deepEqual(finale.find(data, { now: NOW + 2 * 24 * HOUR }), [])
})

test('episodes out today: one list a day that names no single title, with a swipe post', () => {
  const [post] = today.find(sampleAiringData(), { now: NOW })
  assert.equal(post.title, null)
  assert.deepEqual(post.view.items.map((r) => r.title), ['Quiet Harbor', 'Solo Leveling Season 2', 'Late Bloom'])
  assert.equal(post.path, '/manhwa/solo-leveling-1')
  assert.ok(REELS.some((reel) => reel.carouselOf === 'today' && typeof reel.carousel === 'function'))
  assert.deepEqual(today.find(sampleAiringData(NOW, []), { now: NOW }), [])
})

test('short captions: a capitals hook, one fact, a question, the link line, three hashtags', () => {
  const data = sampleAiringData()
  for (const type of [outNow, finale, today]) {
    for (const post of type.find(data, { now: NOW })) {
      for (let turn = 0; turn < type.captions.length; turn += 1) {
        const made = captionFor({ ...type, captions: [type.captions[turn]] }, post, 0, BLOCKED)
        assert.ok(made, `${type.key} ${turn}`)
        const parts = made.caption.split('\n\n')
        assert.match(parts.at(-3), /^💬 .*\?$/)
        assert.match(parts.at(-2), /^👇 .*first comment/)
        assert.ok(parts.at(-1).split(' ').length <= 3)
        const hook = parts[0].split('\n')[0]
        assert.equal(hook, hook.toUpperCase(), `${type.key}: the hook is in capitals`)
      }
    }
  }
})

test('cards: the cover, the headline and the tag; a finale says so; the image points at the comic', () => {
  const fake = { src: 'data:image/jpeg;base64,AA==', ratio: 0.7 }
  const [post] = outNow.find(sampleAiringData(), { now: NOW })
  const tree = outNow.template({ ...post.view, art: { hero: fake } }, kit)
  const { texts } = walk(tree)
  assert.ok(['EPISODE 7', 'AIRED TODAY', 'Read the manhwa: link in the first comment', 'Fixture Index', 'example.com'].every((text) => texts.includes(text)), texts.join('|'))
  // The title in the tag (its spaces may be non-breaking).
  assert.ok(texts.some((text) => /^SOLO\sLEVELING\sSEASON\s2$/.test(text)), texts.join('|'))
  assert.deepEqual([tree.props.style.width, tree.props.style.height], [1080, 1350])
  const [last] = finale.find(sampleAiringData(), { now: NOW })
  assert.ok(walk(finale.template({ ...last.view, art: { hero: fake } }, kit)).texts.includes('FINAL EPISODE'))
  assert.equal(typeOf('out-now').sameDay && typeOf('finale').sameDay, true)
})
