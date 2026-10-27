// The Facebook Page poster (scripts/social/): picking, captions, the guard
// ledger, the Graph client and a whole dry run, with no network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCaption, checkCaption, hashtagsOf, FORMATS, MAX_CAPTION, MAX_HASHTAGS } from '../scripts/social/caption.mjs'
import { pickNext, nextMix, formatOrder } from '../scripts/social/pick.mjs'
import { claim, settle, memoryStore, gitStore, guardReason, countDay, keyOf, emptyLedger } from '../scripts/social/ledger.mjs'
import { graphClient, GraphError, GRAPH_VERSION } from '../scripts/social/fb.mjs'
import { settingsOf, MAX_PER_DAY } from '../scripts/social/post.mjs'
import { toCandidate, buildPools, platformsOf } from '../scripts/social/source.mjs'
import { commentOf } from '../scripts/social/site.mjs'
import { NOW, HOUR, DAY, BLOCKED, record, anime, harness } from './social-kit.mjs'

// --- source -------------------------------------------------------------

test('source: a blocked tag, an adult record or no English platform keeps a title off the Page', () => {
  assert.ok(toCandidate(record()))
  assert.equal(toCandidate(record({ tags: ['Dungeon', 'Nudity'] })), null)
  assert.equal(toCandidate(record({ genres: ['Ecchi'] })), null)
  assert.equal(toCandidate(record({ isAdult: true })), null)
  assert.equal(toCandidate(record({ readLinks: [{ site: 'KakaoPage', url: 'https://k', language: 'Korean' }] })), null)
  assert.equal(toCandidate(record({ cover: null })), null)
})

test('source: the path follows the site section and platforms are unique', () => {
  const c = toCandidate(record())
  assert.equal(c.path, '/manhwa/solo-leveling-1')
  assert.equal(toCandidate(anime()).path, '/anime/frieren-2')
  assert.deepEqual(platformsOf([{ site: 'A', url: 'u', language: null }, { site: 'A', url: 'v', language: 'English' }]), ['A'])
})

test('source: NEW holds the episode airing soon, OLD the popular titles', () => {
  const pools = buildPools([record(), anime(), anime({ id: 3, slug: 'later-3', title: 'Later', nextEpisode: { number: 2, at: (NOW + 5 * DAY) / 1000 }, status: 'FINISHED' })], NOW)
  assert.deepEqual(pools.new.map((c) => c.slug), ['frieren-2'])
  assert.ok(pools.old.some((c) => c.slug === 'solo-leveling-1'))
})

// --- captions -----------------------------------------------------------

