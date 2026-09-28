// A character's appearsIn row must carry the title's own kind ('novel' for a
// light or web novel, even though novels ride in comics.json), so
// src/lib/section.mjs builds /novel/<slug> instead of a dead /manga/<slug>
// or /manhwa/<slug> link. See src/lib/novel-appearance-kind.mjs for the
// post-load pass that reaches records ingested before this was fixed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sectionOf, pathOfTitle } from '../src/lib/section.mjs'
import { fixNovelAppearanceKind, fixNovelAppearanceKindsAll } from '../src/lib/novel-appearance-kind.mjs'

test('sectionOf/pathOfTitle: a novel-kind appearance row resolves to /novel/<slug>', () => {
  const row = { kind: 'novel', slug: 'invaders-of-the-rokujouma', country: 'JP' }
  assert.equal(sectionOf(row), 'novel')
  assert.equal(pathOfTitle(row), '/novel/invaders-of-the-rokujouma')
})

test('sectionOf/pathOfTitle: manga, manhwa, manhua and anime rows are unchanged', () => {
  assert.equal(pathOfTitle({ kind: 'comic', slug: 'a', country: 'JP' }), '/manga/a')
  assert.equal(pathOfTitle({ kind: 'comic', slug: 'b', country: 'KR' }), '/manhwa/b')
  assert.equal(pathOfTitle({ kind: 'comic', slug: 'c', country: 'CN' }), '/manhua/c')
  assert.equal(pathOfTitle({ kind: 'anime', slug: 'd' }), '/anime/d')
})

test('fixNovelAppearanceKind fixes an old row stuck at kind comic for a novel title', () => {
  const novelSlugs = new Set(['invaders-of-the-rokujouma'])
  const character = {
    slug: 'clariausa-dawra-fortorthe',
    appearsIn: [
      { kind: 'comic', slug: 'invaders-of-the-rokujouma', title: 'Invaders of the Rokujouma!?' },
    ],
  }
  const fixed = fixNovelAppearanceKind(character, novelSlugs)
  assert.equal(fixed.appearsIn[0].kind, 'novel')
  // Pure: the input is left untouched.
  assert.equal(character.appearsIn[0].kind, 'comic')
})

test('fixNovelAppearanceKind leaves manga, manhwa, manhua and anime rows alone', () => {
  const novelSlugs = new Set(['some-novel'])
  const character = {
    slug: 'someone',
    appearsIn: [
      { kind: 'comic', slug: 'a-manga', title: 'A' },
      { kind: 'anime', slug: 'a-show', title: 'B' },
    ],
  }
  const fixed = fixNovelAppearanceKind(character, novelSlugs)
  assert.equal(fixed, character) // nothing changed, same reference
  assert.equal(fixed.appearsIn[0].kind, 'comic')
  assert.equal(fixed.appearsIn[1].kind, 'anime')
})

test('fixNovelAppearanceKind returns the same reference when the character has no appearsIn', () => {
  const character = { slug: 'nobody', appearsIn: [] }
  const fixed = fixNovelAppearanceKind(character, new Set(['x']))
  assert.equal(fixed, character)
})

test('fixNovelAppearanceKindsAll fixes every affected record in an array in place', () => {
  const novelSlugs = new Set(['invaders-of-the-rokujouma'])
  const characters = [
    {
      slug: 'clariausa-dawra-fortorthe',
      appearsIn: [{ kind: 'comic', slug: 'invaders-of-the-rokujouma', title: 'Invaders' }],
    },
    {
      slug: 'unrelated',
      appearsIn: [{ kind: 'comic', slug: 'some-manhwa', title: 'Other' }],
    },
  ]
  fixNovelAppearanceKindsAll(characters, novelSlugs)
  assert.equal(characters[0].appearsIn[0].kind, 'novel')
  assert.equal(characters[1].appearsIn[0].kind, 'comic') // untouched record unaffected
})
