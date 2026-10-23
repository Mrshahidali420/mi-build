import { test } from 'node:test'
import assert from 'node:assert/strict'
import { platformHosts, initScript } from '../scripts/make-linkvertise.mjs'

// Linkvertise's own matcher (str_is in linkvertise.js): no "*" means "anywhere".
const matches = (pattern, url) => {
  const p = pattern.includes('*') ? pattern : `*${pattern}*`
  return new RegExp('^' + p.replace(/\*/g, '.*') + '$').test(url)
}
// Linkvertise's rule: blacklist first, then the whitelist must match.
const rewritten = (cfg, url) => !cfg.blacklist.some((p) => matches(p, url)) && cfg.whitelist.some((p) => matches(p, url))
const cfgOf = (script) => {
  const m = script.match(/linkvertise\(\d+, (\{.*\})\)/)
  const obj = m[1].replace(/(whitelist|blacklist):/g, '"$1":')
  return JSON.parse(obj)
}

const titles = [
  { readLinks: [{ url: 'https://www.webtoons.com/en/x' }, { url: 'https://www.amazon.com/dp/B0' }, { url: 'https://tapas.io/series/y' }] },
  { watchLinks: [{ url: 'https://www.crunchyroll.com/series/z' }, { url: 'https://www.amazon.co.jp/x' }] },
]

test('platform hosts: every read and watch host, Amazon never', () => {
  assert.deepEqual(platformHosts(titles), ['crunchyroll.com', 'tapas.io', 'webtoons.com'])
})

test('platform links are rewritten; Amazon, AniList and our own pages are not', () => {
  const cfg = cfgOf(initScript(platformHosts(titles)))
  assert.ok(rewritten(cfg, 'https://www.webtoons.com/en/romance/x/list?title_no=1'))
  assert.ok(rewritten(cfg, 'https://tapas.io'))
  assert.ok(rewritten(cfg, 'https://www.crunchyroll.com/series/z'))
  assert.ok(!rewritten(cfg, 'https://www.amazon.com/s?k=tapas.io+webtoons.com'), 'Amazon even when a platform name is in the search')
  assert.ok(!rewritten(cfg, 'https://www.amazon.co.uk/dp/B0?tag=x'))
  assert.ok(!rewritten(cfg, 'https://amzn.to/abc'))
  assert.ok(!rewritten(cfg, 'https://anilist.co/manga/1'))
  assert.ok(!rewritten(cfg, 'https://manhwaindex.com/manga/x'))
})

test('no hosts means Linkvertise is never called (an empty whitelist would take every link)', () => {
  assert.doesNotMatch(initScript([]), /linkvertise\(/)
})

test('the real address is saved before the rewrite', () => {
  assert.match(initScript(['tapas.io']), /data-dest/)
})
