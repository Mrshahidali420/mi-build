// Reads the guide Markdown files the way the content collection does, for
// the scripts and tests that run outside Astro (scripts/guide-media.mjs,
// tests/guides.test.js). Only the frontmatter matters here; the body is
// returned for word counts.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import yaml from 'js-yaml'

export const GUIDES_DIR = join(process.cwd(), 'src', 'content', 'guides')

/** { data, body } from one Markdown file's text. */
export function parseGuide(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!match) throw new Error('no frontmatter block')
  return { data: yaml.load(match[1]) || {}, body: match[2] }
}

/** Every guide on disk: [{ slug, ...frontmatter, body }], sorted by slug. */
export function readGuideFiles(dir = GUIDES_DIR) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => {
      const file = join(dir, name)
      try {
        const { data, body } = parseGuide(readFileSync(file, 'utf8'))
        return { ...data, slug: basename(name, '.md'), body }
      } catch (error) {
        throw new Error(`${file}: ${error.message}`)
      }
    })
}
