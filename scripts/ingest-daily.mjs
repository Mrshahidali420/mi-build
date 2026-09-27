#!/usr/bin/env node
/**
 * DAILY REFRESH. This is the one GitHub Actions runs every night.
 *
 * It never re-downloads a title we already have. It works in two phases:
 *
 *   PHASE 1 - PROBE (cheap)
 *     Ask AniList for "id + updatedAt" only, newest edits first, and newest
 *     ids first. 50 rows per call, two small fields. Compare each row with
 *     data/seen.json. Stop the sweep as soon as we reach rows we already
 *     match. Most days this is 4 to 10 calls.
 *
 *   PHASE 2 - FETCH (targeted)
 *     Download the full record ONLY for the ids phase 1 marked as changed or
 *     new, 50 ids per call. If nothing changed, this phase costs zero calls.
 *
 * It builds on data/comics.json, data/anime.json and data/characters.json,
 * so it never needs the big raw dump from the full backfill.
 *
 * Run it:
 *   npm run ingest:daily
 *
 * Options (environment variables):
 *   MAX_CALLS=240      hard ceiling on API calls (default 240)
 *   MAX_PROBE_PAGES=40 how deep a probe sweep may go before it gives up
 *
 * data/keep.json lists ids that are fetched every night no matter what the
 * probe says, and so do the ids kept from the /my-admin Search tab (D1). See
 * scripts/keep-list.mjs.
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DATA_DIR, RAW_DIR, IDS_PER_CALL, REQUEST_DELAY_MS,
  PROBE_RECENT_QUERY, PROBE_NEW_QUERY, BY_IDS_QUERY,
  gql, sleep, shape, harvestCharacters, loadAssembled, loadSeen, assembleAndWrite, CHARACTERS,
  writeJsonAtomic,
} from './anilist-core.mjs'
import {
  loadKeepWithD1, withKeptMedia, KEEP_CHARACTERS_QUERY, keepCharacterRecord, linkKeptCharacter,
} from './keep-list.mjs'
import { queryD1 } from '../src/lib/d1-api.mjs'

const STATE_FILE = join(DATA_DIR, 'ingest-state.json')
const DAILY_RAW = join(RAW_DIR, 'daily.jsonl')

const num = (name, fallback) => (process.env[name] ? Number(process.env[name]) : fallback)
const MAX_CALLS = num('MAX_CALLS', 240)
const MAX_PROBE_PAGES = num('MAX_PROBE_PAGES', 40)
// The keep list has its own small budget. It runs after the big fetch, which
// on a busy night spends every call MAX_CALLS allows, and a kept page must
// come back that night, not the night the backlog clears. 50 ids per call.
const KEEP_MAX_CALLS = num('KEEP_MAX_CALLS', 10)

let calls = 0

/**
 * Page through a cheap id+updatedAt listing and collect the ids we must fetch.
 * `hit` returns true when a row is one we already hold at the same version.
 * After enough of those in a row, the sweep has caught up and stops.
 */
async function probe(label, query, type, seen, wanted) {
  const STOP_AFTER_KNOWN = 2 // two full pages of known rows means caught up
  let knownPages = 0

  for (let page = 1; page <= MAX_PROBE_PAGES; page++) {
    if (calls >= MAX_CALLS) {
      console.log(`  ${label}: call budget used up.`)
      return
    }
    let data
    try {
      data = await gql(query, { page, type })
    } catch (error) {
      console.warn(`  ${label} page ${page} failed: ${error.message}. stopping this sweep.`)
      return
    }
    calls++
    const rows = data?.Page?.media || []
    if (!rows.length) return

    let fresh = 0
    for (const row of rows) {
      const have = seen.get(row.id)
      if (have !== undefined && have === (row.updatedAt ?? 0)) continue
      wanted.add(row.id)
      fresh++
    }
    console.log(`  ${label} page ${page}: ${rows.length} rows, ${fresh} need fetching`)

    knownPages = fresh === 0 ? knownPages + 1 : 0
    if (knownPages >= STOP_AFTER_KNOWN) return
    if (!data?.Page?.pageInfo?.hasNextPage) return
    await sleep(REQUEST_DELAY_MS)
  }
}

/** Download the full record for a list of ids, 50 at a time. */
async function fetchDetails(ids) {
  const out = new Map()
  for (let i = 0; i < ids.length; i += IDS_PER_CALL) {
    if (calls >= MAX_CALLS) {
      console.log('  fetch: call budget used up, the rest waits for tomorrow.')
      break
    }
    const batch = ids.slice(i, i + IDS_PER_CALL)
    let data
    try {
      data = await gql(BY_IDS_QUERY, { ids: batch })
    } catch (error) {
      console.warn(`  fetch batch failed: ${error.message}. skipping it.`)
      await sleep(REQUEST_DELAY_MS)
      continue
    }
    calls++
    for (const m of data?.Page?.media || []) out.set(m.id, shape(m))
    console.log(`  fetched ${out.size}/${ids.length}`)
    await sleep(REQUEST_DELAY_MS)
  }
  return out
}

