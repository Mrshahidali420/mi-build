// The template post types behind the gate: which kinds a run may send
// (gate.mjs), which comes next (plan.mjs), the ledger rule for typed posts,
// the words (text.mjs, when.mjs) and a whole run with a type switched on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLASSIC, enabledTypes, onlyClassic } from '../scripts/social/gate.mjs'
import { planNext, rotation, slugOf, captionFor } from '../scripts/social/plan.mjs'
import { claim, guardReason, keyOf, memoryStore } from '../scripts/social/ledger.mjs'
import { cleanText, isDrawable, clip, fitSize, compact, checkText, composeCaption, variantOf, hashtags } from '../scripts/social/text.mjs'
import { nextWeekOf, nextMonthOf, nearDay, labelOfDate, partsOf } from '../scripts/social/when.mjs'
import { graphClient, GRAPH_VERSION } from '../scripts/social/fb.mjs'
import { settingsOf } from '../scripts/social/post.mjs'
import { typedEntry } from '../scripts/social/send.mjs'
import { SITE } from '../scripts/social/site.mjs'
import { TYPES, TYPE_KEYS } from '../scripts/social/types/index.mjs'
import { NOW, HOUR, DAY, harness, pools } from './social-kit.mjs'
import { sampleData } from './social-data.mjs'

const typeOf = (key) => TYPES.find((t) => t.key === key)

// --- the gate -------------------------------------------------------------

test('gate: unset means the classic post only; a type is on only when it is named', () => {
  assert.deepEqual(enabledTypes(undefined, TYPE_KEYS), { types: [CLASSIC], unknown: [] })
  assert.deepEqual(enabledTypes('  ', TYPE_KEYS), { types: [CLASSIC], unknown: [] })
  assert.deepEqual(enabledTypes('classic, Where', TYPE_KEYS).types, [CLASSIC, 'where'])
  assert.deepEqual(enabledTypes('where,where fact', TYPE_KEYS).types, ['where', 'fact'])
  // A typing slip is reported and never silences the Page.
  assert.deepEqual(enabledTypes('rankings', TYPE_KEYS), { types: [CLASSIC], unknown: ['rankings'] })
  assert.equal(onlyClassic([CLASSIC]), true)
  assert.equal(onlyClassic([CLASSIC, 'where']), false)
})

test('gate: only a manual dry run may name its own types; a run that posts reads the variable alone', () => {
  assert.equal(settingsOf({ EVENT: 'schedule', TYPES: 'fact' }).typesValue, '')
  assert.equal(settingsOf({ EVENT: 'schedule', TYPES: 'fact', FB_POST_TYPES: 'episode' }).typesValue, 'episode')
  assert.equal(settingsOf({ EVENT: 'schedule', DRY_RUN: 'true', TYPES: 'fact' }).typesValue, '')
  assert.equal(settingsOf({ EVENT: 'workflow_dispatch', DRY_RUN: 'true', TYPES: 'fact', FB_POST_TYPES: 'episode' }).typesValue, 'fact')
  // A manual run that posts for real cannot switch a type on by itself.
  assert.equal(settingsOf({ EVENT: 'workflow_dispatch', DRY_RUN: 'false', TYPES: 'fact', FB_POST_TYPES: 'episode' }).typesValue, 'episode')
  assert.equal(settingsOf({ EVENT: 'workflow_dispatch', DRY_RUN: 'false', TYPES: 'fact' }).typesValue, '')
  assert.equal(settingsOf({ EVENT: 'workflow_dispatch', FB_POST_TYPES: 'episode' }).typesValue, 'episode')
})

// --- words ----------------------------------------------------------------

