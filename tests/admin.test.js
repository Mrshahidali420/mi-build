// The plain-English helpers in src/lib/admin.js: reading a search query back
// out of an outbound link's own address, and picking a click-feed filter
// chip from the URL. Both are pure — no database, no Astro.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLICK_FILTERS, clickFilterOf, searchTarget, adminClock, adminDateTime, pktHourLabel } from '../src/lib/admin.js'

test('searchTarget reads a Google search straight off the link', () => {
  const out = searchTarget('https://www.google.com/search?q=The%20Berserker%20NPC')
  assert.deepEqual(out, { service: 'Google', query: 'The Berserker NPC' })
  // The bare domain works the same as the www one.
  assert.equal(searchTarget('https://google.com/search?q=hi').service, 'Google')
})

test('searchTarget reads a YouTube or Spotify song search', () => {
  assert.deepEqual(
    searchTarget('https://www.youtube.com/results?search_query=Solo%20Leveling%20OP1'),
    { service: 'YouTube', query: 'Solo Leveling OP1' }
  )
  assert.deepEqual(
    searchTarget('https://open.spotify.com/search/Ali%20(ru)'),
    { service: 'Spotify', query: 'Ali (ru)' }
  )
})

test('searchTarget gives back nothing for an ordinary link, or Amazon', () => {
  assert.equal(searchTarget('https://www.crunchyroll.com/series/solo-leveling'), null)
  assert.equal(searchTarget('https://www.amazon.com/s?k=solo+leveling&tag=x'), null)
  assert.equal(searchTarget('https://www.google.com/maps?q=tokyo'), null, 'a Google page that is not /search')
  assert.equal(searchTarget(''), null)
  assert.equal(searchTarget('not a url'), null)
})

test('clickFilterOf reads the chip from ?clicks=, and falls back to All', () => {
  assert.equal(clickFilterOf(new URL('https://x/my-admin?clicks=buy')).key, 'buy')
  assert.equal(clickFilterOf(new URL('https://x/my-admin?clicks=watch')).label, 'Watch')
  assert.equal(clickFilterOf(new URL('https://x/my-admin')).key, '')
  assert.equal(clickFilterOf(new URL('https://x/my-admin?clicks=nonsense')).key, '', 'an unknown kind is not a filter')
})

// The reading room at /my-admin is read from Pakistan, so every clock face
// it draws speaks Pakistan time (UTC+5, no daylight saving) even though the
// timestamps themselves are stored in UTC.
test('adminClock says a UTC timestamp in Pakistan time', () => {
  assert.equal(adminClock(Date.UTC(2026, 0, 1, 7, 8)), '12:08 PKT')
  // Crossing into the next day: 20:30 UTC is 01:30 PKT the next calendar day.
  assert.equal(adminClock(Date.UTC(2026, 0, 1, 20, 30)), '01:30 PKT')
  assert.equal(adminClock(Date.UTC(2026, 0, 1, 0, 0)), '05:00 PKT')
})

test('adminDateTime carries the day along with the Pakistan-time clock', () => {
  const out = adminDateTime(Date.UTC(2026, 0, 1, 20, 30))
  assert.match(out, /^2 Jan 01:30 PKT$/)
})

test('pktHourLabel turns a stored UTC hour bucket into its Pakistan-time label', () => {
  assert.equal(pktHourLabel(0), '05:00')
  assert.equal(pktHourLabel(19), '00:00')
  assert.equal(pktHourLabel(23), '04:00')
})

test('CLICK_FILTERS names exactly the kinds the kind column ever holds, plus All', () => {
  assert.deepEqual(CLICK_FILTERS.map((f) => f.key), ['', 'buy', 'read', 'watch', 'other'])
})
