/**
 * data/index-keep.json: the character pages Google showed at least once in
 * the 90 days the file names. A thin page on this list keeps its place in the
 * index (see isNoindexCharacter in src/lib/character-facts.mjs).
 *
 * Build time only (make-shards.mjs and the prerendered sitemap): it reads the
 * file from disk, so it never ends up inside the Worker. The file is made by
 * hand from Search Console, because GitHub Actions has no Search Console
 * login; refresh it now and then. A missing file means an empty list.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export function loadIndexKeep(root = process.cwd()) {
  const file = join(root, 'data', 'index-keep.json')
  if (!existsSync(file)) return new Set()
  return new Set(JSON.parse(readFileSync(file, 'utf8')).paths || [])
}

// Read once per build: the character wall asks for it on every card.
let cached = null
export const indexKeepOnce = (root = process.cwd()) => (cached ||= loadIndexKeep(root))