test('text: only what the fonts can draw reaches an image', () => {
  assert.equal(cleanText('Fate/kaleid liner Prisma☆Illya'), 'Fate/kaleid liner PrismaIllya')
  assert.equal(cleanText('Demon King Academy Ⅱ'), 'Demon King Academy II')
  assert.equal(cleanText('Pokémon  Horizons'), 'Pokémon Horizons')
  assert.equal(isDrawable('Frieren: Beyond Journey’s End'), true)
  assert.equal(isDrawable('葬送のフリーレン'), false)
  assert.equal(isDrawable(''), false)
  assert.equal(clip('A very long title that goes on and on', 20), 'A very long title…')
  assert.equal(clip('Short', 20), 'Short')
  assert.equal(fitSize('Short', [[10, 80], [30, 50]]), 80)
  assert.equal(fitSize('x'.repeat(99), [[10, 80], [30, 50]]), 50)
  assert.deepEqual([compact(950), compact(1234), compact(65564), compact(482691), compact(1250000)], ['950', '1.2K', '65.6K', '483K', '1.3M'])
})

test('text: a caption with a link, an emoji, a missing fact or a blocked word is refused', () => {
  assert.equal(checkText('Episode 7 airs today.'), null)
  assert.equal(checkText('See https://x.com now.'), 'link in the caption')
  assert.equal(checkText('Out now \u{1F525}'), 'emoji')
  assert.equal(checkText('Episode undefined airs today.'), 'a missing fact')
  assert.equal(checkText('Buy it on Amazon.'), 'forbidden word')
  assert.equal(checkText('A Gore fest.', { blockedTags: ['Gore'] }), 'blocked word: Gore')
  assert.equal(composeCaption(['One.', null, 'Two.'], ['anime', 'Sci-Fi', 'extra']), 'One. Two.\n\n#anime #scifi')
  assert.equal(composeCaption([null, '']), null)
  assert.deepEqual(hashtags(['anime', 'anime', '']), ['#anime'])
  assert.deepEqual([0, 1, 2, 3].map((turn) => variantOf(['a', 'b', 'c'], turn)), ['a', 'b', 'c', 'a'])
})

test('when: next week is Monday to Sunday and next month rolls over the year', () => {
  assert.deepEqual(partsOf(NOW), { year: 2026, month: 10, day: 12, weekday: 1 })
  assert.deepEqual([nextWeekOf(NOW).from, nextWeekOf(NOW).to], ['2026-10-19', '2026-10-25'])
  // From a Sunday, next week starts the next day.
  assert.equal(nextWeekOf(NOW + 6 * DAY).from, '2026-10-19')
  assert.equal(nextWeekOf(NOW + 7 * DAY).from, '2026-10-26')
  assert.deepEqual(nextMonthOf(NOW), { year: 2026, month: 11, name: 'November' })
  assert.deepEqual(nextMonthOf(Date.UTC(2026, 11, 15, 18)), { year: 2027, month: 1, name: 'January' })
  assert.equal(labelOfDate('2026-10-19'), '19 Oct')
  assert.deepEqual([nearDay(NOW + HOUR, NOW), nearDay(NOW + 20 * HOUR, NOW), nearDay(NOW + 3 * DAY, NOW)], ['today', 'tomorrow', null])
})

// --- the ledger rule for typed posts --------------------------------------

const typed = (over = {}) => ({ key: keyOf('2026-10-12', 'episode:2:7', SITE.key), day: '2026-10-12', slug: 'episode:2:7', title: 'Frieren', page: SITE.key, type: 'episode', item: '2:7', gapDays: 300, titleGap: false, at: NOW, ...over })

test('ledger: the same item of the same type may not repeat inside its gap', async () => {
  const store = memoryStore()
  assert.equal((await claim(store, typed(), NOW)).ok, true)
  // The same episode on a later day is refused; next week's episode is not.
  const again = typed({ key: keyOf('2026-10-13', 'episode:2:7', SITE.key), day: '2026-10-13' })
  assert.match(guardReason(store.snapshot(), again, NOW + DAY), /same episode item claimed on 2026-10-12/)
  const nextWeek = typed({ key: keyOf('2026-10-19', 'episode:2:8', SITE.key), day: '2026-10-19', slug: 'episode:2:8', item: '2:8' })
  assert.equal(guardReason(store.snapshot(), nextWeek, NOW + 7 * DAY), null)
  // Past its own gap the item is free again.
  const short = typed({ key: 'k2', type: 'onair', item: '2', gapDays: 28 })
  await claim(store, short, NOW)
  assert.match(guardReason(store.snapshot(), { ...short, key: 'k3' }, NOW + 27 * DAY), /same onair item/)
  assert.equal(guardReason(store.snapshot(), { ...short, key: 'k3' }, NOW + 29 * DAY), null)
})

