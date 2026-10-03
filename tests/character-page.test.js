import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  groupOf,
  roleWord,
  groupAppearances,
  voicesOf,
  rolePhrase,
  countPhrase,
  factsBelowHero,
} from '../src/lib/character-page.mjs'

const row = (kind, country, slug, extra = {}) => ({ kind, country, slug, title: slug, role: 'MAIN', ...extra })

test('groupOf puts every comic country in one comic group', () => {
  assert.equal(groupOf(row('anime', 'JP', 'a')), 'anime')
  assert.equal(groupOf(row('novel', 'JP', 'n')), 'novel')
  assert.equal(groupOf(row('comic', 'KR', 'w')), 'comic')
  assert.equal(groupOf(row('comic', 'JP', 'm')), 'comic')
  assert.equal(groupOf(row('comic', 'CN', 'h')), 'comic')
})

test('roleWord is plain small text, never a shouted badge', () => {
  assert.equal(roleWord('MAIN'), 'Main')
  assert.equal(roleWord('SUPPORTING'), 'Supporting')
  assert.equal(roleWord('BACKGROUND'), 'Appears')
  assert.equal(roleWord(undefined), 'Appears')
})

test('groupAppearances orders anime, comic, novel and keeps record order inside', () => {
  const rows = [row('novel', 'JP', 'n1'), row('comic', 'JP', 'm1'), row('anime', 'JP', 'a1'), row('anime', 'JP', 'a2')]
  const groups = groupAppearances(rows)
  assert.deepEqual(groups.map((g) => g.key), ['anime', 'comic', 'novel'])
  assert.deepEqual(groups[0].rows.map((r) => r.slug), ['a1', 'a2'])
  assert.equal(groups[1].label, 'Manga')
  assert.equal(groups[2].label, 'Novels')
})

test('groupAppearances names a mixed comic group "Comics"', () => {
  const groups = groupAppearances([row('comic', 'KR', 'w'), row('comic', 'JP', 'm')])
  assert.equal(groups[0].label, 'Comics')
  assert.equal(groupAppearances([row('comic', 'KR', 'w')])[0].label, 'Manhwa')
})

test('groupAppearances shows six and folds the rest, losing none', () => {
  const rows = Array.from({ length: 9 }, (_, i) => row('anime', 'JP', `a${i}`))
  const [g] = groupAppearances(rows)
  assert.equal(g.shown.length, 6)
  assert.equal(g.folded.length, 3)
  assert.deepEqual([...g.shown, ...g.folded].map((r) => r.slug), rows.map((r) => r.slug))
  assert.equal(groupAppearances([]).length, 0)
})

test('voicesOf names Japanese then English, and one person once', () => {
  const rows = [
    row('comic', 'JP', 'm'),
    row('anime', 'JP', 'a', { voice: 'Miho Okasaki', voiceWhere: 'miho-okasaki' }),
    row('anime', 'JP', 'b', { voiceEn: 'Brittney Karbowski' }),
  ]
  assert.deepEqual(voicesOf(rows), [
    { name: 'Miho Okasaki', lang: 'Japanese', where: 'miho-okasaki' },
    { name: 'Brittney Karbowski', lang: 'English', where: '' },
  ])
  assert.deepEqual(voicesOf([row('anime', 'JP', 'a', { voice: 'X', voiceEn: 'X' })]).length, 1)
  assert.deepEqual(voicesOf([row('comic', 'KR', 'w')]), [])
})

test('rolePhrase and countPhrase read as plain English', () => {
  assert.equal(rolePhrase('MAIN'), 'Main character in')
  assert.equal(rolePhrase('SUPPORTING'), 'Supporting character in')
  assert.equal(rolePhrase('BACKGROUND'), 'Character in')
  assert.equal(countPhrase(1), 'Appears in 1 title')
  assert.equal(countPhrase(9), 'Appears in 9 titles')
})

test('factsBelowHero drops only the rows the hero line already says', () => {
  const facts = [
    ['Age', '17'],
    ['Japanese voice', 'A'],
    ['English voice', 'B'],
    ['From', 'Story'],
    ['Made by', 'C'],
    ['Appears in', '3 titles'],
    ['AniList favourites', '10'],
  ]
  assert.deepEqual(factsBelowHero(facts), [['Age', '17'], ['Made by', 'C'], ['AniList favourites', '10']])
})

test('faqBio keeps a short bio whole', async () => {
  const { faqBio } = await import('../src/lib/character-page.mjs')
  assert.equal(faqBio('He is a hunter. He shares a close relationship with his sister.'), 'He is a hunter. He shares a close relationship with his sister.')
  assert.equal(faqBio(''), '')
})

test('faqBio cuts a long bio on a whole sentence, never with an ellipsis', async () => {
  const { faqBio } = await import('../src/lib/character-page.mjs')
  const bio = 'First sentence here. Second one is a bit longer than that. Third sentence runs on and on.'
  assert.equal(faqBio(bio, 60), 'First sentence here. Second one is a bit longer than that.')
  assert.equal(faqBio(bio, 10), 'First sentence here.')
  assert.ok(!faqBio(bio, 30).endsWith('…'))
  assert.equal(faqBio('No full stop at all and very long', 5), 'No full stop at all and very long')
})
