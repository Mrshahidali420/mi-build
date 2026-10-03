// Reader ratings and reviews: the no-links rule, the checks on a vote and a
// review, the average, the markup, and the whole path through the Worker's
// doors and the owner's buttons against a real SQLite with the real schema.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escapeHTML } from 'astro/runtime/server/escape.js'
import {
  linkProblem,
  hasHtml,
  spamProblem,
  cleanText,
  cleanName,
  checkReview,
  checkVote,
  checkReviewTap,
  ratingOf,
  ratingLine,
  aggregateJsonld,
  reviewsJsonld,
  paragraphsOf,
  reviewDate,
  MAX_TEXT,
  DEFAULT_NAME,
} from '../src/lib/reviews.mjs'
import { handleVote, handleReview, forgetSenders } from '../src/lib/reviews-api.js'
import { handleReviewTap } from '../src/lib/review-actions.js'
import { readTitleReviews } from '../src/lib/reviews-read.js'
import { sign } from '../src/lib/beacon-pass.js'
import { titleKey } from '../src/lib/shard-key.js'
import { analyticsD1 } from './d1-shim.js'

const GOOD_TEXT = 'The art carries the slow first arc, and the payoff in the second half is worth it.'

// ------------------------------------------------------------ the link rule

const LINKS = [
  'read it at https://example.com instead',
  'http://foo.bar has every chapter',
  'HTTPS://EXAMPLE.ORG is faster',
  'try h t t p s : / / somewhere',
  'hxxp://evil.example works too',
  'h-t-t-p-s colon slash slash mysite',
  'ftp://files.example for raws',
  'javascript:alert(1)',
  'go to www.mangasite.net for raws',
  'type www mangasite into google',
  'w w w . mangasite . net',
  'WWW,mangasite',
  'mangadex.org has it translated',
  'shortened bit.ly/abc123 link',
  'join discord.gg/abcdef for spoilers',
  'my channel t.me/somechannel',
  'site.co.uk has it',
  'better on kissmanga.to honestly',
  'cheap at shop.xyz and deals.pk',
  'read on abc.in today',
  'NEWSITE.COM HAS IT',
  'mysite .com has it',
  'Visit my site: coolmanga . com',
  'mangasite dot com has it',
  'mangasite dotcom has it',
  'mangasite d0t net has it',
  'mangasite DOT org has it',
  'mangasite dot io has it',
  'mangasite(dot)com',
  'mangasite[.]com',
  'mangasite{dot}io',
  'mangasite [ dot ] xyz',
  'mangasite<.>net',
  'd.o.t c.o.m spelled out',
  'ｗｗｗ．ｓｉｔｅ．ｃｏｍ in full width',
  'goo​gle.com with a hidden space',
  'mangasite。com with a wide dot',
  'mangasite․com with a leader dot',
  'mangasite·com with a middle dot',
  'server at 192.168.1.1 is up',
  'xn--80ak6aa92e for the punycode crowd',
  '[click here](somewhere) for more',
  '[url=somewhere]free chapters[/url]',
  '<a href=x>free</a>',
  'href = somewhere',
  'mail me john@example for raws',
  'follow @mangaguy on everything',
  'mail me at john＠example',
  'john (at) mailbox for raws',
  'message my gmail for the scans',
]

test('the link rule catches links, addresses, handles and their disguises', () => {
  for (const text of LINKS) {
    const problem = linkProblem(text)
    assert.ok(problem, `should be refused: ${JSON.stringify(text)}`)
    assert.equal(typeof problem.reason, 'string')
    assert.ok(problem.found.length > 0 && problem.found.length <= 40)
  }
})

const PROSE = [
  GOOD_TEXT,
  'I loved it. In the end the hero wins and it feels earned.',
  'Solo Leveling is great. Me and my friends read it in one week.',
  'Dr. Stone vibes, 9.5/10, chapter 150 was wild.',
  'e.g. the art, i.e. the colours, etc. all great work.',
  'Re:Zero fans will like this one a lot.',
  'It was 4.5 out of 5 for me, mostly for the art.',
  'Awww the ending made me cry so much.',
  'The webtoon app version has better colours than print.',
  'Season 2. To be honest it dragged in the middle.',
  'A dot in the sky was the first clue, and it paid off.',
  'Mr. Kim is the best character in the whole story.',
  'vol.3 and ch.20 are the peaks of the series.',
  'The outlook for season two is good; the studio is solid.',
  'Netflix and Crunchyroll both have it, which is handy.',
  'The pacing is 10/10 and the fights are 9/10.',
  'Kaguya-sama.Love is war is the closest match I know.',
  'It is what it is: a fun read, nothing more.',
  'Not for everyone ... but I liked it a lot.',
  'Read this at 3 a.m. and could not sleep after.',
  'The co-op scenes in vol. 2 are great.',
  'Japanese title: 俺だけレベルアップな件。おすすめ！',
]