test('ledger: the 30-day title gap holds a typed post only when its type asks for it', async () => {
  const store = memoryStore()
  await claim(store, { key: 'classic', day: '2026-10-12', slug: 'frieren-2', title: 'Frieren', page: SITE.key, mix: 'old', format: 'where', at: NOW }, NOW)
  const fact = typed({ key: 'f', type: 'fact', item: 'fact:2:score', titleGap: true })
  assert.match(guardReason(store.snapshot(), fact, NOW + DAY), /same title claimed/)
  assert.equal(guardReason(store.snapshot(), typed({ key: 'e' }), NOW + DAY), null)
  // A list post has no title at all.
  assert.equal(guardReason(store.snapshot(), typed({ key: 'l', type: 'next-week', item: 'week:2026-10-19', title: null, titleGap: true }), NOW), null)
})

// --- planning -------------------------------------------------------------

const post = (item, title = `Title ${item}`) => ({ item, title, path: `/manhwa/${item}`, label: 'Where to read it', art: {}, view: {} })
const kind = (key, posts, over = {}) => ({ key, name: key, urgent: false, gapDays: 30, titleGap: false, window: 1, find: () => posts, captions: [(p) => [`${p.title} one.`], (p) => [`${p.title} two.`]], tags: () => ['manhwa'], ...over })
const entryOf = (type, item, over = {}) => ({ page: SITE.key, type, item, title: `Title ${item}`, day: '2026-10-12', at: NOW - HOUR, status: 'posted', ...over })

test('plan: the kind used least recently takes the turn, and classic is one of the kinds', () => {
  const kinds = [kind('fact', [post('f1')]), CLASSIC, kind('where', [post('w1')])]
  assert.equal(planNext({ kinds, data: {}, history: [], now: NOW }).type.key, 'fact')
  const afterFact = [entryOf('fact', 'f0', { day: '2026-10-11' })]
  assert.deepEqual(planNext({ kinds, data: {}, history: afterFact, now: NOW }), { classic: true })
  const afterBoth = [...afterFact, { page: SITE.key, title: 'Old', day: '2026-10-11', at: NOW - HOUR, mix: 'old', format: 'where' }]
  assert.equal(planNext({ kinds, data: {}, history: afterBoth, now: NOW }).type.key, 'where')
  assert.deepEqual(rotation(kinds, afterBoth).map((k) => (typeof k === 'string' ? k : k.key)), ['where', 'fact', CLASSIC])
  // With the classic post out of things to say, the other kinds go on.
  assert.equal(planNext({ kinds, data: {}, history: afterFact, now: NOW, skip: new Set([CLASSIC]) }).type.key, 'where')
})

test('plan: news goes first, every time while the day is short, in turns when it is not', () => {
  const news = kind('episode', [post('e1'), post('e2'), post('e3')], { urgent: true })
  const kinds = [kind('fact', [post('f1')]), news]
  assert.equal(planNext({ kinds, data: {}, history: [], now: NOW }).type.key, 'episode')
  const justPosted = [entryOf('episode', 'e0')]
  // Room to spare (3 episodes, 6 posts left): the rotation gets a turn after an episode.
  assert.equal(planNext({ kinds, data: {}, history: justPosted, now: NOW, slotsLeft: 6 }).type.key, 'fact')
  // Short of room (3 episodes, 3 posts left): episodes again.
  assert.equal(planNext({ kinds, data: {}, history: justPosted, now: NOW, slotsLeft: 3 }).type.key, 'episode')
})

