/**
 * Fill in the thin character records.
 *
 * Every title page links to its cast. A character record is built from that
 * link when we hold nothing better, and such a record carries only a name, a
 * face and the list of titles the person is in. That is a real page, but a
 * bare one, and search sends us traffic for exactly these names.
 *
 * This job asks AniList for the rest: the native spelling, the other spellings
 * people search by, the bio, the age, the gender and the favourite count. It
 * takes a slice per run so a daily deploy is never held up, and it keeps its
 * place in data/characters.json itself: a record with a description is done.
 *
 *   node scripts/enrich-characters.mjs [howMany]
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { gql, sleep, cutBio, DATA_DIR, REQUEST_DELAY_MS, writeJsonAtomic } from './anilist-core.mjs'

// AniList takes 50 ids in one call and allows 30 calls a minute.
const PER_CALL = 50
// One slice. 3,000 is 60 calls, about three minutes, and it never threatens
// the deploy timeout. Raise it on a manual run.
const DEFAULT_LIMIT = 3000

const QUERY = `query ($ids: [Int]) {
  Page(perPage: 50) {
    characters(id_in: $ids) {
      id
      name { full native alternative }
      image { large }
      gender
      age
      bloodType
      favourites
      dateOfBirth { month day }
      description(asHtml: false)
    }
  }
}`

const file = join(DATA_DIR, 'characters.json')
const people = JSON.parse(readFileSync(file, 'utf8'))

// Every slug ends in the AniList id, so a record saved before we started
// keeping the id separately can still be looked up.
const idOf = (p) => p.id ?? (Number(String(p.slug || '').match(/-(\d+)$/)?.[1]) || null)

// A record with a bio has already been through here, or arrived complete with
// its title. Anything else is thin and worth one call.
const thin = people.filter((p) => idOf(p) != null && !p.description)
const limit = Number(process.argv[2]) || DEFAULT_LIMIT
const todo = thin.slice(0, limit)

console.log(`${people.length} characters, ${thin.length} thin. Filling ${todo.length} this run.`)
if (!todo.length) process.exit(0)

const byId = new Map(people.map((p) => [idOf(p), p]))
let filled = 0

// Each failed batch costs about 3 minutes of retries. When AniList refuses the
// runner outright (HTTP 403 on 21 Oct 2026), every batch fails, and 60 of them
// held the deploy queue for 3 hours. Two failures in a row means stop.
const MAX_FAILS_IN_A_ROW = 2
let failsInARow = 0

for (let i = 0; i < todo.length; i += PER_CALL) {
  const ids = todo.slice(i, i + PER_CALL).map(idOf)
  let data
  try {
    data = await gql(QUERY, { ids })
    failsInARow = 0
  } catch (error) {
    // A bad slice must not throw away the slices that already worked.
    failsInARow++
    if (failsInARow >= MAX_FAILS_IN_A_ROW) {
      console.warn(`  batch at ${i} failed (${error.message}). ${failsInARow} in a row, stopping this run.`)
      break
    }
    console.warn(`  batch at ${i} failed (${error.message}). Skipping it.`)
    await sleep(REQUEST_DELAY_MS)
    continue
  }

  for (const node of data?.Page?.characters || []) {
    const person = byId.get(node.id)
    if (!person) continue
    person.id = node.id
    person.native = node.name?.native || null
    person.aliases = (node.name?.alternative || []).filter(Boolean).slice(0, 3)
    person.gender = node.gender || null
    person.age = node.age || null
    person.birthday = node.dateOfBirth?.month
      ? node.dateOfBirth.month + '/' + node.dateOfBirth.day
      : null
    person.bloodType = node.bloodType || null
    person.favourites = node.favourites ?? 0
    // Keep the face we already have if AniList hands back nothing.
    person.image = node.image?.large || person.image
    person.description = cutBio((node.description || '').replace(/<[^>]+>/g, '').trim())
    if (person.description) filled++
  }

  const done = Math.min(i + PER_CALL, todo.length)
  if (done % 500 === 0 || done === todo.length) console.log(`  ${done}/${todo.length}`)
  await sleep(REQUEST_DELAY_MS)
}

// Atomic: a run killed here must leave the old whole file, not half a catalog.
writeJsonAtomic(file, people)
console.log(`Done. ${filled} characters gained a bio. ${thin.length - filled} still thin.`)
