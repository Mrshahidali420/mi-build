/**
 * The shop shelf: the Amazon links of one page, as cards a reader can see.
 *
 * The old box was a list of text rows, and a reader scrolling past read it as
 * one more block of text. Each card now carries a drawn object (a book, a disc
 * case, a figure on its stand, a screen, an e-reader) made in CSS around art
 * we already hold: the AniList cover, the banner and the character portrait.
 * No Amazon product photo is ever used, because those only come through the
 * Product Advertising API, and copying them breaks the Associates agreement.
 *
 * This file only decides what each card is: which object, which words, which
 * link and which tracking names. Shop.astro draws it. The links themselves
 * still come from shop-links.js and picks.js, so the tags and the per-country
 * store routing are the same ones the old rows used.
 *
 * Pure: no catalog, no network, so the tests can call it with plain objects.
 */
import { storeFor } from './shop-links.js'
import { PICK_LABELS } from './picks-core.js'
import { formatWord } from './format.js'

/**
 * Amazon's own sign-up pages for its two reading and watching memberships.
 * Amazon pays a bounty for a trial started from a tagged link. The words never
 * name a number of days: the length changes by country and by offer, and only
 * Amazon's page can say it.
 */
export const TRIALS = {
  prime: {
    kind: 'trial-prime',
    path: '/gp/video/primesignup',
    object: 'screen',
    label: 'Watch with Prime Video',
    note: 'Free trial for new members, on Amazon',
    cta: 'Start free trial',
  },
  ku: {
    kind: 'trial-ku',
    path: '/kindle-dbs/hz/signup',
    object: 'reader',
    label: 'Read with Kindle Unlimited',
    note: 'Free trial for new members, on Amazon',
    cta: 'Start free trial',
  },
}

/**
 * The sign-up link for one trial, in the reader's own store with its own tag.
 * storeFor already falls back to amazon.com on the US tag for a country we
 * hold no tag for, so a link is never built without one.
 */
export function trialUrl(which, country) {
  const trial = TRIALS[which]
  if (!trial) return null
  const store = storeFor(country)
  return `https://${store.host}${trial.path}?tag=${store.tag}`
}

/**
 * Which trial fits a title page: Prime Video beside an anime, Kindle
 * Unlimited beside a comic or a novel. Null without a page kind.
 */
export function trialFor(item, country) {
  if (!item || !item.kind) return null
  const which = item.kind === 'anime' ? 'prime' : 'ku'
  return { ...TRIALS[which], url: trialUrl(which, country) }
}

/**
 * What the books card is called on a title page. An anime's books row
 * searches the manga it came from. A Japanese novel is sold as a light novel;
 * a Korean or Chinese one is a web novel in print, so it is just "the novel".
 */
export function bookLabel(item) {
  if (!item) return 'The books'
  if (item.kind === 'anime') return 'The manga'
  if (item.kind === 'novel') return item.country === 'JP' ? 'The light novel' : 'The novel'
  return `The ${formatWord(item)}`
}

// The object drawn for each shop kind. Anything unknown stands on a base,
// because a figure is the most common thing the merch searches find.
const OBJECT_OF = {
  books: 'book',
  book: 'book',
  discs: 'case',
  disc: 'case',
  prints: 'frame',
  poster: 'frame',
  apparel: 'tee',
}
export const objectOf = (kind) => OBJECT_OF[kind] || 'stand'

// Which of our own pictures each object is drawn around. The portrait is a
// face, so it goes on the figure, the print and the shirt; a book, a disc and
// a reader show the cover; a screen shows the wide banner.
const ART_OF = {
  book: ['cover'],
  case: ['cover'],
  reader: ['cover'],
  screen: ['banner', 'cover'],
  stand: ['portrait', 'cover'],
  frame: ['portrait', 'cover'],
  tee: ['portrait', 'cover'],
}
export function artFor(object, art = {}) {
  for (const key of ART_OF[object] || ['cover']) if (art[key]) return art[key]
  return null
}

// The card name on a title page. A character page's rows already name their
// series ("Attack on Titan books"), so there the row's own label is kept.
function labelOf(row, item) {
  if (!item) return row.label
  if (row.kind === 'discs') return 'Blu-ray & DVD'
  if (row.kind === 'books') return bookLabel(item)
  if (row.kind === 'merch') return 'Figures & merch'
  return row.label
}

// The books search starts a reader at the beginning, so its book wears a
// "Vol. 1" tab. A picked book only wears it when its own name says it is the
// first volume: a box set or an omnibus must not.
const isFirstVolume = (name) => /\bvol(ume)?\.?\s*0?1\b(?!\d)/i.test(String(name || ''))

/**
 * Every card for one page, in order: the real product first (a pick from
 * publisher records or chosen by hand), then one card per search row, then
 * the trial. `rest` holds the picks after the first, listed under the cards.
 *
 * `item` is the title on a title page and null on a character page (labels
 * then come from the rows). `pickUrl` is passed in, so the one link builder
 * in picks.js stays the only one.
 */
export function shelfCards({ item = null, buys = [], picks = [], byHand = true, trial = null, art = {}, pickUrl }) {
  const cards = []
  const [lead, ...rest] = pickUrl ? picks : []

  if (lead) {
    const object = objectOf(lead.t)
    cards.push({
      key: `pick-${lead.a}`,
      aff: `pick_${lead.t}`,
      src: 'pick',
      url: pickUrl(lead.a),
      object,
      art: artFor(object, art),
      kicker: byHand ? `${PICK_LABELS[lead.t] || 'Merch'} · picked by hand` : `${PICK_LABELS[lead.t] || 'Merch'} · English edition`,
      label: lead.n,
      note: 'The exact product, not a search',
      cta: 'View on Amazon',
      tab: object === 'book' && isFirstVolume(lead.n) ? 'Vol. 1' : null,
      lead: true,
    })
  }

  for (const row of buys) {
    const object = objectOf(row.kind)
    cards.push({
      key: `buy-${row.kind}-${row.url}`,
      aff: row.kind,
      src: 'buybox',
      url: row.url,
      object,
      art: artFor(object, art),
      kicker: null,
      label: labelOf(row, item),
      note: row.note,
      cta: row.cta || 'Shop',
      tab: object === 'book' ? 'Vol. 1' : null,
      lead: false,
    })
  }

  if (trial && trial.url) {
    cards.push({
      key: trial.kind,
      aff: trial.kind,
      src: 'trial',
      url: trial.url,
      object: trial.object,
      art: artFor(trial.object, art),
      kicker: null,
      label: trial.label,
      note: trial.note,
      cta: trial.cta,
      tab: null,
      lead: false,
    })
  }

  // No pick: the first search card carries the lead weight instead, so the
  // row always opens on its strongest card.
  if (cards.length && !cards.some((card) => card.lead)) cards[0] = { ...cards[0], lead: true }

  return { cards, rest: pickUrl ? rest : [] }
}