test('plan: no item twice inside its gap, no title twice in a day, wordings taken in turn', () => {
  const where = kind('where', [post('w1'), post('w2')], { titleGap: true })
  const seen = [entryOf('where', 'w1', { at: NOW - 5 * DAY, day: '2026-10-07' })]
  assert.equal(planNext({ kinds: [where], data: {}, history: seen, now: NOW }).post.item, 'w2')
  // Title w2 went out today as a classic post: nothing is left for this kind.
  const sameDay = [...seen, { page: SITE.key, title: 'Title w2', day: '2026-10-12', at: NOW - HOUR, mix: 'old', format: 'facts' }]
  assert.equal(planNext({ kinds: [where], data: {}, history: sameDay, now: NOW }), null)
  assert.equal(planNext({ kinds: [where], data: {}, history: [], now: NOW, skip: new Set([slugOf(where, post('w1'))]) }).post.item, 'w2')
  assert.equal(planNext({ kinds: [where], data: {}, history: [], now: NOW }).caption, 'Title w1 one.\n\n#manhwa')
  assert.equal(planNext({ kinds: [where], data: {}, history: [entryOf('where', 'w9', { title: 'Other', at: NOW - 40 * DAY })], now: NOW }).caption, 'Title w1 two.\n\n#manhwa')
  // A wording that fails the gate gives way to the next one.
  const picky = kind('x', [post('x1')], { captions: [() => ['See https://x.com.'], (p) => [`${p.title} ok.`]] })
  assert.deepEqual(captionFor(picky, post('x1'), 0), { caption: 'Title x1 ok.\n\n#manhwa', variant: 1 })
})

test('plan: the site types find real posts in the sample data', () => {
  const data = sampleData()
  const plan = planNext({ kinds: [typeOf('fact'), CLASSIC, typeOf('where')], data, history: [], now: NOW })
  assert.equal(plan.type.key, 'fact')
  assert.match(plan.post.item, /^fact:\d+:[a-z]+$/)
  assert.deepEqual(typedEntry(plan, '2026-10-12', NOW), {
    key: keyOf('2026-10-12', `fact:${plan.post.item}`, SITE.key),
    day: '2026-10-12',
    slug: `fact:${plan.post.item}`,
    title: plan.post.title,
    page: SITE.key,
    mix: 'type',
    format: 'type:fact',
    type: 'fact',
    item: plan.post.item,
    gapDays: 300,
    titleGap: true,
    variant: 0,
    at: NOW,
  })
  // The fact card went out: the same title rests, so the next kind brings another.
  const after = [{ ...typedEntry(plan, '2026-10-12', NOW), status: 'posted' }]
  const next = planNext({ kinds: [typeOf('fact'), typeOf('where')], data, history: after, now: NOW + HOUR })
  assert.equal(next.type.key, 'where')
  assert.notEqual(next.post.title, plan.post.title)
})

// --- the Graph call for a picture made on the runner ----------------------

test('fb: a template picture is sent as a multipart file, never as an address', async () => {
  const seen = []
  const fetch = async (url, init) => {
    seen.push({ url, init })
    return { ok: true, status: 200, json: async () => ({ id: 'ph9', post_id: '123_9' }) }
  }
  const graph = graphClient({ pageId: '123', token: 'TOKEN', fetch })
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
  assert.deepEqual(await graph.publishPhotoFile({ bytes, caption: 'Hi' }), { photoId: 'ph9', postId: '123_9' })
  const { url, init } = seen[0]
  assert.equal(url, `https://graph.facebook.com/${GRAPH_VERSION}/123/photos`)
  assert.ok(init.body instanceof FormData)
  assert.equal(init.headers, undefined) // fetch writes the multipart boundary itself
  assert.deepEqual([init.body.get('caption'), init.body.get('published'), init.body.get('access_token'), init.body.get('url')], ['Hi', 'true', 'TOKEN', null])
  const file = init.body.get('source')
  assert.deepEqual([file.name, file.type, file.size], ['post.jpg', 'image/jpeg', 4])
  await assert.rejects(graph.publishPhotoFile({ bytes: Buffer.alloc(0), caption: 'x' }), /image bytes/)
})

// --- a whole run ----------------------------------------------------------

const LIVE = { FB_PAGE_ID: '1', FB_PAGE_TOKEN: 't', FB_POST_ENABLED: 'true', EVENT: 'schedule' }

