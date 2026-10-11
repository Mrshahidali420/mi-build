/**
 * The A–Z index: every title and every indexed character, by first letter.
 *
 * Why it exists. The link count on 10 Oct 2026 put 103,840 titles and 138,035
 * characters four or five clicks from the home page. The listings are sorted
 * by popularity, so a small title sits on page 900 of its section and a
 * crawler has to walk the pager to get there. Here the path is always three
 * clicks: home -> a letter -> a page of that letter -> the title or character.
 *
 * How it stays light. The pages are rendered by the Worker from small files
 * the build writes (public/d/b/), never from the catalog:
 *
 *   index.json           { t: { a: 4312, ... }, c: { a: 5120, ... } }
 *   t-a-0.json           the first 2,000 titles under A, as [name, path] rows
 *   t-a-1.json           the next 2,000, and so on
 *
 * One file holds BROWSE_CHUNK_PAGES pages, so a page read parses about 100 KB
 * and the whole index is about 140 files, not 2,400.
 *
 * Pure: no file access here. scripts/make-shards.mjs writes the files and
 * src/lib/browse-read.js reads them at request time.
 */

export const BROWSE_PER_PAGE = 100
export const BROWSE_CHUNK_PAGES = 20
export const BROWSE_OTHER = '0-9'
export const BROWSE_LETTERS = [BROWSE_OTHER, ...'abcdefghijklmnopqrstuvwxyz']

// group in the URL -> the file prefix and the words the pages use.
export const BROWSE_GROUPS = {
  titles: {
    file: 't',
    label: 'Titles',
    noun: 'titles',
    blurb: 'Every manhwa, manga, manhua, novel and anime in the index, by first letter.',
  },
  characters: {
    file: 'c',
    label: 'Characters',
    noun: 'characters',
    blurb: 'Every character with a page in the index, by first letter.',
  },
}

/** A name without accents, in lower case, with leading punctuation gone. */
export function sortKeyOf(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, '')
}

/** The letter a name is filed under: a to z, or "0-9" for digits and other scripts. */
export function letterOf(name) {
  const first = sortKeyOf(name).charAt(0)
  return first >= 'a' && first <= 'z' ? first : BROWSE_OTHER
}

export const letterLabel = (letter) => (letter === BROWSE_OTHER ? '0–9' : String(letter).toUpperCase())

/**
 * entries: [{ name, path }]. Returns Map(letter -> [[name, path], ...]) with
 * each letter sorted by name, then by path so namesakes keep a fixed order.
 * Entries without a name or a path are left out.
 */
export function browseGroups(entries) {
  const keyed = []
  for (const entry of entries || []) {
    if (!entry || !entry.name || !entry.path) continue
    keyed.push({ key: sortKeyOf(entry.name), row: [entry.name, entry.path] })
  }
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.row[1] < b.row[1] ? -1 : a.row[1] > b.row[1] ? 1 : 0))
  const groups = new Map()
  for (const { key, row } of keyed) {
    const first = key.charAt(0)
    const letter = first >= 'a' && first <= 'z' ? first : BROWSE_OTHER
    const list = groups.get(letter)
    if (list) list.push(row)
    else groups.set(letter, [row])
  }
  return groups
}

export const pageCountOf = (count) => Math.max(1, Math.ceil((count || 0) / BROWSE_PER_PAGE))

/** Which file holds a page (pages count from 1). */
export const chunkOf = (page) => Math.floor((page - 1) / BROWSE_CHUNK_PAGES)

export const chunkName = (file, letter, chunk) => `${file}-${letter}-${chunk}`

/** A letter's rows cut into files of BROWSE_CHUNK_PAGES pages each. */
export function chunksOf(rows) {
  const size = BROWSE_PER_PAGE * BROWSE_CHUNK_PAGES
  const chunks = []
  for (let at = 0; at < rows.length; at += size) chunks.push(rows.slice(at, at + size))
  return chunks
}

/** The rows of one page, out of the file that holds it. */
export function pageRows(chunkRows, page) {
  const from = ((page - 1) % BROWSE_CHUNK_PAGES) * BROWSE_PER_PAGE
  return (chunkRows || []).slice(from, from + BROWSE_PER_PAGE)
}

/** Page 1 is the letter's own address; it has no /1 twin. */
export const browsePath = (group, letter, page = 1) =>
  page <= 1 ? `/a-z/${group}/${letter}` : `/a-z/${group}/${letter}/${page}`

/** A page number from the URL: a whole number from 2 up, or null. */
export function pageParam(text) {
  if (!/^[1-9]\d{0,4}$/.test(String(text || ''))) return null
  const page = Number(text)
  return page >= 2 ? page : null
}