test('ordinary review prose passes the link rule', () => {
  for (const text of PROSE) assert.equal(linkProblem(text), null, `should pass: ${JSON.stringify(text)}`)
})

test('HTML is spotted, "<3" and "x < y" are not', () => {
  for (const text of ['<b>bold</b>', '</script>', '<!-- hi -->', '<?php', 'AT&amp;T', '&#60;', '&#x3c;']) {
    assert.equal(hasHtml(text), true, text)
  }
  for (const text of ['I <3 this', 'power x < y', 'Tom & Jerry', 'a > b']) assert.equal(hasHtml(text), false, text)
})

// ------------------------------------------------------------ the spam rule

test('spam shapes are refused, normal text is not', () => {
  assert.match(spamProblem('This is sooooooo good really good'), /repeated/)
  assert.match(spamProblem('great great great great story here'), /same word/)
  assert.match(spamProblem('THIS IS THE BEST MANHWA EVER WRITTEN'), /capitals/)
  assert.match(spamProblem('call me on 0300 1234567 for chapters'), /phone/)
  assert.match(spamProblem('+92 (300) 123-4567 now'), /phone/)
  assert.match(spamProblem('10/10 9/10 8/10 7/10 6/10 5/10'), /numbers/)
  assert.equal(spamProblem(GOOD_TEXT), null)
  assert.equal(spamProblem('The MC is OP but the side cast is great and the art is top.'), null)
  assert.equal(spamProblem('Chapters 1 to 150 are great, 151 onwards slow down.'), null)
})

// ------------------------------------------------------------ cleaning

test('text is kept tidy, names default to "A reader"', () => {
  assert.equal(cleanText('  a​ b\t\tc  \r\n\r\n\r\n\r\nd \u0007e '), 'a b c\n\nd e')
  assert.equal(cleanName(''), DEFAULT_NAME)
  assert.equal(cleanName('   '), DEFAULT_NAME)
  assert.equal(cleanName('  Sana \n Lee '), 'Sana Lee')
  assert.deepEqual(paragraphsOf('one\n\n\ntwo\nstill two\n\n'), ['one', 'two\nstill two'])
  assert.equal(reviewDate('2026-10-03T12:00:00Z'), '3 Oct 2026')
  assert.equal(reviewDate('2026-09-03T12:00:00Z'), '3 Sep 2026')
  assert.equal(reviewDate('nonsense'), '')
})

// ------------------------------------------------------------ checking a body

const review = (over = {}) => ({ kind: 'manhwa', slug: 'solo-leveling', text: GOOD_TEXT, token: 't', ...over })

test('a good review passes, with the defaults filled in', () => {
  const { value, error } = checkReview(review())
  assert.equal(error, undefined)
  assert.deepEqual(value, { kind: 'manhwa', slug: 'solo-leveling', name: DEFAULT_NAME, text: GOOD_TEXT, stars: null, token: 't' })
  assert.equal(checkReview(review({ name: 'Sana', stars: 4 })).value.stars, 4)
  assert.equal(checkReview(review({ stars: null })).value.stars, null)
  // A long review near the limit is fine.
  const long = Array.from({ length: 40 }, (_, i) => `Part ${i} of the story keeps its pace.`).join(' ').slice(0, MAX_TEXT)
  assert.equal(checkReview(review({ text: long })).error, undefined)
})

