// Reels (reel/, types/reel-*.mjs): the video command, the slides, the three
// calls that publish one, and the rules that keep reels few: off until
// named, a daily limit inside the cap, never two in a row. No ffmpeg and no
// network run here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kindsNow } from '../scripts/social/attempt.mjs'
import { graphClient, GRAPH_VERSION, UPLOAD_HOST } from '../scripts/social/fb.mjs'
import { enabledTypes } from '../scripts/social/gate.mjs'
import { reelsPerDayOf, DAY_MS, MINUTE_MS } from '../scripts/social/pace.mjs'
import { settingsOf } from '../scripts/social/post.mjs'
import { kitOf } from '../scripts/social/render/parts.mjs'
import { sheetTimes } from '../scripts/social/reel/samples.mjs'
import { END_LINE, SAFE } from '../scripts/social/reel/slides.mjs'
import { ffmpegArgs, ffmpegError, holdsOf, lengthOf, HOLD, LENGTH, REEL } from '../scripts/social/reel/video.mjs'
import { SITE } from '../scripts/social/site.mjs'
import { KINDS, REELS, TYPES, TYPE_KEYS } from '../scripts/social/types/index.mjs'
import { NOW, harness } from './social-kit.mjs'
import { sampleData, walk } from './social-data.mjs'

// --- the video -----------------------------------------------------------------

test('video: a reel is 8 to 20 seconds whatever the number of slides', () => {
  for (let items = 1; items <= 8; items += 1) {
    const holds = holdsOf(items)
    assert.equal(holds.length, items + 2)
    const seconds = lengthOf(holds)
    assert.ok(seconds >= LENGTH.min && seconds <= LENGTH.max, `${items} items: ${seconds} s`)
  }
  assert.deepEqual(holdsOf(5), [HOLD.title, 2.6, 2.6, 2.6, 2.6, 2.6, HOLD.end])
  assert.equal(lengthOf(holdsOf(5)), 16)
  assert.deepEqual([REEL.width, REEL.height, REEL.fps], [1080, 1920, 30])
})

