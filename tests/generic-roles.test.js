// Generic role records ("Narrator") shared by many unrelated stories are taken
// out of cast lists; a story's own narrator stays (src/lib/generic-roles.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isGenericRole, genericRoleSlugs, withoutGenericCast, GENERIC_MIN_TITLES } from '../src/lib/generic-roles.mjs'

const person = (slug, name, appearances) => ({
  slug,
  name,
  appearsIn: Array.from({ length: appearances }, (_, i) => ({ slug: `t${i}` })),
})

test('the shared Narrator record is generic', () => {
  assert.equal(isGenericRole(person('narrator', 'Narrator', 586)), true)
  assert.equal(isGenericRole(person('narration', ' narration ', GENERIC_MIN_TITLES)), true)
})

test('a narrator that belongs to one story is a real cast row', () => {
  assert.equal(isGenericRole(person('narrator-42659', 'Narrator', 1)), false)
  assert.equal(isGenericRole(person('narrator-10161', 'Narrator', GENERIC_MIN_TITLES - 1)), false)
})

test('a real character in many titles is never generic', () => {
  assert.equal(isGenericRole(person('pikachu', 'Pikachu', 109)), false)
  assert.equal(isGenericRole(person('tv-narrator', 'TV Narrator', 40)), false)
  assert.equal(isGenericRole(null), false)
  assert.equal(isGenericRole({ name: 'Narrator' }), false)
})

test('genericRoleSlugs lists only the generic ones', () => {
  const slugs = genericRoleSlugs([person('narrator', 'Narrator', 586), person('narrator-2', 'Narrator', 2), person('conan', 'Conan Edogawa', 79)])
  assert.deepEqual([...slugs], ['narrator'])
  assert.equal(genericRoleSlugs(undefined).size, 0)
})

test('withoutGenericCast drops the row and leaves the title untouched', () => {
  const item = { slug: 'a', characters: [{ slug: 'hero' }, { slug: 'narrator' }] }
  const next = withoutGenericCast(item, new Set(['narrator']))
  assert.deepEqual(next.characters, [{ slug: 'hero' }])
  assert.equal(item.characters.length, 2)
})

test('withoutGenericCast returns the same record when nothing goes', () => {
  const item = { slug: 'a', characters: [{ slug: 'hero' }] }
  assert.equal(withoutGenericCast(item, new Set(['narrator'])), item)
  assert.equal(withoutGenericCast(item, new Set()), item)
  const bare = { slug: 'b' }
  assert.equal(withoutGenericCast(bare, new Set(['narrator'])), bare)
})