test('a review is refused, with the field named, when it breaks a rule', () => {
  const refused = [
    [review({ text: 'Too short to say much.' }), 'text', /at least 30/],
    [review({ text: 'Fine. '.repeat(260) + 'x' }), 'text', /under 1500/],
    [review({ text: `${GOOD_TEXT} <b>bold</b>` }), 'text', /HTML/],
    [review({ text: `${GOOD_TEXT} Read it on mangasite.com` }), 'text', /mangasite\.com/],
    [review({ text: `${GOOD_TEXT} sooooooooo good` }), 'text', /repeated/],
    [review({ name: 'visit mysite.net' }), 'name', /link/],
    [review({ name: '@reader' }), 'name', /handle/],
    [review({ name: 'x'.repeat(41) }), 'name', /40/],
    [review({ name: 7 }), 'name', /text/],
    [review({ stars: 6 }), 'stars', /1 to 5/],
    [review({ stars: '4' }), 'stars', /1 to 5/],
    [review({ stars: 2.5 }), 'stars', /1 to 5/],
  ]
  for (const [body, field, message] of refused) {
    const out = checkReview(body)
    assert.equal(out.value, undefined, JSON.stringify(body).slice(0, 80))
    assert.equal(out.field, field, JSON.stringify(body).slice(0, 80))
    assert.match(out.error, message)
  }
  assert.match(checkReview(review({ token: '' })).error, /check/)
  assert.match(checkReview(review({ extra: 1 })).error, /unknown field/)
  assert.match(checkReview(review({ kind: 'webtoon' })).error, /section/)
  assert.match(checkReview(review({ slug: '../etc' })).error, /title/)
  assert.match(checkReview(null).error, /object/)
  assert.match(checkReview([]).error, /object/)
})

test('a vote needs a title, 1-5 whole stars and a ticket or a pass', () => {
  const vote = (over) => checkVote({ kind: 'anime', slug: 'frieren', stars: 5, token: 't', ...over })
  assert.equal(vote({}).value.stars, 5)
  assert.equal(vote({ token: undefined, pass: 'p' }).value.pass, 'p')
  for (const stars of [0, 6, 2.5, '3', null]) assert.match(vote({ stars }).error, /1 to 5/)
  assert.match(vote({ token: undefined }).error, /check/)
  assert.match(vote({ token: 'x'.repeat(5000) }).error, /check/)
  assert.match(vote({ who: 1 }).error, /unknown field/)
})

test('an owner tap names approve or delete and a whole id', () => {
  assert.deepEqual(checkReviewTap({ op: 'approve', id: 3 }).value, { op: 'approve', id: 3 })
  assert.match(checkReviewTap({ op: 'publish', id: 3 }).error, /approve or delete/)
  assert.match(checkReviewTap({ op: 'delete', id: '3' }).error, /whole number/)
  assert.match(checkReviewTap({ op: 'delete', id: 0 }).error, /whole number/)
  assert.match(checkReviewTap({ op: 'delete', id: 3, x: 1 }).error, /unknown field/)
})

// ------------------------------------------------------------ the numbers

test('the average: one decimal, shown from 3 votes, marked up from 5', () => {
  assert.deepEqual(ratingOf({ votes: 3, total: 13 }), { votes: 3, avg: 4.3, show: true, schema: false })
  assert.deepEqual(ratingOf({ votes: 5, total: 21 }), { votes: 5, avg: 4.2, show: true, schema: true })
  assert.deepEqual(ratingOf({ votes: 2, total: 9 }), { votes: 2, avg: 4.5, show: false, schema: false })
  assert.equal(ratingOf({ votes: 8, total: 30 }).avg, 3.8) // 3.75 rounds up
  assert.equal(ratingOf({ votes: 4, total: 4 }).avg, 1)
  // A broken row prints nothing rather than an average nobody gave.
  for (const row of [null, undefined, {}, { votes: 0, total: 0 }, { votes: 2, total: 20 }, { votes: -1, total: 3 }, { votes: 'x', total: 4 }]) {
    assert.deepEqual(ratingOf(row), { votes: 0, avg: 0, show: false, schema: false })
  }
  assert.equal(ratingLine(ratingOf({ votes: 12, total: 50 })), '4.2 from 12 readers')
  assert.equal(ratingLine(ratingOf({ votes: 3, total: 15 })), '5.0 from 3 readers')
  assert.equal(ratingLine(ratingOf({ votes: 2, total: 8 })), 'A few ratings in. Add yours.')
  assert.equal(ratingLine(ratingOf(null)), 'Be the first to rate it.')
})