test('video: the ffmpeg command is H.264 at 30 fps with a closed GOP, a silent AAC track and cross-fades', () => {
  const holds = holdsOf(2)
  const args = ffmpegArgs({ frames: ['a.png', 'b.png', 'c.png', 'd.png'], holds, out: 'reel.mp4' })
  const value = (flag) => args[args.indexOf(flag) + 1]
  assert.deepEqual([value('-c:v'), value('-pix_fmt'), value('-r'), value('-g'), value('-c:a'), value('-ar'), value('-ac')], ['libx264', 'yuv420p', '30', '60', 'aac', '48000', '2'])
  assert.ok(args.includes('+cgop') && args.includes('+faststart'))
  assert.equal(args.filter((arg) => arg === '-i').length, 5) // four slides and the silence
  assert.match(value('-i'), /a\.png/)
  assert.ok(args.includes('anullsrc=channel_layout=stereo:sample_rate=48000'))
  const graph = value('-filter_complex')
  assert.equal((graph.match(/zoompan=/g) || []).length, 4) // every slide moves, slowly
  assert.equal((graph.match(/xfade=transition=fade/g) || []).length, 3)
  assert.match(graph, /s=1080x1920:fps=30/)
  // Each fade starts where the slide before it has been held, less the fades already spent.
  const offsets = [...graph.matchAll(/offset=([\d.]+)/g)].map((m) => Number(m[1]))
  assert.deepEqual(offsets, [2, 4.2, 6.4].map((n) => Math.round(n * 100) / 100))
  assert.equal(value('-t'), String(lengthOf(holds)))
  assert.equal(args.at(-1), 'reel.mp4')
  assert.deepEqual(sheetTimes(12, 6), [1, 3, 5, 7, 9, 11])
  // A missing ffmpeg is said plainly; otherwise the end of what it wrote (an empty buffer is not a message).
  assert.equal(ffmpegError(Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' }), Buffer.alloc(0)).message, 'ffmpeg is not installed on this machine')
  assert.equal(ffmpegError(new Error('timed out'), Buffer.alloc(0)).message, 'ffmpeg failed: timed out')
  assert.equal(ffmpegError(new Error('x'), Buffer.from('Unknown encoder\n')).message, 'ffmpeg failed: Unknown encoder')
})

// --- the slides ----------------------------------------------------------------

const THEME = { name: 'Fixture', domain: 'example.com', color: { night: '#101010', raised: '#181818', accent: '#c3e64f', paper: '#f0f0f0' }, font: { display: 'D', text: 'T', displayBold: 700, displayBlack: 900, textRegular: 400, textMedium: 500, textBold: 800 }, fonts: [], mark: { file: null } }
const kit = kitOf(THEME, {})
const artOf = (post) => ({ hero: post.art.hero ? { src: 'data:image/jpeg;base64,AA==', ratio: 0.7 } : null, thumbs: (post.art.thumbs || []).map(() => ({ src: 'data:image/jpeg;base64,AA==', ratio: 0.7 })) })

test('slides: an opening slide, one per item, and a closing slide that names the site and the first comment', () => {
  const data = sampleData()
  let made = 0
  for (const type of REELS) {
    assert.equal(type.reel, true)
    assert.match(type.key, /^reel-/)
    for (const post of type.find(data, { now: NOW }).slice(0, 2)) {
      made += 1
      const trees = type.slides({ ...post.view, art: artOf(post) }, kit)
      assert.equal(trees.length, post.view.items.length + 2, type.key)
      assert.equal(post.art.thumbs.length, post.view.items.length, `${type.key}: one picture per item`)
      for (const tree of trees) {
        assert.deepEqual([tree.props.style.width, tree.props.style.height], [1080, 1920], type.key)
        const { texts } = walk(tree)
        assert.ok(texts.includes('Fixture'), `${type.key}: the site name is on every slide`)
        for (const text of texts) assert.doesNotMatch(text, /undefined|null|NaN|\[object/, `${type.key}: ${text}`)
      }
      // A short last word is tied to the one before it with a non-breaking space (parts.mjs noOrphan).
      const last = walk(trees.at(-1)).texts.map((text) => text.replaceAll(String.fromCharCode(160), ' '))
      assert.ok(last.includes(END_LINE) && last.includes('example.com'), type.key)
      // A missing cover leaves a flat panel, never a hole.
      assert.ok(type.slides({ ...post.view, art: { hero: null, thumbs: [] } }, kit).length)
    }
  }
  assert.ok(made >= 2)
  assert.ok(SAFE.top >= 150 && SAFE.bottom >= 300) // clear of Facebook's own buttons and caption
})

// --- the gate and the limits -----------------------------------------------------

test('gate: a reel is off until its own name is written, and is not one of the picture types', () => {
  const names = KINDS.map((kind) => kind.key)
  assert.deepEqual(names, [...TYPE_KEYS, ...REELS.map((reel) => reel.key)])
  assert.ok(!TYPES.some((type) => type.reel) && REELS.every((reel) => !reel.template))
  assert.deepEqual(REELS.map((reel) => reel.key).sort(), ['reel-next', 'reel-ranking'])
  assert.deepEqual(enabledTypes('where', names).types, ['where'])
  assert.deepEqual(enabledTypes(`where, ${REELS[0].key}`, names).types, ['where', REELS[0].key])
  assert.deepEqual(enabledTypes('reel', names), { types: ['classic'], unknown: ['reel'] })
})

const reel = { key: 'reel-x', reel: true }
const picture = { key: 'a' }
const entry = (minutesAgo, over = {}) => ({ at: NOW - minutesAgo * MINUTE_MS, page: SITE.key, status: 'posted', ...over })

test('limits: three reels in a rolling day unless set, ten at most, and never two in a row', () => {
  assert.deepEqual([reelsPerDayOf(undefined), reelsPerDayOf(''), reelsPerDayOf('5'), reelsPerDayOf('0'), reelsPerDayOf('99'), reelsPerDayOf('x')], [3, 3, 5, 0, 10, 3])
  assert.equal(settingsOf({}).reelsPerDay, 3)
  const kinds = ['classic', picture, reel]
  assert.deepEqual(kindsNow(kinds, [], NOW, 3), kinds)
  assert.deepEqual(kindsNow(kinds, [entry(30)], NOW, 3), kinds)
  // The last post was a reel: the next one is not.
  assert.deepEqual(kindsNow(kinds, [entry(30), entry(10, { reel: true })], NOW, 3), ['classic', picture])
  // Three reels inside 24 hours: no more until the oldest is a day old.
  const three = [entry(600, { reel: true }), entry(400, { reel: true }), entry(200, { reel: true }), entry(10)]
  assert.deepEqual(kindsNow(kinds, three, NOW, 3), ['classic', picture])
  assert.deepEqual(kindsNow(kinds, three, NOW, 4), kinds)
  assert.deepEqual(kindsNow(kinds, [entry(DAY_MS / MINUTE_MS + 1, { reel: true }), entry(400, { reel: true }), entry(200, { reel: true }), entry(10)], NOW, 3), kinds)
  assert.deepEqual(kindsNow(kinds, [], NOW, 0), ['classic', picture])
})

// --- publishing ------------------------------------------------------------------

function fakeGraph({ uploadUrl, statuses = [{ video_status: 'ready' }] } = {}) {
  const calls = []
  let polls = 0
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers || {}, body: init.body })
    const json = (body) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body })
    if (String(url).includes('/video_reels') && String(init.body).includes('upload_phase=start')) return json({ video_id: 'v9', upload_url: uploadUrl })
    if (String(url).includes('video-upload')) return json({ success: true })
    if (String(url).includes('/video_reels')) return json({ success: true })
    if (String(url).includes('fields=status')) return json({ status: statuses[Math.min(polls++, statuses.length - 1)] })
    return json({ id: 'c1' })
  }
  return { calls, client: graphClient({ pageId: '77', token: 'SECRET', fetch }) }
}

