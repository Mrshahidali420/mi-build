import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isThinCharacter, isNoindexCharacter } from '../src/lib/character-facts.mjs'
import { withCastFacts, castContext } from '../src/lib/cast-facts.mjs'
import { leadLine, plainOf } from '../src/lib/cast-page.mjs'

const one = (extra = {}) => ({ slug: 'kim', description: '', appearsIn: [{ kind: 'comic', slug: 's', title: 'S' }], ...extra })

test('isThinCharacter: no bio, no voice, exactly one title', () => {
  assert.equal(isThinCharacter(one()), true)
  assert.equal(isThinCharacter(one({ description: '   \n ' })), true, 'whitespace is no bio')
  assert.equal(isThinCharacter(one({ description: 'A bio.' })), false)
  assert.equal(isThinCharacter(one({ appearsIn: [{ kind: 'anime', slug: 's', title: 'S', voice: 'V' }] })), false)
  assert.equal(isThinCharacter(one({ appearsIn: [{ kind: 'anime', slug: 's', title: 'S', voiceEn: 'E' }] })), false)
  assert.equal(isThinCharacter(one({ appearsIn: [{ slug: 'a', title: 'A' }, { slug: 'b', title: 'B' }] })), false)
  assert.equal(isThinCharacter({}), false, 'no appearance is not a page at all')
})

test('isNoindexCharacter: a page Google has shown stays indexed', () => {
  assert.equal(isNoindexCharacter(one()), true)
  assert.equal(isNoindexCharacter(one(), new Set(['/character/kim'])), false)
  assert.equal(isNoindexCharacter(one({ description: 'Bio' })), false)
})

test('data/index-keep.json holds character paths only', () => {
  const { paths } = JSON.parse(readFileSync('data/index-keep.json', 'utf8'))
  assert.ok(paths.length > 0)
  assert.ok(paths.every((p) => /^\/character\/[^/]+$/.test(p)))
})

test('a lead whose other titles share this name says their medium', () => {
  const item = {
    kind: 'manhwa', country: 'KR', slug: 'solo', title: 'Solo Leveling',
    characters: [{ slug: 'jin', name: 'Jin', role: 'MAIN', image: 'x' }, ...'abcde'.split('').map((s) => ({ slug: s, name: s, image: 'x' }))],
  }
  const people = [{ slug: 'jin', name: 'Jin', appearsIn: [
    { kind: 'comic', country: 'KR', slug: 'solo', title: 'Solo Leveling' },
    { kind: 'anime', slug: 'solo-a', title: 'Solo Leveling', popularity: 9 },
  ] }]
  const lead = withCastFacts(item, castContext(people)).characters[0]
  assert.equal(plainOf(leadLine(lead)), 'Jin: in 1 other title too, the anime Solo Leveling.')
})