test('structured data: AggregateRating only from 5 votes, Review per approved review', () => {
  assert.equal(aggregateJsonld(ratingOf({ votes: 4, total: 16 })), null)
  assert.deepEqual(aggregateJsonld(ratingOf({ votes: 5, total: 21 })), {
    '@type': 'AggregateRating', ratingValue: '4.2', bestRating: '5', worstRating: '1', ratingCount: 5,
  })
  const out = reviewsJsonld([
    { name: 'Sana', body: 'Good.', stars: 4, created_at: '2026-10-01T10:00:00.000Z' },
    { name: '', body: 'Fine.', stars: null, created_at: '2026-10-02T10:00:00.000Z' },
  ])
  assert.deepEqual(out[0], {
    '@type': 'Review',
    author: { '@type': 'Person', name: 'Sana' },
    datePublished: '2026-10-01',
    reviewBody: 'Good.',
    reviewRating: { '@type': 'Rating', ratingValue: '4', bestRating: '5', worstRating: '1' },
  })
  // An unnamed review stays on the page but out of the markup.
  assert.equal(out.length, 1)
  assert.equal(reviewsJsonld([{ name: DEFAULT_NAME, body: 'Fine.' }]).length, 0)
  assert.equal('reviewRating' in reviewsJsonld([{ name: 'Ali', body: 'Fine.', stars: null }])[0], false)
  assert.deepEqual(reviewsJsonld(null), [])
})

// ------------------------------------------------------------ escaping

test('what passes the checks is still escaped on the way out', () => {
  const body = 'Tom & Jerry said "x < y" and \'<3\' about it, all in one go.'
  assert.equal(checkReview(review({ text: body })).error, undefined)
  // Astro's own escaper, the one every {value} in a .astro file goes through.
  const html = escapeHTML(body)
  assert.equal(html.includes('<'), false)
  assert.equal(html.includes('"'), false)
  assert.match(html, /&amp;/)
  // The structured data is serialised the way Base.astro does it, which
  // turns every "<" into <, so a review can never close the script tag.
  const json = JSON.stringify(reviewsJsonld([{ name: 'A', body: 'nice </script><script>x', stars: 3 }])).replace(/</g, '\\u003c')
  assert.equal(json.includes('</script>'), false)
  assert.equal(JSON.parse(json)[0].reviewBody, 'nice </script><script>x')
  // And the checks refuse that text before it is ever stored.
  assert.match(checkReview(review({ text: `${GOOD_TEXT} </script>` })).error, /HTML/)
})

// ------------------------------------------------------------ through the Worker

const SITE = 'https://manhwaindex.com'
const SECRET = 'correct horse battery staple'
const TITLES = [
  { kind: 'comic', id: 151, slug: 'solo-leveling', title: 'Solo Leveling', country: 'KR' },
  { kind: 'anime', id: 154587, slug: 'frieren', title: 'Frieren' },
]

// A stand-in for the ASSETS binding: every shard holds every test title, so
// whichever shard a slug hashes to, the record is there.
const shardText = '\n' + TITLES.map((t) => `${titleKey(t.kind === 'anime' ? 'anime' : 'manhwa', t.slug)}\t${JSON.stringify(t)}`).join('\n') + '\n'
const ASSETS = { fetch: async () => new Response(shardText) }

async function ownerCookie(word = SECRET) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`manhwaindex:${word}`))
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const world = () => {
  const db = analyticsD1()
  return { db, env: { ANALYTICS: db, ASSETS, PASS_KEY: 'k', TURNSTILE_SECRET: 's', ADMIN_SECRET: SECRET } }
}
const yes = async () => true
const no = async () => false

function post(path, body, headers = {}) {
  const all = {
    origin: SITE,
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json',
    'cf-connecting-ip': '203.0.113.7',
    'user-agent': 'TestBrowser/1',
    ...headers,
  }
  for (const [k, v] of Object.entries(all)) if (v === null) delete all[k]
  return new Request(`${SITE}${path}`, { method: 'POST', headers: all, body: typeof body === 'string' ? body : JSON.stringify(body) })
}

const NOW = Date.parse('2026-10-03T08:00:00Z')