test('publish: start, the file to the upload host, then finish as PUBLISHED with the description', async () => {
  const { calls, client } = fakeGraph({ uploadUrl: `https://${UPLOAD_HOST}/video-upload/${GRAPH_VERSION}/v9` })
  const made = await client.publishReel({ bytes: Buffer.from('mp4-bytes'), description: 'A caption. #tag' })
  assert.deepEqual(made, { videoId: 'v9', postId: 'v9' })
  assert.deepEqual(calls.map((c) => new URL(c.url).pathname), [`/${GRAPH_VERSION}/77/video_reels`, `/video-upload/${GRAPH_VERSION}/v9`, `/${GRAPH_VERSION}/77/video_reels`])
  assert.match(calls[0].body, /upload_phase=start/)
  assert.deepEqual([calls[1].headers.Authorization, calls[1].headers.offset, calls[1].headers.file_size], ['OAuth SECRET', '0', '9'])
  assert.equal(calls[1].body.toString(), 'mp4-bytes')
  const finish = new URLSearchParams(calls[2].body)
  assert.deepEqual([finish.get('upload_phase'), finish.get('video_id'), finish.get('video_state'), finish.get('description')], ['finish', 'v9', 'PUBLISHED', 'A caption. #tag'])
  await assert.rejects(client.publishReel({ bytes: Buffer.alloc(0), description: 'x' }), /needs the video bytes/)
})

test('publish: the token in a header only ever goes to the upload host', async () => {
  const { calls, client } = fakeGraph({ uploadUrl: 'https://evil.example/video-upload/v9' })
  await client.publishReel({ bytes: Buffer.from('x'), description: 'd' })
  assert.equal(new URL(calls[1].url).host, UPLOAD_HOST)
  assert.ok(calls.every((c) => !c.headers.Authorization || new URL(c.url).host === UPLOAD_HOST))
})

test('publish: the first comment waits until Facebook has published the reel', async () => {
  const slept = []
  const { client } = fakeGraph({ statuses: [{ video_status: 'processing', publishing_phase: { status: 'not_started' } }, { video_status: 'processing', publishing_phase: { status: 'complete' } }] })
  assert.equal(await client.reelReady('v9', { sleep: async (ms) => slept.push(ms) }), true)
  assert.equal(slept.length, 1)
  const never = fakeGraph({ statuses: [{ video_status: 'processing' }] })
  assert.equal(await never.client.reelReady('v9', { sleep: async () => {}, tries: 3 }), false)
  const broken = fakeGraph({ statuses: [{ video_status: 'processing', processing_phase: { status: 'error', error: { message: 'Resolution too low' } } }] })
  await assert.rejects(broken.client.reelReady('v9', { sleep: async () => {} }), /could not process the reel: Resolution too low/)
})

// --- a whole run -----------------------------------------------------------------

const wording = [(p) => ({ hook: `🔥 ${p.item} is here.`, facts: ['One fact.'], cta: '👇 Link in the first comment.' })]
const kind = (key, count, over = {}) => ({ key, name: key, urgent: false, gapDays: 300, titleGap: false, window: 1, captions: wording, find: () => Array.from({ length: count }, (_, i) => ({ item: `${key}-${i}`, title: null, path: '/x', label: 'More', art: {}, view: {} })), ...over })
const LIVE = { FB_PAGE_ID: '1', FB_PAGE_TOKEN: 't', FB_POST_ENABLED: 'true', EVENT: 'workflow_dispatch' }

