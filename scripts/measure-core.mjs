/**
 * The numbers behind "is this page templated?", shared by the two measure
 * scripts and the tests. Pure functions, no I/O.
 *
 *   words          how much text a page has
 *   site share     how much of it the site wrote itself (not the synopsis/bio)
 *   near-dup rate  share of pages whose site text has a near twin in the
 *                  sample once names and numbers are masked: 5-word shingles,
 *                  Jaccard >= 0.6. High means one skeleton with names swapped.
 *   top sentences  the exact sentences found on the most pages
 */

export const SHINGLE = 5
export const NEAR_DUP = 0.6

/** A small seeded random source (mulberry32), so a sample is the same every run. */
export function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** n items picked without replacement, the same ones for the same seed. */
export function sample(list, n, seed) {
  const rand = seeded(seed)
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, n)
}

export const wordCount = (text) => (String(text || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length

export const sentencesOf = (text) =>
  String(text || '')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"#])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3)

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Masks what differs between two pages built from one template: the given
 * names, any number, and any capitalised word that does not open a sentence.
 * What is left is the skeleton.
 */
export function mask(text, names = []) {
  let out = String(text || '')
  for (const name of [...new Set(names.filter((n) => n && n.length > 1))].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(escape(name), 'g'), ' N ')
  }
  out = out.replace(/[\d][\d,.]*/g, ' # ')
  // A capitalised word after a sentence break is ordinary; anywhere else it is a name.
  out = out.replace(/([^.!?:;]\s+)([A-Z][\p{L}'’-]*(?:\s+[A-Z][\p{L}'’-]*)*)/gu, (m, lead) => `${lead} N `)
  return out
    .toLowerCase()
    .replace(/[“”"()]/g, ' ')
    .replace(/(\bn\b[\s,]*)+/g, 'n ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function shingles(masked, size = SHINGLE) {
  const words = masked.split(/[\s]+/).filter(Boolean)
  const set = new Set()
  if (words.length < size) {
    if (words.length) set.add(words.join(' '))
    return set
  }
  for (let i = 0; i + size <= words.length; i++) set.add(words.slice(i, i + size).join(' '))
  return set
}

export function jaccard(a, b) {
  if (!a.size && !b.size) return 1
  let shared = 0
  const [small, large] = a.size < b.size ? [a, b] : [b, a]
  for (const s of small) if (large.has(s)) shared++
  return shared / (a.size + b.size - shared)
}

/**
 * The share of texts with at least one near twin in the list.
 * @param texts  [{ text, names }]
 */
export function nearDupRate(texts, threshold = NEAR_DUP) {
  const sets = texts.map(({ text, names }) => shingles(mask(text, names)))
  const order = sets.map((s, i) => [s.size, i]).sort((x, y) => x[0] - y[0])
  const twin = new Array(sets.length).fill(false)
  for (let x = 0; x < order.length; x++) {
    const [sizeA, a] = order[x]
    for (let y = x + 1; y < order.length; y++) {
      const [sizeB, b] = order[y]
      // Jaccard can never reach the threshold when one set is this much bigger.
      if (sizeA < sizeB * threshold) break
      if (twin[a] && twin[b]) continue
      if (jaccard(sets[a], sets[b]) >= threshold) {
        twin[a] = true
        twin[b] = true
      }
    }
  }
  const hits = twin.filter(Boolean).length
  return texts.length ? hits / texts.length : 0
}

/** The exact sentences found on the most pages, each counted once per page. */
export function topSentences(texts, limit = 20) {
  const pages = new Map()
  for (const text of texts) {
    for (const s of new Set(sentencesOf(text))) pages.set(s, (pages.get(s) || 0) + 1)
  }
  return [...pages.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([sentence, count]) => ({ sentence, pages: count, share: round(count / Math.max(1, texts.length)) }))
}

const round = (n) => Math.round(n * 1000) / 1000

export function percentile(values, p) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

/**
 * One group's report.
 * @param rows [{ url?, site, other, names }]  site = text the site wrote, other = synopsis/bio
 */
export function summarize(rows) {
  const siteWords = rows.map((r) => wordCount(r.site))
  const allWords = rows.map((r) => wordCount(r.site) + wordCount(r.other))
  const totalSite = siteWords.reduce((n, w) => n + w, 0)
  const total = allWords.reduce((n, w) => n + w, 0)
  return {
    pages: rows.length,
    medianWords: percentile(allWords, 50),
    p10Words: percentile(allWords, 10),
    medianSiteWords: percentile(siteWords, 50),
    p10SiteWords: percentile(siteWords, 10),
    siteShare: total ? round(totalSite / total) : 0,
    nearDupRate: round(nearDupRate(rows.map((r) => ({ text: r.site, names: r.names })))),
    topSentences: topSentences(rows.map((r) => r.site)),
  }
}
