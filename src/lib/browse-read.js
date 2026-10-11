// REQUEST TIME. Reads one page of the A–Z index through the ASSETS binding
// (see src/lib/browse.mjs for the files). Never import catalog.js from here.
import { ShardUnavailable } from './runtime.js'
import { BROWSE_GROUPS, BROWSE_LETTERS, pageCountOf, chunkOf, chunkName, pageRows } from './browse.mjs'

const READ_ATTEMPTS = 3
const MAX_CACHED_FILES = 6
// Kept per ASSETS binding, so a warm isolate reads each file once and a new
// deploy (a new isolate, a new binding) starts clean.
const caches = new WeakMap()
const cacheOf = (env) => {
  let cache = caches.get(env.ASSETS)
  if (!cache) caches.set(env.ASSETS, (cache = new Map()))
  return cache
}

async function fetchJson(env, name) {
  try {
    const res = await env.ASSETS.fetch(new Request(`https://assets.local/d/b/${name}.json`))
    if (!res.ok) return { data: null, status: res.status }
    return { data: await res.json(), status: res.status }
  } catch (e) {
    return { data: null, status: e?.message || 'error' }
  }
}

/** One index file. Throws ShardUnavailable when it cannot be read, so the page answers 503. */
async function readJson(env, name) {
  const cache = cacheOf(env)
  const hit = cache.get(name)
  if (hit !== undefined) return hit
  let last = { data: null, status: 'unread' }
  for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
    last = await fetchJson(env, name)
    if (last.data !== null) break
  }
  if (last.data === null) throw new ShardUnavailable(`b/${name}`, last.status)
  if (cache.size >= MAX_CACHED_FILES) cache.delete(cache.keys().next().value)
  cache.set(name, last.data)
  return last.data
}

/**
 * One page of one letter, or null when the group, letter or page does not
 * name a real page. Throws ShardUnavailable when a file could not be read.
 *
 * Returns { rows, count, pageCount, letters }: the [name, path] rows of the
 * page, how many names the letter holds, its page count, and the letters of
 * this group that have at least one name.
 */
export async function loadBrowsePage(env, group, letter, page) {
  const config = BROWSE_GROUPS[group]
  if (!config || !BROWSE_LETTERS.includes(letter)) return null
  if (!Number.isInteger(page) || page < 1) return null
  const index = await readJson(env, 'index')
  const counts = index?.[config.file] || {}
  const count = counts[letter] || 0
  if (!count) return null
  const pageCount = pageCountOf(count)
  if (page > pageCount) return null
  const chunk = await readJson(env, chunkName(config.file, letter, chunkOf(page)))
  return {
    rows: pageRows(chunk, page),
    count,
    pageCount,
    letters: BROWSE_LETTERS.filter((l) => counts[l] > 0),
  }
}