function typedHarness(env, graph, { render } = {}) {
  const h = harness(env, graph)
  const calls = { loadTypes: 0, render: 0 }
  const go = () =>
    h.run({
      loadPools: async () => ({ pools: pools(), data: sampleData(), source: 'test' }),
      loadTypes: async () => {
        calls.loadTypes += 1
        return TYPES
      },
      render:
        render ||
        (async () => {
          calls.render += 1
          return { png: Buffer.from('png'), jpeg: Buffer.from('jpeg-bytes') }
        }),
    })
  return { ...h, go, calls }
}

test('run: with FB_POST_TYPES unset the template code is never loaded', async () => {
  const graph = { pageName: async () => 'Page', publishPhoto: async () => ({ postId: 'p1' }), publishPhotoFile: async () => assert.fail('no template post'), comment: async () => ({ commentId: 'c1' }) }
  const h = typedHarness({ ...LIVE, TYPES: 'where' }, graph)
  assert.equal(await h.go(), 0)
  assert.deepEqual(h.calls, { loadTypes: 0, render: 0 })
})

test('run: a switched-on type draws its picture, claims, sends the file, then comments', async () => {
  const order = []
  const graph = {
    pageName: async () => 'Page',
    publishPhoto: async () => assert.fail('a template post is sent as a file'),
    publishPhotoFile: async ({ bytes, caption }) => {
      order.push(['file', bytes.toString(), caption])
      return { postId: 'p7' }
    },
    comment: async (id, message) => {
      order.push(['comment', id, message])
      return { commentId: 'c7' }
    },
  }
  const h = typedHarness({ ...LIVE, FB_POST_TYPES: 'where' }, graph)
  assert.equal(await h.go(), 0)
  assert.deepEqual(h.calls, { loadTypes: 1, render: 1 })
  assert.equal(order[0][1], 'jpeg-bytes')
  assert.match(order[0][2], /^📖 Where can you read Solo Leveling legally\?\n\nIt is on Tapas and KakaoPage\. .*It is completed at 201 chapters\. ⭐ 8\.4 out of 10 on AniList\. Genres: Action and Fantasy\./)
  assert.match(order[0][2], /\?\n\n👇 .+first comment\.\n\n#SoloLeveling #Tapas #Dungeon #manhwa #action #ManhwaRecommendation #KoreanWebtoon$/)
  assert.doesNotMatch(order[0][2], /https?:/)
  assert.match(order[1][2], /^Where to read it: https:\/\/manhwaindex\.com\/manhwa\/solo-leveling-1\?.*utm_source=facebook/)
  const [entry] = h.store.snapshot().entries
  assert.deepEqual([entry.status, entry.type, entry.postId, entry.commentId], ['posted', 'where', 'p7', 'c7'])
  assert.match(h.text.join(''), /Post types switched on: where/)
})

test('run: a picture that cannot be made skips the item and claims nothing', async () => {
  const graph = { pageName: async () => 'Page', publishPhotoFile: async () => assert.fail('nothing to send'), comment: async () => ({}) }
  const h = typedHarness({ ...LIVE, FB_POST_TYPES: 'new-title' }, graph, { render: async () => Promise.reject(new Error('the main picture could not be loaded')) })
  assert.equal(await h.go(), 0)
  assert.equal(h.store.snapshot().entries.length, 0)
  assert.match(h.text.join(''), /its picture could not be made/)
})

test('run: a dry run draws the picture, shows the post and leaves the ledger alone', async () => {
  const saved = []
  const h = typedHarness({ FB_PAGE_ID: '1', FB_PAGE_TOKEN: 't', EVENT: 'workflow_dispatch', DRY_RUN: 'true', COUNT: '2', TYPES: 'fact,where' }, { pageName: async () => 'Page' })
  const code = await h.run({
    loadPools: async () => ({ pools: pools(), data: sampleData(), source: 'test' }),
    loadTypes: async () => TYPES,
    render: async () => ({ png: Buffer.from('p'), jpeg: Buffer.from('j') }),
    preview: (name, bytes) => saved.push([name, bytes.length]),
  })
  assert.equal(code, 0)
  const out = h.text.join('')
  assert.match(out, /### TEMPLATE · fact · /)
  assert.match(out, /### TEMPLATE · where · /)
  assert.equal(saved.length, 2)
  assert.equal(h.store.snapshot().entries.length, 0)
})
