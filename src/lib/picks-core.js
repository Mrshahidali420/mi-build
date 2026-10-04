/**
 * The pure half of the Amazon products (src/lib/picks.js): the rules, with the
 * data files handed in. picks.js binds them to data/picks.json and
 * data/product-picks.json for the pages; the tests hand in their own.
 *
 * Two files, one shape:
 *   picks.json          chosen by hand (scripts/build-picks.mjs). Always wins.
 *   product-picks.json  matched from publisher records by
 *                       scripts/picks-from-products.mjs, for the titles nobody
 *                       picked by hand. It also lists `noEnglishBooks`: titles
 *                       that were checked and have no English print at all.
 *
 * data: { titles: { "<anilist id>": [pick] }, characters?: { ... }, noEnglishBooks?: [id] }
 * pick: { a: ASIN, n: short name, t: book | disc | figure | plush | poster | apparel | merch }
 */

export const US_HOST = 'www.amazon.com'

// The relations that are the same story in another form, or the next part of
// it. A reader on the manga page of a series wants the same volume 1 as a
// reader on its anime page. Checked in this order, so the closest one wins.
export const SAME_STORY = ['ADAPTATION', 'SOURCE', 'PARENT', 'PREQUEL', 'SEQUEL']

// What each type is called on the card.
export const PICK_LABELS = {
  book: 'Book',
  disc: 'Blu-ray / DVD',
  figure: 'Figure',
  plush: 'Plush',
  poster: 'Poster',
  apparel: 'Apparel',
  merch: 'Merch',
}

const listIn = (data, id) => data?.titles?.[String(id)] || null

/*
 * What Open Library says about the ISBN-like picks (data/pick-isbn-formats.json).
 *   ebook    a Kindle edition's ISBN. Kindle books sell under a B0 ASIN, so
 *            amazon.com/dp/<that ISBN> is a 404. Such a pick is never shown.
 *   comic    printed as a comic, whatever the record it was filed under says.
 *   unclear  one ISBN filed under both a novel and its manga, with nothing in
 *            its name to say which. Shown, but with a plain label.
 */
const formatSetsCache = new WeakMap()
function formatSets(formats) {
  if (!formats) return { ebook: new Set(), comic: new Set(), unclear: new Set() }
  if (!formatSetsCache.has(formats)) {
    formatSetsCache.set(formats, {
      ebook: new Set(formats.ebook || []),
      comic: new Set(formats.comic || []),
      unclear: new Set(formats.unclear || []),
    })
  }
  return formatSetsCache.get(formats)
}

// What a pick's own name says it is. Publisher names often carry it:
// "(Light Novel)", "(Manga)", "@ Comic 01".
const NOVEL_NAME = /light\s*novel|\(novel\)|\bnovel\s+\d/i
const COMIC_NAME = /\(manga\)|\bmanga\b|\bcomic\b/i
function nameForm(name) {
  const text = String(name || '')
  if (NOVEL_NAME.test(text)) return 'novel'
  if (COMIC_NAME.test(text)) return 'comic'
  return null
}

// The form of a record: a novel, a comic, or neither (an anime, or unknown).
function recordForm(record) {
  if (!record) return null
  if (record.kind === 'novel' || record.format === 'NOVEL') return 'novel'
  if (record.kind === 'anime') return null
  if (['MANGA', 'ONE_SHOT'].includes(record.format) || ['comic', 'manga', 'manhwa', 'manhua'].includes(record.kind)) return 'comic'
  return null
}

/**
 * The matched picks a page may show. The publisher crawl filed some ISBNs
 * under the wrong record (the Slime light novel under its manga too), and some
 * are eBook ISBNs that only open Amazon's 404 page. Both are left out. A pick
 * whose own name says it is the other form of the story ("(Manga)" on a novel
 * page) is left out as well: the page would offer the wrong book.
 */
function usableMatched(list, owner, formats) {
  const { ebook } = formatSets(formats)
  const ownForm = recordForm(owner)
  return list.filter((pick) => {
    if (ebook.has(String(pick.a).toUpperCase())) return false
    if (pick.t !== 'book' || !ownForm) return true
    const said = nameForm(pick.n)
    return !said || said === ownForm
  })
}

// The picks in one file for this title, or else for the same story in
// another form, with `from` naming that other title and `owner` the record
// they were filed under (the title itself, or the relation).
function storyPicksIn(data, item, keep) {
  const kept = (id, owner) => {
    const list = listIn(data, id)
    if (!list) return null
    const shown = keep(list, owner)
    return shown.length ? shown : null
  }
  const own = kept(item.id, item)
  if (own) return { picks: own, from: null, owner: item }
  for (const relation of SAME_STORY) {
    for (const rel of (item.relations || []).filter((r) => r.relation === relation)) {
      const picks = kept(rel.id, rel)
      if (picks) return { picks, from: rel.title || null, owner: rel }
    }
  }
  return null
}

