import { test } from 'node:test'
import assert from 'node:assert/strict'
import { englishAlias, noLinkTitle, noLinkDescription, DESCRIPTION_MAX, META_TEST } from '../src/lib/title-meta.mjs'

test('englishAlias: an English synonym, never a romanised one or the title itself', () => {
  assert.equal(englishAlias({ title: 'Cool na Eikoku', synonyms: ['A Cool British Beautiful Girl Apparently Wants To Homestay With Me'] }),
    'A Cool British Beautiful Girl Apparently Wants To Homestay With Me')
  assert.equal(englishAlias({ title: 'Lens no Mukou', synonyms: ['Renzu no Mukou', 'Through Eyeglasses Darkly'] }), 'Through Eyeglasses Darkly')
  assert.equal(englishAlias({ title: 'Black Swan', synonyms: ['黒鳥', 'black swan'] }), '')
  assert.equal(englishAlias({ title: 'X', synonyms: [] }), '')
})

test('noLinkTitle: honest about the release, English name in brackets', () => {
  assert.equal(noLinkTitle({ title: 'Mame to Mugi', synonyms: [] }, 'manga'), 'Mame to Mugi Manga: English Release Status & Chapters')
  assert.equal(noLinkTitle({ title: 'Lens no Mukou', synonyms: ['Through Eyeglasses Darkly'] }, 'manga'),
    'Lens no Mukou (Through Eyeglasses Darkly) Manga: English Release Status & Chapters')
  assert.doesNotMatch(noLinkTitle({ title: 'T' }, 'manga'), /Official|Read .* Online/)
})

test('noLinkDescription: whole sentences within the limit, a title ending in ! stays whole', () => {
  const lede = 'Ore wa Benkyou ga Shitai dake nanoni!, a Japanese comedy and romance manga, has been coming out since 2026, so far with no official English edition that we list. Shunpei Morita both writes and draws it.'
  const d = noLinkDescription(lede)
  assert.ok(d.startsWith('Ore wa Benkyou ga Shitai dake nanoni!, a Japanese'))
  assert.ok(d.length <= DESCRIPTION_MAX)
  assert.ok(d.endsWith('…'), 'a first sentence over the limit is cut at a word end')
  const short = noLinkDescription('Black Swan ended in 1995. Ryouko Yamagishi drew it. It sits on 97 lists.')
  assert.equal(short, 'Black Swan ended in 1995. Ryouko Yamagishi drew it. It sits on 97 lists.')
  const long = noLinkDescription('word '.repeat(60).trim() + '.')
  assert.ok(long.length <= DESCRIPTION_MAX && long.endsWith('…'))
  assert.equal(noLinkDescription(''), '')
})

test('the test list holds kind/slug paths only', () => {
  for (const path of META_TEST) assert.match(path, /^(manga|manhwa|manhua|novel)\/[a-z0-9-]+$/)
})