function reelRun(env, made = {}) {
  const sent = []
  const graph = {
    pageName: async () => 'Page',
    usage: () => null,
    publishPhotoFile: async () => {
      sent.push('picture')
      return { postId: `p${sent.length}` }
    },
    publishReel: async ({ bytes, description }) => {
      sent.push(['reel', bytes.toString(), description])
      return { videoId: `v${sent.length}`, postId: `v${sent.length}` }
    },
    reelReady: async (id) => sent.push(['ready', id]),
    comment: async (id) => {
      sent.push(['comment', id])
      return { commentId: 'c' }
    },
  }
  const saved = []
  const h = harness({ ...LIVE, ...env }, graph)
  const go = () =>
    h.run({
      loadPools: async () => ({ pools: { new: [], old: [] }, data: {}, source: 'test' }),
      loadTypes: async () => [kind('a', 60), kind('reel-x', 20, { reel: true })],
      render: async (type, post, opts) => (type.reel ? { mp4: Buffer.from('mp4'), seconds: 12, pngs: [], ...made.reel?.(opts) } : { png: Buffer.from('p'), jpeg: Buffer.from('j') }),
      preview: (name, bytes) => saved.push([name, bytes.toString()]),
    })
  return { ...h, go, sent, saved }
}

test('run: a named reel is made, sent, waited for and commented on, and the ledger marks it', async () => {
  const r = reelRun({ FB_POST_TYPES: 'reel-x', COUNT: '1' })
  assert.equal(await r.go(), 0)
  assert.equal(r.sent[0][0], 'reel')
  assert.equal(r.sent[0][1], 'mp4')
  assert.match(r.sent[0][2], /^🔥 reel-x-0 is here\.\nOne fact\./)
  assert.deepEqual(r.sent.slice(1), [['ready', 'v1'], ['comment', 'v1']])
  const [entry] = r.store.snapshot().entries
  assert.deepEqual([entry.reel, entry.format, entry.type, entry.status, entry.postId], [true, 'reel:reel-x', 'reel-x', 'posted', 'v1'])
  assert.match(r.text.join(''), /REEL · reel-x/)
  assert.match(r.text.join(''), /a reel made on the runner, 1080x1920, 12 s/)
})

test('run: with the type not named, no reel is ever made', async () => {
  const r = reelRun({ FB_POST_TYPES: 'a', FB_CHAIN_MINUTES: '60', FB_POSTS_PER_DAY: '288' })
  assert.equal(await r.go(), 0)
  assert.ok(r.sent.length > 5 && r.sent.every((s) => s === 'picture' || s[0] === 'comment'))
})

test('run: reels stay inside their daily limit and never run back to back', async () => {
  const r = reelRun({ FB_POST_TYPES: 'a,reel-x', FB_CHAIN_MINUTES: '120', FB_POSTS_PER_DAY: '288' })
  assert.equal(await r.go(), 0)
  const order = r.store.snapshot().entries.sort((x, y) => x.at - y.at).map((e) => (e.reel ? 'R' : 'p'))
  assert.equal(order.length, 24)
  assert.equal(order.filter((kind) => kind === 'R').length, 3) // FB_REELS_PER_DAY unset
  assert.doesNotMatch(order.join(''), /RR/)
  const five = reelRun({ FB_POST_TYPES: 'a,reel-x', FB_CHAIN_MINUTES: '120', FB_POSTS_PER_DAY: '288', FB_REELS_PER_DAY: '5' })
  await five.go()
  assert.equal(five.store.snapshot().entries.filter((e) => e.reel).length, 5)
})

test('run: a dry run keeps the MP4 as a preview and sends nothing', async () => {
  const r = reelRun({ FB_POST_TYPES: 'reel-x', DRY_RUN: 'true', COUNT: '1', TYPES: 'reel-x' })
  assert.equal(await r.go(), 0)
  assert.deepEqual(r.saved, [['reel-x-reel-x-0.mp4', 'mp4']])
  assert.equal(r.sent.length, 0)
  assert.equal((r.store.snapshot().entries || []).length, 0)
})

test('run: a reel writes its music in the ledger, and the next reel is told to take another track', async () => {
  const asked = []
  const tracks = ['one.m4a', 'two.m4a', 'three.m4a']
  const reel = (opts) => {
    asked.push(opts?.avoidTrack ?? null)
    return { track: tracks[asked.length - 1] }
  }
  const r = reelRun({ FB_POST_TYPES: 'a,reel-x', FB_CHAIN_MINUTES: '120', FB_POSTS_PER_DAY: '288' }, { reel })
  assert.equal(await r.go(), 0)
  const reels = r.store.snapshot().entries.filter((e) => e.reel).sort((x, y) => x.at - y.at)
  assert.deepEqual(reels.map((e) => e.track), tracks)
  assert.deepEqual(asked, [null, 'one.m4a', 'two.m4a'])
  assert.match(r.text.join(''), /music one\.m4a/)
})