const TYPE_WORDS = { KR: 'Manhwa', CN: 'Manhua', TW: 'Manhua' }
// An anime's AniList source, as the form of its printed original.
const SOURCE_FORMS = { MANGA: 'comic', LIGHT_NOVEL: 'light', NOVEL: 'novel', WEB_NOVEL: 'novel' }
function typeWord(form, country) {
  if (form === 'novel') return country === 'JP' ? 'Light novel' : 'Novel'
  if (form === 'comic') return TYPE_WORDS[country] || 'Manga'
  return null
}

/**
 * What a book pick is, in a reader's words: "Light novel", "Manga", "Manhwa",
 * "Manhua", or null when it cannot be told honestly (the card then says
 * "English edition"). Worked out from, in order: the pick's own name, what
 * Open Library says it is, the record it was filed under, and on an anime page
 * the one kind of original the index holds for it. When those disagree, or an
 * ISBN was filed under both forms, the answer is null rather than a guess.
 */
export function pickType(pick, owner, formats, item = null) {
  if (!pick || pick.t !== 'book') return null
  const { comic, unclear } = formatSets(formats)
  const asin = String(pick.a).toUpperCase()
  if (unclear.has(asin)) return null
  const country = owner?.country || item?.country
  const said = nameForm(pick.n)
  const library = comic.has(asin) ? 'comic' : null
  if (said && library && said !== library) return null
  const ownForm = recordForm(owner)
  if (said || library) {
    const form = said || library
    if (ownForm && ownForm !== form) return null
    if (form === 'novel' && /light\s*novel/i.test(pick.n)) return 'Light novel'
    return typeWord(form, country)
  }
  if (ownForm) return typeWord(ownForm, country)
  // Filed under an anime: the originals the index holds for it, one kind
  // only, or else the anime's own AniList source (MANGA, LIGHT_NOVEL, ...).
  const sources = (owner?.comicInIndex || []).filter((c) => c && c.kind)
  const forms = [...new Set(sources.map((c) => (c.kind === 'novel' ? 'novel' : 'comic')))]
  if (forms.length === 1) return typeWord(forms[0], sources[0].country || country)
  if (forms.length > 1) return null
  const source = SOURCE_FORMS[owner?.source]
  if (!source) return null
  return source === 'light' ? 'Light novel' : typeWord(source, country)
}

/**
 * The picks for one title, and which title they were picked for.
 *
 * `from` is null when the picks are the title's own. When they belong to the
 * same story in another form (the manga of this anime, the first season of
 * this sequel), `from` names that title, so a heading can say so instead of
 * pretending they were chosen for this exact page.
 *
 * The hand picks are searched first across the whole story, and only then the
 * matched ones. So a page that showed hand picks before still shows the same
 * ones: the manga of a hand-picked anime keeps the anime's picks rather than
 * its own single matched volume. `byHand` says which file they came from,
 * because the card must not claim a person chose what a script matched.
 */
export function picksForTitleIn(hand, item, products, formats = null) {
  if (!item) return null
  const chosen = storyPicksIn(hand, item, (list) => list)
  if (chosen) return { ...chosen, byHand: true }
  const matched = storyPicksIn(products, item, (list, owner) => usableMatched(list, owner, formats))
  return matched ? { ...matched, byHand: false } : null
}

// The "no English books" list as a Set, built once per data file.
const emptySets = new WeakMap()
function noBooksSet(products) {
  if (!products) return new Set()
  if (!emptySets.has(products)) emptySets.set(products, new Set((products.noEnglishBooks || []).map(Number)))
  return emptySets.get(products)
}

const hasBookPick = (hand, products, id) =>
  [hand, products].some((data) => (listIn(data, id) || []).some((pick) => pick.t === 'book'))

/**
 * Whether a "Shop books" search row is worth showing for this title.
 *
 * Most Amazon clicks that earned nothing were book searches for stories that
 * were never printed in English: the reader landed on a page of unrelated
 * books. So a title that was checked and has no English print loses the row.
 *
 * True when we know of a book for the title or for the same story in another
 * form (the manga behind an anime), and also when the title was never checked
 * at all: unknown is not the same as none, so those keep today's row.
 */
export function booksKnownIn(hand, item, products) {
  if (!item) return true
  if (!noBooksSet(products).has(Number(item.id))) return true
  if (hasBookPick(hand, products, item.id)) return true
  return (item.relations || []).some(
    (rel) => SAME_STORY.includes(rel.relation) && hasBookPick(hand, products, rel.id)
  )
}
