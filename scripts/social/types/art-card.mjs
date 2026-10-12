/**
 * "Fan art" and "Cosplay": a picture of a character from a title that has a
 * page on this site (art/load.mjs finds them, art/safe.mjs checks them).
 *
 * Rare by rule: fan art and cosplay together are at most one post in eight
 * on a Page, never two in a row (attempt.mjs, `rare`). A picture is never
 * posted twice (ledger `artSeen`). The artist and the original address go
 * in the first comment, after the site link, when the source names them.
 *
 * Image: the picture is the hero, whole, with the thin solid line round it.
 * Above it a small label and the character's name; under it who made it,
 * then the line about the first comment and the brand. No shapes behind the
 * type, no glow.
 *
 * artType() makes the type for one site and one kind: `verb` says which
 * titles count ('watch' for an anime site, 'read' for a comics site).
 */
import { loadArt } from '../art/load.mjs'
import { SITE } from '../site.mjs'
import { tagName } from '../art/danbooru.mjs'
import { baseTitle, tagOf, uniqueTags } from '../story.mjs'
import { clip, fitSize, isDrawable } from '../text.mjs'
import { FOOT, H, INNER, PAD } from '../render/parts.mjs'
import { byPopularity, ctaOf } from './shared.mjs'

/** A picture is never posted again: ten years is "never" for the ledger's rules. */
export const GAP_DAYS = 3650
/** The titles a picture may come from: the most popular ones that have a cast. */
const TITLES = 300
const KIND = {
  fanart: { label: 'Fan art', by: 'Art by', tag: '#fanart', emoji: '🎨' },
  cosplay: { label: 'Cosplay', by: 'Photo by', tag: '#cosplay', emoji: '📸' },
}
const LABEL = { watch: 'Where to watch it', read: 'Where to read it' }
const CTA = { watch: 'Where to watch it: link in the first comment', read: 'Where to read it: link in the first comment' }
const NAME_STEPS = [[12, 64], [20, 52], [30, 42], [60, 34]]
/** Heights of the fixed pieces round the picture, in pixels. */
const ROOM = H - PAD * 2 - FOOT - 32 - 16 - 70 - 24 - 24 - 40

function toPost(item, kind, verb) {
  const t = item.title
  const name = item.character || tagName(item.characters[0])
  const words = KIND[kind]
  return {
    // A picture is about a character, not a title: it never stops (or is stopped by) another post about the title.
    title: null,
    series: t.title,
    path: t.path,
    label: LABEL[verb],
    synopsis: null,
    shop: null,
    item: item.id,
    hash: item.hash,
    // Written in the ledger with the post (send.mjs), so the mix of ratings can be read there.
    record: { hash: item.hash, rating: item.rating, ecchi: Boolean(item.ecchi), source: item.source },
    name,
    kind,
    verb,
    artist: item.artist,
    credit: item.credit ? { label: `${words.by} ${item.credit.name}`, url: item.credit.url } : null,
    tags: uniqueTags([tagOf(name), tagOf(baseTitle(t.title)) || tagOf(t.title), words.tag, kind === 'fanart' ? '#animeart' : '#cosplayer', tagOf(t.section, { lower: true })]),
    art: { hero: item.image },
    view: { kind, label: words.label, name: clip(name, 48), series: clip(t.title, 70), by: item.artist ? `${words.by} ${clip(item.artist, 40)}` : null, verb },
  }
}

const findFor = (kind, verb) => (data) =>
  (data.art?.[kind] || [])
    .filter((item) => item.title?.verb === verb && isDrawable(item.character || tagName(item.characters?.[0])))
    .map((item) => toPost(item, kind, verb))

/** The art loader, shared by the two kinds (post.mjs runs it once when either is on). */
const extra = (verb) => ({
  name: 'art',
  load: ({ book, now, data, kinds, fetch, say }) =>
    loadArt({
      book,
      now,
      fetch,
      say,
      page: SITE.key,
      wants: new Set(kinds.filter((k) => k?.extra?.name === 'art').map((k) => k.key)),
      titles: (data.titles || []).filter((t) => t.verb === verb && isDrawable(t.title)).sort(byPopularity).slice(0, TITLES),
    }),
})

const who = (p) => `${p.name} from ${p.series}`
const by = (p) => (p.artist ? `${p.kind === 'cosplay' ? 'Photo' : 'Art'} by ${p.artist}, credited in the first comment.` : null)

const CAPTIONS = {
  fanart: [
    (p) => ({ hook: `🎨 Fan art of ${who(p)}.`, facts: [by(p)], cta: ctaOf(p.verb, 0) }),
    (p) => ({ hook: `✨ ${p.name} fan art, from ${p.series}.`, facts: [by(p)], cta: ctaOf(p.verb, 1) }),
    (p) => ({ hook: `🎨 Today's fan art: ${who(p)}.`, facts: [by(p)], cta: ctaOf(p.verb, 2) }),
  ],
  cosplay: [
    (p) => ({ hook: `📸 Cosplay of ${who(p)}.`, facts: [by(p)], cta: ctaOf(p.verb, 0) }),
    (p) => ({ hook: `✨ ${p.name} in real life: a cosplay from ${p.series}.`, facts: [by(p)], cta: ctaOf(p.verb, 1) }),
    (p) => ({ hook: `📸 Today's cosplay: ${who(p)}.`, facts: [by(p)], cta: ctaOf(p.verb, 2) }),
  ],
}

const QUESTIONS = {
  fanart: [(p) => `What do you think of this ${p.name} art?`, (p) => `Which ${p.series} character should we feature next?`, (p) => `Is ${p.name} one of your favourites?`],
  cosplay: [(p) => `How close is this to the real ${p.name}?`, (p) => `Which ${p.series} character would you cosplay?`, (p) => `Is ${p.name} one of your favourites?`],
}

function template(v, k) {
  const t = k.tone('dark')
  const nameSize = fitSize(v.name, NAME_STEPS)
  const height = ROOM - nameSize
  return k.page(
    t,
    { cta: CTA[v.verb] },
    k.row({ justifyContent: 'space-between', alignItems: 'flex-end' }, k.kicker(v.label, { color: t.pop }), k.kicker(v.series, { ...k.clamp(1), color: t.soft, fontSize: 21, letterSpacing: 2, maxWidth: INNER - 260, textAlign: 'right' })),
    k.display({ ...k.clamp(1), fontSize: nameSize, fontWeight: k.f.displayBlack, lineHeight: 1.08, marginTop: 16 }, v.name),
    k.row({ marginTop: 24, height, justifyContent: 'center', alignItems: 'center' }, k.art(v.art.hero, INNER, height)),
    k.body({ fontSize: 22, color: t.soft, marginTop: 16, height: 30 }, v.by || ''),
    k.fill(),
  )
}

/** The fan art or cosplay type of one site. */
export const artType = ({ kind, verb }) => ({
  key: kind,
  name: kind === 'fanart' ? 'Fan art' : 'Cosplay',
  urgent: false,
  rare: true,
  gapDays: GAP_DAYS,
  titleGap: false,
  window: 5,
  find: findFor(kind, verb),
  captions: CAPTIONS[kind],
  questions: QUESTIONS[kind],
  tags: (p) => p.tags,
  template,
  extra: extra(verb),
})
