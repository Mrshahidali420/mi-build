// The plain-English helpers in src/lib/admin.js: reading a search query back
// out of an outbound link's own address, and picking a click-feed filter
// chip from the URL. Both are pure — no database, no Astro.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CLICK_FILTERS,
  clickFilterOf,
  searchTarget,
  adminClock,
  adminDateTime,
  pktHourLabel,
  pktDayLabel,
  groupByPktDay,
} from '../src/lib/admin.js'

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
// timestamps themselves are stored in UTC. Clocks are always 12-hour with
// am/pm: 13:26 -> "1:26 pm", 00:34 -> "12:34 am", 12:00 -> "12:00 pm".
test('adminClock says a UTC timestamp in Pakistan time, 12-hour with am/pm', () => {
  // 07:08 UTC is 12:08 PKT (13:26 style: afternoon, no leading zero).
  assert.equal(adminClock(Date.UTC(2026, 0, 1, 7, 8)), '12:08 pm PKT')
  // 08:26 UTC is 13:26 PKT -> "1:26 pm".
  assert.equal(adminClock(Date.UTC(2026, 0, 1, 8, 26)), '1:26 pm PKT')
  // Crossing into the next day: 20:30 UTC is 01:30 PKT the next calendar day.
  assert.equal(adminClock(Date.UTC(2026, 0, 1, 20, 30)), '1:30 am PKT')
  // 19:34 UTC on one day is 00:34 PKT the next day -> "12:34 am".
  assert.equal(adminClock(Date.UTC(2026, 0, 1, 19, 34)), '12:34 am PKT')
  // 07:00 UTC is 12:00 PKT (noon) -> "12:00 pm", not "0:00 pm".
  assert.equal(adminClock(Date.UTC(2026, 0, 1, 7, 0)), '12:00 pm PKT')
  // 19:00 UTC is 00:00 PKT (midnight) -> "12:00 am".
  assert.equal(adminClock(Date.UTC(2026, 0, 1, 19, 0)), '12:00 am PKT')
})

test('adminDateTime carries the day along with the 12-hour Pakistan-time clock', () => {
  const out = adminDateTime(Date.UTC(2026, 0, 1, 20, 30))
  assert.equal(out, '2 Jan 1:30 am PKT')
})

test('pktHourLabel turns a stored UTC hour bucket into its 12-hour Pakistan-time label', () => {
  assert.equal(pktHourLabel(0), '5 am')
  assert.equal(pktHourLabel(19), '12 am')
  assert.equal(pktHourLabel(23), '4 am')
  assert.equal(pktHourLabel(7), '12 pm')
})

test('pktDayLabel names today, yesterday, or the weekday, in Pakistan time', () => {
  // "Now" is 28 Sep 2026, 13:00 PKT (08:00 UTC).
  const now = Date.UTC(2026, 8, 28, 8, 0)
  // Same PKT day as now: 28 Sep, 09:26 PKT (04:26 UTC).
  assert.equal(pktDayLabel(Date.UTC(2026, 8, 28, 4, 26), now), 'Today, 28 Sep')
  // Yesterday in PKT: 27 Sep, 23:09 PKT (18:09 UTC).
  assert.equal(pktDayLabel(Date.UTC(2026, 8, 27, 18, 9), now), 'Yesterday, 27 Sep')
  // A row at 20:30 UTC on 27 Sep is 01:30 PKT on 28 Sep: today, not yesterday.
  assert.equal(pktDayLabel(Date.UTC(2026, 8, 27, 20, 30), now), 'Today, 28 Sep')
  // Older still: 26 Sep 2026 is a Saturday in Pakistan.
  assert.equal(pktDayLabel(Date.UTC(2026, 8, 26, 10, 0), now), 'Sat, 26 Sep')
})

test('groupByPktDay groups a newest-first feed under PKT day headers, never merging two days', () => {
  const now = Date.UTC(2026, 8, 28, 8, 0) // 28 Sep, 13:00 PKT
  const rows = [
    { ts: Date.UTC(2026, 8, 28, 8, 26) }, // 13:26 PKT today
    { ts: Date.UTC(2026, 8, 28, 8, 25) }, // 13:25 PKT today
    { ts: Date.UTC(2026, 8, 27, 20, 30) }, // 01:30 PKT today (crosses UTC midnight)
    { ts: Date.UTC(2026, 8, 27, 18, 9) }, // 23:09 PKT yesterday
    { ts: Date.UTC(2026, 8, 26, 10, 0) }, // 15:00 PKT, Sat 26 Sep
  ]
  const groups = groupByPktDay(rows, now)
  assert.deepEqual(groups.map((g) => g.label), ['Today, 28 Sep', 'Yesterday, 27 Sep', 'Sat, 26 Sep'])
  assert.equal(groups[0].rows.length, 3)
  assert.equal(groups[1].rows.length, 1)
  assert.equal(groups[2].rows.length, 1)
})

test('CLICK_FILTERS names exactly the kinds the kind column ever holds, plus All', () => {
  assert.deepEqual(CLICK_FILTERS.map((f) => f.key), ['', 'buy', 'read', 'watch', 'other'])
})