test('votes: counted once per browser and address a day, totals kept in step', async () => {
  const { db, env } = world()
  const vote = (stars, headers) => post('/_vote', { kind: 'manhwa', slug: 'solo-leveling', stars, token: 't' }, headers)

  let res = await handleVote(vote(5), env, { now: NOW, verify: yes })
  assert.equal(res.status, 200)
  let out = await res.json()
  assert.equal(out.counted, true)
  assert.equal(out.line, 'A few ratings in. Add yours.')

  // The same browser on the same address that day: answered the same, not counted.
  out = await (await handleVote(vote(1), env, { now: NOW, verify: yes })).json()
  assert.equal(out.counted, false)
  assert.equal(out.votes, 1)

  await handleVote(vote(4, { 'user-agent': 'OtherBrowser/2' }), env, { now: NOW, verify: yes })
  out = await (await handleVote(vote(4, { 'cf-connecting-ip': '198.51.100.9' }), env, { now: NOW, verify: yes })).json()
  assert.deepEqual([out.votes, out.avg, out.line], [3, 4.3, '4.3 from 3 readers'])

  // The next day the same browser may vote again.
  out = await (await handleVote(vote(3), env, { now: NOW + 86400000, verify: yes })).json()
  assert.equal(out.counted, true)
  assert.equal(out.votes, 4)

  const row = db.raw.prepare('SELECT votes, total FROM rating_totals WHERE anilist_id = 151').get()
  assert.deepEqual({ ...row }, { votes: 4, total: 16 })
  // No address is kept: the voter column is a hash, never the IP itself.
  for (const v of db.raw.prepare('SELECT voter FROM rating_votes').all()) {
    assert.match(v.voter, /^[0-9a-f]{64}$/)
    assert.equal(v.voter.includes('203.0.113.7'), false)
  }
})

test('votes: the visit pass works, a dead pass or a failed check does not', async () => {
  const { db, env } = world()
  const dies = NOW + 10 * 60000
  const pass = `${dies}.${await sign('k', String(dies))}`
  const body = { kind: 'anime', slug: 'frieren', stars: 4, pass }
  assert.equal((await handleVote(post('/_vote', body), env, { now: NOW, verify: no })).status, 200)
  // The pass is checked by its signature, then by the clock.
  assert.equal((await handleVote(post('/_vote', { ...body, pass: `${dies}.bad` }), env, { now: NOW, verify: no })).status, 403)
  assert.equal((await handleVote(post('/_vote', body), env, { now: dies + 1, verify: no })).status, 403)
  // A dead pass with a good ticket still gets in.
  assert.equal((await handleVote(post('/_vote', { ...body, token: 't' }), env, { now: dies + 1, verify: yes })).status, 200)
  assert.equal((await handleVote(post('/_vote', { kind: 'anime', slug: 'frieren', stars: 4, token: 't' }), env, { now: NOW, verify: no })).status, 403)
  // Same browser, same address, same day: one vote, however it got in.
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM rating_votes').get().n, 1)
})

test('votes: wrong origin, wrong method, unknown or mismatched title, no database', async () => {
  const { db, env } = world()
  const body = { kind: 'manhwa', slug: 'solo-leveling', stars: 5, token: 't' }
  const opts = { now: NOW, verify: yes }
  assert.equal((await handleVote(post('/_vote', body, { origin: 'https://evil.example' }), env, opts)).status, 403)
  assert.equal((await handleVote(post('/_vote', body, { 'sec-fetch-site': 'cross-site' }), env, opts)).status, 403)
  assert.equal((await handleVote(post('/_vote', body, { 'content-type': 'text/plain' }), env, opts)).status, 403)
  assert.equal((await handleVote(new Request(`${SITE}/_vote`), env, opts)).status, 405)
  assert.equal((await handleVote(post('/_vote', 'not json'), env, opts)).status, 400)
  assert.equal((await handleVote(post('/_vote', { ...body, slug: 'no-such-title' }), env, opts)).status, 404)
  // A manhwa cannot be voted on through /manga/.
  assert.equal((await handleVote(post('/_vote', { ...body, kind: 'manga' }), env, opts)).status, 404)
  assert.equal((await handleVote(post('/_vote', body), { ...env, ANALYTICS: null }, opts)).status, 503)
  assert.equal((await handleVote(post('/_vote', body), { ...env, PASS_KEY: '' }, opts)).status, 503)
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM rating_votes').get().n, 0)
})

const reviewPost = (over = {}, headers) =>
  post('/_review', { kind: 'manhwa', slug: 'solo-leveling', name: 'Sana', text: GOOD_TEXT, stars: 5, token: 't', ...over }, headers)

const tap = async (body, headers = {}) =>
  post('/my-admin/api/review', body, { cookie: `mi_admin=${await ownerCookie()}`, ...headers })

