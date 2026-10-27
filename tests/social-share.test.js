// Shares of the sister Page's posts (scripts/social/share.mjs): the settings,
// the picker, the slotting inside the cap, and whole runs with a fake Graph
// client and a fake sister ledger. No network runs here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GraphError } from '../scripts/social/fb.mjs'
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../scripts/social/pace.mjs'
import { settingsOf } from '../scripts/social/post.mjs'
import { fetchLedger, ledgerUrlOf, permalinkOf, pickShare, shareFromOf, shareMessage, shareOpen, shareSettingsOf, sharesPerDayOf, SHARE_REST_MS } from '../scripts/social/share.mjs'
import { SITE } from '../scripts/social/site.mjs'
import { NOW, harness } from './social-kit.mjs'

const SISTER = 'sister'
const REPO = 'Owner/sister-build'
const post = (n, at, over = {}) => ({ key: `k${n}`, page: SISTER, status: 'posted', postId: `111_${n}`, title: `Title ${n}`, format: 'type:a', at, ...over })

// --- settings ------------------------------------------------------------------

test('settings: FB_SHARES_PER_DAY is off when unset, 0 or not a number, and never over 4', () => {
  assert.deepEqual([undefined, '', '0', 'x', '-2', ' 3 ', '4', '9'].map(sharesPerDayOf), [0, 0, 0, 0, 0, 3, 4, 4])
  assert.equal(shareFromOf(' Owner/repo.name '), 'Owner/repo.name')
  assert.deepEqual(['', 'nope', 'a/b/c', 'https://github.com/a/b'].map(shareFromOf), [null, null, null, null])
})

test('settings: shares are on only with both a number and a repo, and the name is optional', () => {
  assert.deepEqual(shareSettingsOf({}), { perDay: 0, from: null, name: null, on: false })
  assert.equal(shareSettingsOf({ FB_SHARES_PER_DAY: '3' }).on, false)
  assert.equal(shareSettingsOf({ FB_SHARE_FROM: REPO }).on, false)
  assert.deepEqual(shareSettingsOf({ FB_SHARES_PER_DAY: '3', FB_SHARE_FROM: REPO, FB_SHARE_FROM_NAME: ' Sister ' }), { perDay: 3, from: REPO, name: 'Sister', on: true })
  assert.deepEqual(settingsOf({ FB_SHARES_PER_DAY: '7', FB_SHARE_FROM: REPO }).share, { perDay: 4, from: REPO, name: null, on: true })
  assert.equal(ledgerUrlOf(REPO), `https://raw.githubusercontent.com/${REPO}/social-state/ledger.json`)
})

