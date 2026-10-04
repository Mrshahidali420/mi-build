/**
 * Pure helpers for the guides section (/guides).
 *
 * Shared by three places that must agree:
 *   - scripts/guide-media.mjs   writes data/guide-media.json and data/guide-index.json
 *   - src/pages/guides/*.astro  draws the guide pages and the hub (build time)
 *   - src/components/FeaturedIn.astro  the "Featured in" links on title and
 *     character pages, which the Worker draws on request
 *
 * Nothing here reads a file or the network, so every function is tested in
 * tests/guides.test.js.
 */

/** Every category a guide can sit in, in the order the hub lists them. */
export const GUIDE_CATEGORIES = [
  { key: 'power-scaling', label: 'Strongest characters and power rankings' },
  { key: 'versus', label: 'Who would win' },
  { key: 'ranks-and-powers', label: 'Ranks, powers and systems explained' },
  { key: 'watch-order', label: 'Watch and reading order' },
  { key: 'recommendations', label: 'What to watch and read' },
  { key: 'beginner', label: 'Beginner guides' },
  { key: 'cosplay', label: 'Cosplay' },
  { key: 'data', label: 'From our own data' },
]

export const CATEGORY_KEYS = GUIDE_CATEGORIES.map((c) => c.key)

/** The line in a guide's Markdown body where the entry cards go. */
export const ENTRIES_MARKER = '<!-- entries -->'

/** Without the marker, the cards go after this many intro paragraphs. */
export const INTRO_PARAGRAPHS = 2

/**
 * Split a guide's rendered HTML into the part before the entry cards and the
 * part after. With the marker, the split is at the marker. Without it, the
 * split is after the first two paragraphs; a body with fewer puts the cards
 * at the end.
 */
export function splitBody(html = '') {
  const text = String(html)
  const at = text.indexOf(ENTRIES_MARKER)
  if (at !== -1) {
    return { before: text.slice(0, at), after: text.slice(at + ENTRIES_MARKER.length) }
  }
  let cut = -1
  let from = 0
  for (let i = 0; i < INTRO_PARAGRAPHS; i++) {
    const end = text.indexOf('</p>', from)
    if (end === -1) return { before: text, after: '' }
    cut = end + 4
    from = cut
  }
  return { before: text.slice(0, cut), after: text.slice(cut) }
}

/** The key a character or media record is stored under in guide-media.json. */
export const charKey = (id) => `c${id}`
export const mediaKey = (id) => `m${id}`

/**
 * Every AniList id a list of guides names, split by kind. A guide is its
 * frontmatter ({ slug, hero, entries }).
 */
export function collectIds(guides = []) {
  const characters = new Set()
  const media = new Set()
  for (const guide of guides) {
    if (guide.hero?.character) characters.add(guide.hero.character)
    if (guide.hero?.media) media.add(guide.hero.media)
    for (const entry of guide.entries || []) {
      if (entry.character) characters.add(entry.character)
      if (entry.media) media.add(entry.media)
    }
  }
  return { characters: [...characters].sort((a, b) => a - b), media: [...media].sort((a, b) => a - b) }
}

/** The series an entry is shown under: its own `media`, else the character's top title. */
export function seriesIdOf(entry, mediaMap = {}) {
  if (entry.media) return entry.media
  const person = entry.character ? mediaMap[charKey(entry.character)] : null
  return person?.media?.[0] ?? null
}

/** "Where to watch" for anime, "Where to read" for everything else. */
export const whereVerb = (series) => (series?.type === 'ANIME' ? 'watch' : 'read')

/**
 * Everything one entry card needs, from the entry and the media map. Missing
 * media (a script not yet run) leaves the image out and keeps the text.
 */
export function cardOf(entry, mediaMap = {}) {
  const person = entry.character ? mediaMap[charKey(entry.character)] || null : null
  const seriesId = seriesIdOf(entry, mediaMap)
  const series = seriesId ? mediaMap[mediaKey(seriesId)] || null : null
  const image = person?.image || series?.cover || null
  const seriesTitle = series?.title || ''
  const alt = entry.alt || (seriesTitle ? `${entry.heading} from ${seriesTitle}` : entry.heading)
  return {
    rank: entry.rank ?? null,
    heading: entry.heading,
    text: entry.text,
    stats: entry.stats || [],
    image,
    // Character art on AniList is 230 x 345; covers are about 460 x 650.
    width: person?.image ? 230 : 460,
    height: person?.image ? 345 : 650,
    alt,
    characterPath: person?.path || null,
    seriesTitle,
    seriesPath: series?.path || null,
    verb: whereVerb(series),
  }
}

/**
 * The hero picture of a guide: the series banner, else its cover, else the
 * hero character's portrait, else the first entry's picture.
 */