test('reviews: pending until approved, then on the page; removed again on delete', async () => {
  const { db, env } = world()
  const res = await handleReview(reviewPost(), env, { now: NOW, verify: yes })
  assert.equal(res.status, 200)
  assert.match((await res.json()).message, /once it has been read/)

  // Saved, but not public.
  let page = await readTitleReviews(db, 151)
  assert.equal(page.ok, true)
  assert.deepEqual(page.reviews, [])
  const saved = db.raw.prepare('SELECT * FROM reviews').get()
  assert.equal(saved.status, 'pending')
  assert.equal(saved.title, 'Solo Leveling')
  assert.equal(saved.body, GOOD_TEXT)

  // A stranger cannot approve it.
  assert.equal((await handleReviewTap(await tap({ op: 'approve', id: saved.id }, { cookie: null }), env)).status, 401)
  assert.equal((await handleReviewTap(await tap({ op: 'approve', id: saved.id }, { origin: 'https://evil.example' }), env)).status, 403)

  const ok = await handleReviewTap(await tap({ op: 'approve', id: saved.id }), env, NOW + 1000)
  assert.equal(ok.status, 200)
  assert.match((await ok.json()).message, /Approved/)
  page = await readTitleReviews(db, 151)
  assert.equal(page.reviews.length, 1)
  assert.equal(page.reviews[0].name, 'Sana')
  assert.equal(page.reviews[0].stars, 5)

  assert.equal((await handleReviewTap(await tap({ op: 'delete', id: saved.id }), env)).status, 200)
  assert.deepEqual((await readTitleReviews(db, 151)).reviews, [])
  assert.equal((await handleReviewTap(await tap({ op: 'delete', id: saved.id }), env)).status, 404)

  const log = db.raw.prepare('SELECT action, anilist_id FROM admin_log ORDER BY id').all().map((r) => ({ ...r }))
  assert.deepEqual(log, [{ action: 'approve review', anilist_id: 151 }, { action: 'delete review', anilist_id: 151 }])
})

test('reviews: links and spam refused with the reason, three a day per address', async () => {
  const { db, env } = world()
  const opts = { now: NOW, verify: yes }
  let res = await handleReview(reviewPost({ text: `${GOOD_TEXT} Better scans at mangasite dot com.` }), env, opts)
  assert.equal(res.status, 400)
  let out = await res.json()
  assert.equal(out.field, 'text')
  assert.match(out.error, /No links/)
  assert.equal((await handleReview(reviewPost(), env, { now: NOW, verify: no })).status, 403)

  for (let i = 0; i < 3; i++) assert.equal((await handleReview(reviewPost(), env, opts)).status, 200)
  res = await handleReview(reviewPost(), env, opts)
  assert.equal(res.status, 429)
  // Another address, or the next day, is a fresh start.
  assert.equal((await handleReview(reviewPost({}, { 'cf-connecting-ip': '198.51.100.9' }), env, opts)).status, 200)
  assert.equal((await handleReview(reviewPost(), env, { now: NOW + 86400000, verify: yes })).status, 200)
  // Deleting a review does not hand its sender a fresh slot that day.
  db.raw.exec('DELETE FROM reviews')
  assert.equal((await handleReview(reviewPost(), env, opts)).status, 429)
})

test('the night job blanks hashes older than two days and nothing else', async () => {
  const { db, env } = world()
  const vote = post('/_vote', { kind: 'manhwa', slug: 'solo-leveling', stars: 5, token: 't' })
  await handleVote(vote, env, { now: NOW, verify: yes })
  await handleReview(reviewPost(), env, { now: NOW, verify: yes })
  await forgetSenders(db, NOW + 86400000)
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM rating_votes WHERE voter IS NOT NULL').get().n, 1)
  await forgetSenders(db, NOW + 3 * 86400000)
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM rating_votes WHERE voter IS NOT NULL').get().n, 0)
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM review_sends').get().n, 0)
  // The votes themselves and the totals stay.
  assert.equal(db.raw.prepare('SELECT votes FROM rating_totals').get().votes, 1)
  await forgetSenders(null)
})

test('the title page read gives up quickly and never throws', async () => {
  const stuck = { prepare: () => ({ bind: () => ({ first: () => new Promise(() => {}), all: () => new Promise(() => {}) }) }) }
  const started = Date.now()
  const late = await readTitleReviews(stuck, 151, 30)
  assert.equal(late.ok, false)
  assert.ok(Date.now() - started < 1000)
  const broken = { prepare: () => { throw new Error('no such table') } }
  assert.equal((await readTitleReviews(broken, 151)).ok, false)
  assert.equal((await readTitleReviews(null, 151)).ok, false)
  assert.equal((await readTitleReviews(analyticsD1(), 0)).ok, false)
  // An empty but working database is fine: ok, no numbers.
  const empty = await readTitleReviews(analyticsD1(), 151)
  assert.equal(empty.ok, true)
  assert.equal(empty.rating.votes, 0)
})
