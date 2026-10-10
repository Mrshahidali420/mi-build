import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildOverview } from '../src/lib/prose.mjs'

const comic = (extra) => ({ title: 'Yakuza Lover', kind: 'manga', format: 'MANGA', ...extra })
const text = (item) => JSON.stringify(buildOverview(item, 'manga', () => '', null))

test('an empty adaptation list does not claim an anime exists', () => {
  assert.doesNotMatch(text(comic({ animeInIndex: [], hasAnime: false })), /anime version/)
})

test('a listed adaptation still says it has its own page', () => {
  const t = text(comic({ animeInIndex: [{ slug: 'x', title: 'X' }] }))
  assert.match(t, /There is an anime version of (it|Yakuza Lover), with its own page here\./)
})