test('message: one plain line, taking turns, with the sister name only when given', () => {
  assert.equal(shareMessage(0), 'New on our sister Page:')
  assert.equal(shareMessage(1, 'Sister'), 'Worth a look from our sister Page, Sister:')
  assert.equal(shareMessage(2), 'Seen this yet? From our sister Page:')
  assert.equal(shareMessage(4), shareMessage(0))
  for (let i = 0; i < 4; i += 1) assert.doesNotMatch(shareMessage(i, 'X'), /#|\n|amazon/i)
})

// --- the picker ----------------------------------------------------------------

test('permalink: a post id becomes the post address, a reel id the reel address', () => {
  assert.equal(permalinkOf('1329988470202923_122113872321503689'), 'https://www.facebook.com/1329988470202923/posts/122113872321503689')
  assert.equal(permalinkOf('1234567890', { reel: true }), 'https://www.facebook.com/reel/1234567890')
  assert.equal(permalinkOf('1234567890'), 'https://www.facebook.com/1234567890')
  assert.deepEqual([permalinkOf(null), permalinkOf('p1'), permalinkOf('1_2_3')], [null, null, null])
})

test('picker: only posts between 2 and 72 hours old, the newest first', () => {
  const ledger = { entries: [post(1, NOW - HOUR_MS), post(2, NOW - 3 * HOUR_MS), post(3, NOW - 10 * HOUR_MS), post(4, NOW - 73 * HOUR_MS)] }
  assert.equal(pickShare({ ledger, now: NOW }).postId, '111_2')
  assert.equal(pickShare({ ledger: { entries: [post(1, NOW - HOUR_MS), post(4, NOW - 73 * HOUR_MS)] }, now: NOW }), null)
})

test('picker: only posts that really went out, from the other Page, never a share, never one shared before', () => {
  const at = NOW - 5 * HOUR_MS
  const ledger = {
    entries: [
      post(1, at, { status: 'failed' }),
      post(2, at, { status: 'dry' }),
      post(3, at, { postId: null }),
      post(4, at, { page: SITE.key }),
      post(5, at, { share: true }),
      post(6, at),
      post(7, at - HOUR_MS),
    ],
  }
  assert.equal(pickShare({ ledger, now: NOW }).postId, '111_6')
  const history = [{ share: true, sharedFrom: '111_6', status: 'failed', at: NOW - DAY_MS }]
  assert.equal(pickShare({ ledger, history, now: NOW }).postId, '111_7')
  assert.equal(pickShare({ ledger, history: [...history, { share: true, sharedFrom: '111_7', at: NOW - 80 * DAY_MS }], now: NOW }), null)
})

test('picker: another kind than the last share when there is one', () => {
  const ledger = { entries: [post(1, NOW - 3 * HOUR_MS, { format: 'type:a' }), post(2, NOW - 4 * HOUR_MS, { format: 'type:b' })] }
  assert.equal(pickShare({ ledger, now: NOW }).postId, '111_1')
  assert.equal(pickShare({ ledger, history: [{ share: true, sharedFrom: '9', sourceFormat: 'type:a', at: NOW - DAY_MS }], now: NOW }).postId, '111_2')
})

test('picker: an empty or broken sister ledger gives nothing to share, never an error', () => {
  for (const ledger of [null, undefined, {}, { entries: null }, { entries: 'x' }, { entries: [] }, { entries: [null, 3, 'x', { status: 'posted' }, { status: 'posted', postId: '1_2', at: 'yesterday' }] }]) {
    assert.equal(pickShare({ ledger, now: NOW }), null)
  }
})

test('fetch: the raw ledger is read with a timeout; any failure is a short reason', async () => {
  const ok = await fetchLedger(REPO, { fetch: async (url, init) => (assert.equal(url, ledgerUrlOf(REPO)), assert.ok(init.signal), { ok: true, json: async () => ({ entries: [] }) }) })
  assert.deepEqual(ok, { entries: [] })
  await assert.rejects(fetchLedger(REPO, { fetch: async () => ({ ok: false, status: 404 }) }), /HTTP 404/)
  await assert.rejects(fetchLedger(REPO, { fetch: async () => ({ ok: true, json: async () => JSON.parse('<html>') }) }), /not JSON/)
  await assert.rejects(fetchLedger(REPO, { fetch: async () => ({ ok: true, json: async () => ({ v: 1 }) }) }), /no list of posts/)
  await assert.rejects(fetchLedger(REPO, { fetch: async () => Promise.reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })) }), /no answer in 15 s/)
  await assert.rejects(fetchLedger(REPO, { fetch: async () => Promise.reject(new Error('ENOTFOUND')) }), /network error: ENOTFOUND/)
})

// --- the slotting --------------------------------------------------------------