test('caption: every format is a full post round facts that name the title once, with no link', () => {
  const comic = { ...toCandidate(record()), recs: [{ title: 'Tower of God' }, { title: 'The Beginning After the End' }] }
  const show = toCandidate(anime())
  for (const format of Object.keys(FORMATS)) {
    for (const c of [comic, show]) {
      const text = buildCaption(format, c, NOW, BLOCKED)
      if (!text) continue
      const parts = text.split('\n\n')
      // The facts open the post behind one emoji and still pass the old gate on their own.
      assert.match(parts[0], /^\p{Extended_Pictographic}\S* /u, `${format}: ${text}`)
      // Line 1 is the opening fact, line 2 the next one; the other facts follow the synopsis.
      const facts = parts.slice(0, -3).filter((part) => part !== c.synopsis).join(' ').replace('\n', ' ').replace(/^\S+ /, '')
      assert.equal(checkCaption(facts, c, BLOCKED), null, `${format}: ${text}`)
      assert.ok(parts[0].split('\n').length <= 2 && facts.length <= MAX_CAPTION && MAX_HASHTAGS === 2)
      // Then a question that names the title, the line about the first comment, and the hashtags.
      assert.ok(parts.at(-3).endsWith('?') && parts.at(-3).includes(c.title), text)
      assert.match(parts.at(-2), /^👇 .*first comment/)
      assert.match(parts.at(-1), /^#\S+( #\S+){1,6}$/)
      assert.doesNotMatch(text, /https?:|amazon/i)
      assert.ok((text.match(/\p{Extended_Pictographic}/gu) || []).length <= 4)
    }
  }
})

test('caption: a fact the record lacks is never stated', () => {
  const c = toCandidate(record({ chapters: null, score: null, status: 'FINISHED', endYear: null }))
  const facts = buildCaption('facts', c, NOW, BLOCKED)
  assert.equal(facts, null) // no score and no size: not enough facts
  const where = buildCaption('where', c, NOW, BLOCKED)
  assert.match(where, /The story is complete\./)
  assert.doesNotMatch(where, /chapters/)
  assert.equal(buildCaption('airing', toCandidate(record()), NOW, BLOCKED), null)
  assert.equal(buildCaption('like', c, NOW, BLOCKED), null)
})

test('caption: the same record always gets the same words (no spinning)', () => {
  const c = toCandidate(anime())
  assert.equal(buildCaption('airing', c, NOW, BLOCKED), buildCaption('airing', c, NOW, BLOCKED))
  assert.match(buildCaption('airing', c, NOW, BLOCKED), /^🚨 Episode 7 of Frieren is set to air today at 5:00 PM ET\./)
  assert.equal(checkCaption('{Great|Nice} read. Frieren is out.', c), 'spin syntax')
})

test('caption: blocked words, repeats and long text are refused', () => {
  const c = toCandidate(record())
  assert.equal(checkCaption('Solo Leveling is out. Solo Leveling again.', c), 'title must appear exactly once')
  assert.equal(checkCaption('Solo Leveling has Gore. It is out.', c, BLOCKED), 'blocked word: Gore')
  assert.equal(checkCaption(`Solo Leveling. ${'x'.repeat(MAX_CAPTION)}.`, c), 'too long')
  assert.equal(checkCaption('Solo Leveling is on https://x.com now. Read it.', c), 'link in the caption')
  assert.deepEqual(hashtagsOf({ section: 'manhwa', genres: ['Sci-Fi'] }), ['#manhwa', '#scifi'])
})

// --- picking ------------------------------------------------------------

test('pick: two NEW then one OLD, never the same format twice in a row', () => {
  assert.equal(nextMix([]), 'new')
  assert.equal(nextMix([{ mix: 'new' }, { mix: 'new' }]), 'old')
  assert.equal(nextMix([{ mix: 'new' }, { mix: 'old' }]), 'new')
  assert.ok(!formatOrder('old', [{ format: 'where' }]).includes('where'))

  const shows = Array.from({ length: 8 }, (_, i) => toCandidate(anime({ id: 10 + i, slug: `s-${i}`, title: `Show ${i}` })))
  const comics = Array.from({ length: 8 }, (_, i) => ({ ...toCandidate(record({ id: 30 + i, slug: `c-${i}`, title: `Comic ${i}` })), recs: [{ title: 'Alpha' }, { title: 'Beta' }] }))
  const pools = { new: shows, old: comics }
  const history = []
  for (let i = 0; i < 9; i += 1) {
    const p = pickNext({ pools, history, now: NOW, rng: () => 0.3, blockedTags: BLOCKED })
    assert.ok(p, `pick ${i}`)
    if (history.length) assert.notEqual(p.format, history.at(-1).format)
    history.push({ mix: p.mix, format: p.format, title: p.candidate.title, at: NOW })
  }
  assert.deepEqual(history.map((h) => h.mix), ['new', 'new', 'old', 'new', 'new', 'old', 'new', 'new', 'old'])
  assert.equal(new Set(history.map((h) => h.title)).size, 9)
})

test('pick: a title posted in the last 30 days is skipped, an older one is not', () => {
  const c = toCandidate(record())
  const pools = { new: [], old: [c] }
  assert.equal(pickNext({ pools, history: [{ title: 'SOLO LEVELING', at: NOW - 10 * DAY, mix: 'new' }], now: NOW, rng: () => 0 }), null)
  assert.ok(pickNext({ pools, history: [{ title: 'Solo Leveling', at: NOW - 31 * DAY, mix: 'new' }], now: NOW, rng: () => 0 }))
})

// --- ledger -------------------------------------------------------------

const entry = (over = {}) => ({ key: keyOf('2026-10-12', 'solo-leveling-1', 'manhwaindex'), day: '2026-10-12', slug: 'solo-leveling-1', title: 'Solo Leveling', page: 'manhwaindex', at: NOW, ...over })

test('ledger: two runs claiming the same title at once end with one claim', async () => {
  const store = memoryStore()
  const results = await Promise.all([claim(store, entry(), NOW), claim(store, entry(), NOW), claim(store, entry({ key: 'other|x|manhwaindex', slug: 'x' }), NOW)])
  assert.equal(results.filter((r) => r.ok).length, 1)
  assert.equal(store.snapshot().entries.length, 1)
})

test('ledger: a failed post blocks the title for 30 days; dry runs do not count', async () => {
  const store = memoryStore()
  await claim(store, entry(), NOW)
  await settle(store, entry().key, { status: 'failed' })
  const later = entry({ key: keyOf('2026-10-20', 'solo-leveling-1', 'manhwaindex'), day: '2026-10-20' })
  assert.match(guardReason(store.snapshot(), later, NOW + 8 * DAY), /same title failed/)
  assert.equal(guardReason(store.snapshot(), later, NOW + 31 * DAY), null)
  assert.equal(countDay({ entries: [{ day: 'd', page: 'p', status: 'dry' }, { day: 'd', page: 'p', status: 'posted' }] }, 'd', 'p'), 1)
})

test('ledger: the git store pushes without force and treats a rejected push as a lost race', async () => {
  const calls = []
  let remote = null
  const git = (args, input) => {
    calls.push(args.join(' '))
    if (args[0] === 'ls-remote') return remote ? `${remote}\trefs/heads/social-state\n` : ''
    if (args[0] === 'rev-parse') return `${remote}\n`
    if (args[0] === 'show') return JSON.stringify(emptyLedger())
    if (args[0] === 'hash-object') return 'blob1\n'
    if (args[0] === 'mktree') {
      assert.equal(input, '100644 blob blob1\tledger.json\n')
      return 'tree1\n'
    }
    if (args[0] === 'commit-tree') return 'commit1\n'
    if (args[0] === 'push') {
      if (remote) throw new Error('rejected (non-fast-forward)')
      remote = 'commit1'
      return ''
    }
    return ''
  }
  const store = gitStore({ git })
  const first = await store.read()
  assert.equal(first.version, null)
  assert.equal(await store.write(first.data, first.version, 'Claim'), true)
  assert.equal(await store.write(first.data, null, 'Claim'), false)
  assert.ok(calls.every((c) => !/--force|-f\b|\+commit/.test(c)))
  assert.ok(calls.some((c) => c === 'commit-tree tree1 -m Claim'))
})

// --- Graph client -------------------------------------------------------

function fakeFetch(responses) {
  const seen = []
  const fetch = async (url, init = {}) => {
    seen.push({ url, method: init.method, body: init.body ? Object.fromEntries(new URLSearchParams(init.body)) : null })
    const next = responses.shift()
    return { ok: next.status === undefined || next.status < 400, status: next.status || 200, json: async () => next.json }
  }
  return { fetch, seen }
}

test('fb: photo post, then the comment, with the shapes Meta documents', async () => {
  const { fetch, seen } = fakeFetch([{ json: { name: 'Manhwa Index' } }, { json: { id: 'ph1', post_id: '123_456' } }, { json: { id: 'cm1' } }])
  const graph = graphClient({ pageId: '123', token: 'TOKEN', fetch })
  assert.equal(await graph.pageName(), 'Manhwa Index')
  assert.deepEqual(await graph.publishPhoto({ url: 'https://img/x.jpg', caption: 'Hi' }), { photoId: 'ph1', postId: '123_456' })
  assert.deepEqual(await graph.comment('123_456', 'Where to read it: https://x'), { commentId: 'cm1' })
  assert.match(seen[0].url, new RegExp(`^https://graph.facebook.com/${GRAPH_VERSION}/123\\?fields=name&access_token=TOKEN$`))
  assert.equal(seen[1].url, `https://graph.facebook.com/${GRAPH_VERSION}/123/photos`)
  assert.deepEqual(seen[1].body, { url: 'https://img/x.jpg', caption: 'Hi', published: 'true', access_token: 'TOKEN' })
  assert.equal(seen[2].url, `https://graph.facebook.com/${GRAPH_VERSION}/123_456/comments`)
  assert.deepEqual(seen[2].body, { message: 'Where to read it: https://x', access_token: 'TOKEN' })
})

test('fb: an expired token is an auth error and the token never shows in the message', async () => {
  const { fetch } = fakeFetch([{ status: 400, json: { error: { message: 'Error validating access token TOKEN', type: 'OAuthException', code: 190 } } }])
  const graph = graphClient({ pageId: '123', token: 'TOKEN', fetch })
  await assert.rejects(graph.pageName(), (e) => e instanceof GraphError && e.isAuth && !e.message.includes('TOKEN'))
})

// --- the whole run ------------------------------------------------------

test('run: with no secrets it is a green dry run with NEW and OLD samples', async () => {
  const h = harness({ EVENT: 'workflow_dispatch', DRY_RUN: 'true' }, null)
  assert.equal(await h.go(), 0)
  const out = h.text.join('')
  assert.match(out, /not configured/)
  assert.match(out, /DRY RUN/)
  assert.match(out, /### NEW · airing · Frieren/)
  assert.match(out, /### OLD · /)
  assert.match(out, /Where to watch it: https:\/\/manhwaindex\.com\/anime\/frieren-2$/m)
  assert.equal(h.store.snapshot().entries.length, 0) // the real ledger is untouched
})

test('run: enabled, it claims first, posts the photo, then comments the link', async () => {
  const order = []
  const graph = {
    pageName: async () => 'Page',
    publishPhoto: async ({ url, caption }) => {
      order.push(['photo', url, caption])
      return { postId: 'p1' }
    },
    comment: async (id, msg) => {
      order.push(['comment', id, msg])
      return { commentId: 'c1' }
    },
  }
  const h = harness({ FB_PAGE_ID: '1', FB_PAGE_TOKEN: 't', FB_POST_ENABLED: 'true', EVENT: 'schedule' }, graph)
  const store = h.store
  const read = store.read
  store.read = async () => {
    order.push(['read'])
    return read()
  }
  assert.equal(await h.go(), 0)
  assert.equal(order.filter((o) => o[0] === 'photo').length, 1)
  assert.ok(order.findIndex((o) => o[0] === 'photo') > order.findIndex((o) => o[0] === 'read'))
  const posted = store.snapshot().entries
  assert.equal(posted.length, 1)
  assert.equal(posted[0].status, 'posted')
  assert.equal(order.find((o) => o[0] === 'comment')[2], commentOf(toCandidate(anime())))
  assert.doesNotMatch(order.find((o) => o[0] === 'photo')[2], /https?:/)
})

test('run: a failed post is marked failed, not retried, and the run goes red', async () => {
  let tries = 0
  const graph = {
    pageName: async () => 'Page',
    publishPhoto: async () => {
      tries += 1
      throw new GraphError('boom')
    },
    comment: async () => ({}),
  }
  const h = harness({ FB_PAGE_ID: '1', FB_PAGE_TOKEN: 't', FB_POST_ENABLED: 'true', EVENT: 'workflow_dispatch', COUNT: '3' }, graph)
  assert.equal(await h.go(), 1)
  assert.equal(tries, 1)
  assert.equal(h.store.snapshot().entries[0].status, 'failed')
})

test('run: a refused token fails the run with a plain line; a full day skips the slot', async () => {
  const dead = { pageName: async () => Promise.reject(new GraphError('expired', { code: 190, type: 'OAuthException' })) }
  const h = harness({ FB_PAGE_ID: '1', FB_PAGE_TOKEN: 't', FB_POST_ENABLED: 'true', EVENT: 'schedule' }, dead)
  assert.equal(await h.go(), 1)
  assert.match(h.text.join(''), /Page token was refused/)

  const ok = { pageName: async () => 'Page', publishPhoto: async () => assert.fail('must not post') }
  const full = harness({ FB_PAGE_ID: '1', FB_PAGE_TOKEN: 't', FB_POST_ENABLED: 'true', FB_POSTS_PER_DAY: '1', EVENT: 'schedule' }, ok)
  await full.store.write({ v: 1, entries: [{ key: 'k', day: '2026-10-12', page: 'manhwaindex', title: 'X', status: 'posted', at: NOW }] }, 0)
  assert.equal(await full.go(), 0)
  assert.match(full.text.join(''), /the cap for 24 hours is reached/)
})

test('run: settings default to 24 a day, a chain when it posts for real, and dry unless enabled', () => {
  assert.deepEqual(
    (({ perDay, count, dry }) => ({ perDay, count, dry }))(settingsOf({ FB_PAGE_ID: '1', FB_PAGE_TOKEN: 't', EVENT: 'schedule' })),
    { perDay: 24, count: 3, dry: true },
  )
  const live = { FB_PAGE_ID: '1', FB_PAGE_TOKEN: 't', FB_POST_ENABLED: 'true', EVENT: 'schedule' }
  assert.equal(settingsOf({ ...live, FB_POSTS_PER_DAY: '8' }).count, 1)
  assert.equal(settingsOf({ ...live, FB_POSTS_PER_DAY: '24' }).perDay, 24)
  assert.equal(settingsOf({ ...live, FB_POSTS_PER_DAY: '999' }).perDay, MAX_PER_DAY)
  assert.equal(MAX_PER_DAY, 288)
  assert.equal(settingsOf(live).mode, 'chain')
  assert.equal(settingsOf({ FB_PAGE_ID: '1', FB_PAGE_TOKEN: 't', FB_POST_ENABLED: 'true', DRY_RUN: 'true' }).dry, true)
})