/**
 * Fetch every character on the keep list and link it to each catalog title
 * it appears in. 50 ids per call, at the same pace as the rest, on its own budget.
 */
async function fetchKeptCharacters(ids, comics, anime) {
  const result = { characters: 0, links: 0 }
  if (!ids.length) return result
  const titleById = new Map([...comics, ...anime].map((x) => [x.id, x]))
  let keepCalls = 0
  for (let i = 0; i < ids.length; i += IDS_PER_CALL) {
    if (keepCalls >= KEEP_MAX_CALLS) {
      console.log(`  keep list: its ${KEEP_MAX_CALLS}-call budget is used up, the rest waits for tomorrow.`)
      break
    }
    const batch = ids.slice(i, i + IDS_PER_CALL)
    let data
    try {
      data = await gql(KEEP_CHARACTERS_QUERY, { ids: batch })
    } catch (error) {
      console.warn(`  keep list batch failed: ${error.message}. skipping it.`)
      await sleep(REQUEST_DELAY_MS)
      continue
    }
    calls++
    keepCalls++
    for (const node of data?.Page?.characters || []) {
      const record = keepCharacterRecord(node)
      CHARACTERS.set(record.id, { ...record, appearsIn: [] })
      result.characters++
      result.links += linkKeptCharacter(node, record, titleById)
    }
    await sleep(REQUEST_DELAY_MS)
  }
  console.log(`Keep list: ${result.characters} of ${ids.length} characters fetched, ${result.links} cast links added.`)
  return result
}

async function main() {
  const startedAt = Date.now()
  const { comics, anime } = loadAssembled()
  if (!comics.length && !anime.length) {
    console.error('data/comics.json and data/anime.json are both empty.')
    console.error('Run "npm run ingest:full" once before the daily job can work.')
    process.exit(1)
  }
  console.log(`Have ${comics.length} comics and ${anime.length} anime on disk.`)

  // Older catalog files stored character references without an id. Without it
  // the character pages lose every "appears in" link, so refuse to run.
  const missingIds = [...comics, ...anime].some((x) => (x.characters || []).some((c) => c.id == null))
  if (missingIds) {
    console.error('The catalog on disk is the old format (character refs have no id).')
    console.error('Run "npm run ingest:full" once to rebuild it, then the daily job can take over.')
    process.exit(1)
  }

  let seen = loadSeen()
  if (!seen.size) {
    // First run after an older ingest: rebuild the memory from what we hold.
    seen = new Map([...comics, ...anime].map((x) => [x.id, x.updatedAt ?? 0]))
    console.log('No seen.json yet. Built it from the catalog on disk.')
  }
  console.log(`seen.json knows ${seen.size} titles.`)

  const wanted = new Set()
  for (const type of ['MANGA', 'ANIME']) {
    console.log(`Probing ${type} for edits...`)
    await probe(`edits-${type}`, PROBE_RECENT_QUERY, type, seen, wanted)
    await sleep(REQUEST_DELAY_MS)
    console.log(`Probing ${type} for new titles...`)
    await probe(`new-${type}`, PROBE_NEW_QUERY, type, seen, wanted)
    await sleep(REQUEST_DELAY_MS)
  }

  const keep = await loadKeepWithD1(queryD1)
  const ids = withKeptMedia([...wanted], keep)
  console.log(`Probe done in ${calls} calls. ${wanted.size} titles need a full fetch, ${keep.media.length} more are on the keep list.`)

  const fetched = ids.length ? await fetchDetails(ids) : new Map()
  console.log(`Fetched ${fetched.size} records. ${calls} API calls in total.`)

  // Keep a copy so a later full re-assemble does not lose today's work.
  if (fetched.size) {
    mkdirSync(RAW_DIR, { recursive: true })
    let lines = ''
    for (const item of fetched.values()) lines += JSON.stringify(item) + '\n'
    appendFileSync(DAILY_RAW, lines)
  }

  // Merge: a fresh record replaces the old one, in place, keeping list order.
  const merge = (list, kinds) => {
    const byId = new Map(list.map((x) => [x.id, x]))
    for (const item of fetched.values()) {
      if (!kinds.includes(item.kind)) continue
      byId.set(item.id, item)
    }
    const out = [...byId.values()]
    for (const item of out) harvestCharacters(item)
    return out
  }

  // Novels live in comics.json beside the comics; the site splits them by kind.
  const nextComics = merge(comics, ['comic', 'novel'])
  const nextAnime = merge(anime, ['anime'])
  const kept = await fetchKeptCharacters(keep.characters, nextComics, nextAnime)
  const stats = assembleAndWrite(nextComics, nextAnime, startedAt)

  writeJsonAtomic(STATE_FILE, {
    ranAt: Date.now(),
    probed: calls,
    needed: ids.length,
    refreshed: fetched.size,
    kept,
    comics: stats.comics,
    anime: stats.anime,
  }, 2)

  console.log('Done.')
  console.log(JSON.stringify(stats, null, 2))
}

main().catch((error) => {
  console.error('DAILY INGEST FAILED:', error.message)
  process.exit(1)
})