test('slotting: off at 0, never two shares in a row, the daily number in the rolling day, spread out, rest after a failure', () => {
  const p = (at) => ({ at, status: 'posted' })
  const s = (at, status = 'posted') => ({ share: true, at, status })
  assert.equal(shareOpen([], NOW, 0), false)
  assert.equal(shareOpen([], NOW, 3), true)
  assert.equal(shareOpen([p(NOW - HOUR_MS)], NOW, 3), true)
  // The last post was a share.
  assert.equal(shareOpen([p(NOW - 10 * HOUR_MS), s(NOW - 7 * HOUR_MS)], NOW, 3), false)
  // Three in the rolling day already.
  const three = [s(NOW - 20 * HOUR_MS), p(NOW - 19 * HOUR_MS), s(NOW - 14 * HOUR_MS), p(NOW - 13 * HOUR_MS), s(NOW - 7 * HOUR_MS), p(NOW - HOUR_MS)]
  assert.equal(shareOpen(three, NOW, 3), false)
  assert.equal(shareOpen(three, NOW, 4), true)
  // Spread: with 3 a day, no closer than 6 hours to the last share.
  assert.equal(shareOpen([s(NOW - 5 * HOUR_MS), p(NOW - HOUR_MS)], NOW, 3), false)
  assert.equal(shareOpen([s(NOW - 6 * HOUR_MS), p(NOW - HOUR_MS)], NOW, 3), true)
  // A failed share: no share for six hours, even at 4 a day.
  const failed = [s(NOW - 5 * HOUR_MS, 'failed'), p(NOW - HOUR_MS)]
  assert.equal(shareOpen(failed, NOW, 4), false)
  assert.equal(shareOpen(failed, NOW - 5 * HOUR_MS + SHARE_REST_MS, 4), true)
})

// --- whole runs ----------------------------------------------------------------

const wording = [(p) => ({ hook: `🔥 ${p.item} is here.`, facts: ['One fact.'], cta: '👇 Link in the first comment.' })]
const kind = (key, count) => ({ key, name: key, urgent: false, gapDays: 300, titleGap: false, window: 1, captions: wording, find: () => Array.from({ length: count }, (_, i) => ({ item: `${key}-${i}`, title: null, path: '/x', label: 'More', art: {}, view: {} })) })
const LIVE = { FB_PAGE_ID: '1', FB_PAGE_TOKEN: 't', FB_POST_ENABLED: 'true', FB_POST_TYPES: 'a', FB_SHARES_PER_DAY: '3', FB_SHARE_FROM: REPO }

/** A sister Page that posts every half hour, as seen at the moment of the fetch. */
const sisterAt = (now) => ({ entries: Array.from({ length: 160 }, (_, i) => post(i, now - i * 30 * MINUTE_MS, { format: i % 2 ? 'type:a' : 'type:b' })) })

function shareRun(env, { publishLink, fetch } = {}) {
  const sent = []
  const fetched = []
  const graph = {
    pageName: async () => 'Page',
    usage: () => null,
    publishPhotoFile: async () => {
      sent.push(['picture'])
      return { postId: `p${sent.length}` }
    },
    publishLink:
      publishLink ||
      (async ({ link, message }) => {
        sent.push(['share', link, message])
        return { postId: `s${sent.length}` }
      }),
    comment: async (id) => {
      sent.push(['comment', id])
      return { commentId: 'c' }
    },
  }
  const h = harness({ ...LIVE, ...env }, graph)
  const sisterFetch =
    fetch ||
    (async (url) => {
      fetched.push(url)
      return { ok: true, json: async () => sisterAt(h.clock()) }
    })
  const go = () =>
    h.run({
      fetch: sisterFetch,
      loadPools: async () => ({ pools: { new: [], old: [] }, data: {}, source: 'test' }),
      loadTypes: async () => [kind('a', 5000)],
      render: async () => ({ png: Buffer.from('p'), jpeg: Buffer.from('j') }),
    })
  const entries = () => h.store.snapshot().entries.sort((x, y) => x.at - y.at)
  return { ...h, go, sent, fetched, entries }
}

