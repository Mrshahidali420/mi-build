import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lvSetup, lvInit } from '../src/lib/linkvertise.js'

// Linkvertise's own matcher and rule (str_is and convert in linkvertise.js):
// a pattern with no "*" matches anywhere; the address loses one trailing "/";
// the blacklist is checked first, then the whitelist must match.
const matches = (pattern, url) => {
  const p = pattern.includes('*') ? pattern : `*${pattern}*`
  return new RegExp('^' + p.replace(/\*/g, '.*') + '$').test(url)
}
const rewritten = (cfg, href) => {
  const url = href.endsWith('/') ? href.slice(0, -1) : href
  return !cfg.blacklist.some((p) => matches(p, url)) && cfg.whitelist.some((p) => matches(p, url))
}

/** Runs lvSetup on a fake page: links are { href, go }. Returns the config, or null. */
function setUp(links, host = 'manhwaindex.com') {
  const anchors = links.map((l) => ({
    href: new URL(l.href).href,
    go: l.go,
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v },
  }))
  let cfg = null
  globalThis.location = { hostname: host }
  globalThis.document = { querySelectorAll: () => anchors.filter((a) => a.go === 'read' || a.go === 'watch') }
  globalThis.linkvertise = (id, opts) => { cfg = { id, ...opts } }
  lvSetup(10316435)
  return { cfg, anchors }
}

const page = [
  { href: 'https://www.webtoons.com/en/romance/x/list?title_no=1', go: 'read' },
  { href: 'http://www.hulu.com/cowboy-bebop', go: 'watch' },
  { href: 'https://www.crunchyroll.com/series/z/', go: 'watch' },
  { href: 'https://www.amazon.com/gp/video/detail/B00R2KO8ZE/', go: 'watch' },
  { href: 'https://www.webtoons.com/en/other/y/list?title_no=2' }, // not a platform button
  { href: 'https://www.amazon.com/dp/B0?tag=x' },
  { href: 'https://manhwaindex.com/manga/x' },
  { href: 'https://anilist.co/manga/1' },
]

test('only the read and watch links on the page are rewritten, http ones too', () => {
  const { cfg } = setUp(page)
  assert.equal(cfg.id, 10316435)
  assert.ok(rewritten(cfg, 'https://www.webtoons.com/en/romance/x/list?title_no=1'))
  assert.ok(rewritten(cfg, 'http://www.hulu.com/cowboy-bebop'))
  assert.ok(rewritten(cfg, 'https://www.crunchyroll.com/series/z/'))
})

test('Amazon, our own pages and other links on the same platform stay as they are', () => {
  const { cfg } = setUp(page)
  assert.ok(!rewritten(cfg, 'https://www.amazon.com/gp/video/detail/B00R2KO8ZE/'), 'Prime Video is Amazon')
  assert.ok(!rewritten(cfg, 'https://www.amazon.com/dp/B0?tag=x'))
  assert.ok(!rewritten(cfg, 'https://manhwaindex.com/manga/x'))
  assert.ok(!rewritten(cfg, 'https://anilist.co/manga/1'))
  assert.ok(!rewritten(cfg, 'https://www.webtoons.com/en/other/y/list?title_no=2'))
  assert.ok(!rewritten(cfg, 'https://www.webtoons.com/en/romance/x/list?title_no=10'), 'dots and ? are literal')
})

test('the real address is saved for the click counter', () => {
  const { anchors } = setUp(page)
  assert.equal(anchors[1].attrs['data-dest'], 'http://www.hulu.com/cowboy-bebop')
  assert.equal(anchors[3].attrs['data-dest'], undefined)
})

test('a page with no platform link never calls Linkvertise (an empty whitelist takes every link)', () => {
  assert.equal(setUp([{ href: 'https://www.amazon.com/dp/B0', go: 'watch' }]).cfg, null)
})

test('a platform link on our own domain is never sent', () => {
  const { cfg } = setUp([{ href: 'https://whereanime.com/anime/x', go: 'watch' }, { href: 'https://tapas.io/s', go: 'read' }], 'whereanime.com')
  assert.ok(!rewritten(cfg, 'https://whereanime.com/anime/x'))
})

test('the inline script calls the set-up with the account id', () => {
  assert.match(lvInit(), /^\(function lvSetup\(id\)[\s\S]*\)\(10316435\)$/)
})
