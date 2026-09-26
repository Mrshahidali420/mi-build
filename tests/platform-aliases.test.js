// Kodansha USA (and any future site name spelled differently from a platform
// we already allow) must count as the platform it really is, both for a
// title ingested from now on (scripts/anilist-core.mjs) and for one already
// sitting in data/comics.json, which the ingest will never refetch just to
// pick up a naming fix (see src/lib/catalog.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalSite, migrateAliasedLinks, migrateAliasedLinksAll } from '../src/lib/platform-aliases.mjs'
import { shape } from '../scripts/anilist-core.mjs'

test('canonicalSite maps Kodansha USA to Kodansha and leaves other names alone', () => {
  assert.equal(canonicalSite('Kodansha USA'), 'Kodansha')
  assert.equal(canonicalSite('Yen Press'), 'Yen Press')
  assert.equal(canonicalSite('Seven Seas Entertainment'), 'Seven Seas Entertainment')
  assert.equal(canonicalSite('WEBTOON'), 'WEBTOON')
})

test('ingesting a title today puts a Kodansha USA link straight into readLinks as Kodansha', () => {
  const media = {
    id: 1,
    title: { english: 'Attack on Titan', romaji: null, native: null },
    externalLinks: [{ site: 'Kodansha USA', url: 'https://kodansha.us/series/attack-on-titan/', type: 'INFO' }],
  }
  const record = shape(media, 'comic')
  assert.deepEqual(record.readLinks, [
    { site: 'Kodansha', url: 'https://kodansha.us/series/attack-on-titan/', language: null },
  ])
  assert.equal(record.otherLinks.length, 0)
})

test('a record with only a Kodansha USA link gets a Kodansha read link and no longer says unlicensed', () => {
  const item = {
    id: 2,
    kind: 'manga',
    readLinks: [],
    otherLinks: [{ site: 'Kodansha USA', url: 'https://kodansha.us/series/vinland-saga/', type: 'INFO' }],
  }
  const migrated = migrateAliasedLinks(item)
  assert.equal(migrated.readLinks.length, 1)
  assert.deepEqual(migrated.readLinks[0], {
    site: 'Kodansha',
    url: 'https://kodansha.us/series/vinland-saga/',
    language: null,
  })
  assert.equal(migrated.otherLinks.length, 0)
  // links.length (readLinks.length) drives the "no official English
  // publisher yet" copy on the title page; it must no longer be zero.
  assert.notEqual(migrated.readLinks.length, 0)
})

test('a record already carrying a Kodansha link is not given a duplicate', () => {
  const item = {
    id: 3,
    readLinks: [{ site: 'Kodansha', url: 'https://kodansha.us/series/blue-lock/', language: null }],
    otherLinks: [{ site: 'Kodansha USA', url: 'https://kodansha.us/series/blue-lock/', type: 'INFO' }],
  }
  const migrated = migrateAliasedLinks(item)
  // Nothing new to add, so the record comes back untouched (same reference).
  assert.equal(migrated, item)
  assert.equal(migrated.readLinks.length, 1)
})

test('a record with no aliased link is returned untouched (same reference)', () => {
  const item = { id: 4, readLinks: [], otherLinks: [{ site: 'Some Blog', url: 'https://example.com', type: 'INFO' }] }
  const migrated = migrateAliasedLinks(item)
  assert.equal(migrated, item)
})

test('migrateAliasedLinksAll fixes every affected record in an array', () => {
  const items = [
    { id: 5, readLinks: [], otherLinks: [{ site: 'Kodansha USA', url: 'https://kodansha.us/a/' }] },
    { id: 6, readLinks: [{ site: 'WEBTOON', url: 'https://webtoons.com/b', language: 'English' }], otherLinks: [] },
  ]
  migrateAliasedLinksAll(items)
  assert.equal(items[0].readLinks.length, 1)
  assert.equal(items[0].readLinks[0].site, 'Kodansha')
  assert.equal(items[1].readLinks.length, 1) // untouched record unaffected
})