test('run: shares stay inside their daily number and the cap, never two in a row, each sister post once, no first comment', async () => {
  const r = shareRun({ FB_CHAIN_MINUTES: '340', FB_POSTS_PER_DAY: '13', FB_SHARE_FROM_NAME: 'Sister' })
  for (let i = 0; i < 8; i += 1) assert.equal(await r.go(), 0) // about 45 hours
  const all = r.entries()
  const order = all.map((e) => (e.share ? 'S' : 'p')).join('')
  assert.doesNotMatch(order, /SS/)
  const shares = all.filter((e) => e.share)
  assert.ok(shares.length >= 5, order)
  for (const e of all) assert.ok(all.filter((x) => x.at > e.at - DAY_MS && x.at <= e.at).length <= 13)
  for (const e of shares) {
    assert.ok(shares.filter((x) => x.at > e.at - DAY_MS && x.at <= e.at).length <= 3)
    assert.equal(e.status, 'posted')
    assert.equal(e.link, permalinkOf(e.sharedFrom))
    assert.equal(e.sharedRepo, REPO)
    assert.equal(e.title, null)
  }
  assert.equal(new Set(shares.map((e) => e.sharedFrom)).size, shares.length)
  const shared = r.sent.filter((x) => x[0] === 'share')
  assert.equal(shared.length, shares.length)
  assert.deepEqual(shared.slice(0, 2).map((x) => x[2]), ['New on our sister Page, Sister:', 'Worth a look from our sister Page, Sister:'])
  assert.match(shared[0][1], /^https:\/\/www\.facebook\.com\/111\/posts\/\d+$/)
  const sharePostIds = new Set(shares.map((e) => e.postId))
  assert.ok(r.sent.filter((x) => x[0] === 'comment').every((x) => !sharePostIds.has(x[1])))
  assert.ok(r.fetched.every((url) => url === ledgerUrlOf(REPO)))
})

test('run: a sister ledger that cannot be read skips the share, says so once, and the posts go on', async () => {
  let calls = 0
  const fetch = async () => {
    calls += 1
    throw Object.assign(new Error('aborted'), { name: 'TimeoutError' })
  }
  const r = shareRun({ FB_CHAIN_MINUTES: '180', FB_POSTS_PER_DAY: '24' }, { fetch })
  assert.equal(await r.go(), 0)
  assert.equal(r.entries().filter((e) => e.share).length, 0)
  assert.ok(r.entries().length >= 3)
  assert.ok(calls >= 1 && calls <= 3, `${calls} fetches`) // once per data refresh, not once per post
  assert.match(r.text.join(''), new RegExp(`No share this time: the ledger of ${REPO} could not be read \\(no answer in 15 s\\)`))
  assert.equal(r.store.snapshot().health?.halted ?? null, null)
})

test('run: a share Facebook refuses never stops the chain: it is written down, never retried, shares rest', async () => {
  const refuse = async () => {
    throw new GraphError('POST /1/feed failed: (#200) Permissions error', { status: 403, code: 200, type: 'OAuthException' })
  }
  const r = shareRun({ FB_CHAIN_MINUTES: '300', FB_POSTS_PER_DAY: '288' }, { publishLink: refuse })
  assert.equal(await r.go(), 0)
  const { health } = r.store.snapshot()
  const shares = r.entries().filter((e) => e.share)
  assert.equal(shares.length, 1)
  assert.equal(shares[0].status, 'failed')
  assert.ok(r.entries().filter((e) => !e.share && e.status === 'posted').length > 20)
  assert.equal(health.halted, null)
  assert.deepEqual([health.share.code, health.share.note], [200, 'POST /1/feed failed: (#200) Permissions error'])
  assert.match(r.text.join(''), /A share failed\*\* \(code 200: .*\)\. No share for 6 hours; the other posts go on\./)
  assert.doesNotMatch(r.text.join(''), /token was refused|failures in a row/)
})

test('run: a dry run previews the share and sends nothing', async () => {
  const r = shareRun({ DRY_RUN: 'true', EVENT: 'workflow_dispatch', COUNT: '2', TYPES: 'a' })
  assert.equal(await r.go(), 0)
  assert.equal(r.sent.length, 0)
  assert.equal((r.store.snapshot().entries || []).length, 0)
  const text = r.text.join('')
  assert.match(text, /### SHARE · type:b · Title 4/)
  assert.match(text, /> New on our sister Page:/)
  assert.match(text, /Shares: up to 3 in any 24 hours/)
})

test('run: with shares off, the sister ledger is never read', async () => {
  const r = shareRun({ FB_SHARES_PER_DAY: '', FB_CHAIN_MINUTES: '120', FB_POSTS_PER_DAY: '288' })
  assert.equal(await r.go(), 0)
  assert.equal(r.fetched.length, 0)
  assert.equal(r.entries().filter((e) => e.share).length, 0)
  assert.match(r.text.join(''), /Shares: off\./)
})