export function heroOf(guide, mediaMap = {}) {
  const hero = guide.hero || {}
  const series = hero.media ? mediaMap[mediaKey(hero.media)] : null
  const person = hero.character ? mediaMap[charKey(hero.character)] : null
  const alt = hero.alt || series?.title || person?.name || guide.title
  if (series?.banner) return { src: series.banner, width: 1900, height: 400, alt, wide: true }
  if (series?.cover) return { src: series.cover, width: 460, height: 650, alt, wide: false }
  if (person?.image) return { src: person.image, width: 230, height: 345, alt, wide: false }
  const first = (guide.entries || [])[0]
  if (first) {
    const card = cardOf(first, mediaMap)
    if (card.image) return { src: card.image, width: card.width, height: card.height, alt: card.alt, wide: false }
  }
  return null
}

/** YYYY-MM-DD from a Date or a date string. */
export const isoDay = (date) => {
  const d = date instanceof Date ? date : new Date(date)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

/** "4 October 2026". */
export const longDay = (date) => {
  const d = date instanceof Date ? date : new Date(date)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/**
 * The small index the hub, the sitemap and the "Featured in" links read.
 * featured maps c<id> / m<id> to the guide slugs that include it. A
 * character's own series counts too, so the Naruto title page lists the
 * Naruto ranking.
 */
export function buildGuideIndex(guides = [], mediaMap = {}) {
  const featured = {}
  const add = (key, slug) => {
    if (!featured[key]) featured[key] = []
    if (!featured[key].includes(slug)) featured[key].push(slug)
  }
  const list = [...guides]
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((guide) => {
      if (guide.hero?.media) add(mediaKey(guide.hero.media), guide.slug)
      for (const entry of guide.entries || []) {
        if (entry.character) add(charKey(entry.character), guide.slug)
        if (entry.media) add(mediaKey(entry.media), guide.slug)
        // The character's own top title as well: an entry shown under
        // Naruto Shippuden still belongs on the Naruto page.
        const top = entry.character ? mediaMap[charKey(entry.character)]?.media?.[0] : null
        if (top) add(mediaKey(top), guide.slug)
      }
      const hero = heroOf(guide, mediaMap)
      return {
        slug: guide.slug,
        title: guide.title,
        description: guide.description,
        category: guide.category,
        updated: isoDay(guide.updated),
        image: hero?.src || null,
        imageAlt: hero?.alt || guide.title,
        wide: !!hero?.wide,
      }
    })
  const sorted = Object.fromEntries(Object.keys(featured).sort().map((k) => [k, featured[k]]))
  return { guides: list, featured: sorted }
}

/** How many "Featured in" links one page shows at most. */
export const FEATURED_MAX = 4

/**
 * The guides that include a character or a title, for the "Featured in"
 * links: [{ slug, title, path }]. Pass { character } on a character page and
 * { media } on a title page.
 */
export function featuredIn(index, { character, media } = {}) {
  if (!index || !index.featured) return []
  const key = character ? charKey(character) : media ? mediaKey(media) : null
  const slugs = key ? index.featured[key] || [] : []
  const bySlug = new Map((index.guides || []).map((g) => [g.slug, g]))
  return slugs
    .map((slug) => bySlug.get(slug))
    .filter(Boolean)
    .slice(0, FEATURED_MAX)
    .map((g) => ({ slug: g.slug, title: g.title, path: `/guides/${g.slug}` }))
}

/**
 * The hub's list: collection guides and data-guide pages together, grouped
 * by category in GUIDE_CATEGORIES order, empty groups left out. Within a
 * group, the most recently updated first.
 */
export function groupByCategory(guides = []) {
  return GUIDE_CATEGORIES.map((cat) => ({
    ...cat,
    guides: guides
      .filter((g) => g.category === cat.key)
      .sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')) || a.title.localeCompare(b.title)),
  })).filter((cat) => cat.guides.length > 0)
}

/** The closing "how this was made" note on a guide page, by category. */
export function methodNote(category) {
  if (category === 'power-scaling' || category === 'versus') {
    return {
      heading: 'How we rank',
      text:
        'Rankings on manhwaindex go by what the anime and manga actually show: fights, feats and what the story states outright, not fan theories, games or databooks alone. Where the anime adds filler, the manga is the tiebreaker.',
    }
  }
  if (category === 'data') {
    return {
      heading: 'Where these numbers come from',
      text: "This guide is built from manhwaindex's own platform data and changes when that data does.",
    }
  }
  return {
    heading: 'How this guide is made',
    text: 'Guides on manhwaindex are written from the anime and manga themselves and checked against the source before they go up.',
  }
}

/** Count the words of a Markdown body plus the written entry text. */
export function wordCount(body = '', entries = []) {
  const all = [body, ...entries.map((e) => `${e.heading} ${e.text}`)].join(' ')
  return all
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/[#>*_`[\]()|-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length
}
