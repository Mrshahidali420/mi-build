/**
 * The slides a reel is made of, drawn with the same kit as the post images
 * (render/parts.mjs): an opening slide, one slide per item, a closing slide
 * with the site name and "link in the first comment".
 *
 * Two frames. A reel is 1080 x 1920: Facebook lays its own buttons and the
 * caption over the top and the bottom of a reel, so everything that matters
 * stays inside its safe margins. An Instagram carousel (a swipe post) is
 * 1080 x 1350, the shape Instagram shows largest in the feed; its opening
 * slide is the hook (hookSlide), the one picture that makes people swipe.
 * The look is the posts' own: flat colour, big type, the cover as the hero,
 * hairlines. No badges, no glows.
 */
import { fitSize } from '../text.mjs'
import { REEL } from './video.mjs'

/** The reel's frame. */
export const SAFE = { top: 190, bottom: 360, side: 84 }
export const REEL_FRAME = { width: REEL.width, height: REEL.height, safe: SAFE, cover: { width: 580, height: 780 }, tagRow: 190, brand: 1.5, headMax: 200 }
/** The swipe post's frame: Instagram's 4:5, no buttons over it. */
export const CAROUSEL_FRAME = { width: 1080, height: 1350, safe: { top: 84, bottom: 84, side: 84 }, cover: { width: 480, height: 640 }, tagRow: 150, brand: 1.2, headMax: 130 }
export const INNER = REEL.width - SAFE.side * 2
const innerOf = (f) => f.width - f.safe.side * 2
/** The opening words: as large as the longest of them allows in the widest display face a site uses, up to the frame's headMax. */
const CAPS_WIDTH = 0.84
const headSize = (lines, f) => Math.min(f.headMax, Math.floor(innerOf(f) / (Math.max(1, ...lines.map((line) => line.text.length)) * CAPS_WIDTH)))
/** The big word of an item slide (a rank, a day, a time) by its length, and the closing words by theirs. */
const TAG_STEPS = [[3, 200], [5, 150], [8, 104], [12, 80]]
const END_STEPS = [[16, 104], [28, 84], [60, 66]]
const TITLE_STEPS = [[22, 68], [44, 56], [70, 46]]
/** The covers on a hook slide: up to three, side by side. */
const HOOK = { covers: 3, gap: 24, height: 400 }

/** One slide: the page colour, the safe margins, the site mark and name at the foot. */
function slide(k, t, f, ...kids) {
  return k.box(
    { width: f.width, height: f.height, backgroundColor: t.bg, color: t.ink, fontFamily: k.f.text },
    k.col({ width: innerOf(f), height: f.height - f.safe.top - f.safe.bottom, marginLeft: f.safe.side, marginTop: f.safe.top }, ...kids, k.brand(t, f.brand)),
  )
}

/** The opening lines, big, one under the other; `pop` lines in the accent colour. */
const headLines = (k, t, lines, f, style = {}) =>
  k.col(style, lines.map((line) => k.display({ fontSize: headSize(lines, f), fontWeight: k.f.displayBlack, lineHeight: 1, color: line.pop ? t.pop : t.ink, marginLeft: -6, whiteSpace: 'nowrap' }, line.text)))

/**
 * The opening slide.
 * @param v { kicker, lines: [{ text, pop }], sub, picture }
 */
export function titleSlide(k, v, f = REEL_FRAME) {
  const t = k.tone('dark')
  return slide(
    k,
    t,
    f,
    // The words sit in the middle of the screen, where a reel is watched.
    k.fill(),
    k.kicker(v.kicker, { color: t.soft, fontSize: 38, letterSpacing: 7 }),
    k.rule(t.line, 3, { marginTop: 28 }),
    headLines(k, t, v.lines, f, { marginTop: 48 }),
    v.sub && k.body({ ...k.clamp(3), fontSize: 46, color: t.soft, marginTop: 36, lineHeight: 1.25 }, v.sub),
    v.picture && k.box({ marginTop: 50 }, k.art(v.picture, 460, 620)),
    k.fill(),
  )
}

/** "SWIPE" and an arrow, in the accent colour: the cue at the foot of a hook slide. */
function swipeCue(k, t) {
  const arrow = k.row(
    { alignItems: 'center', marginLeft: 22 },
    k.box({ width: 64, height: 8, backgroundColor: t.pop }),
    k.box({ width: 0, height: 0, borderTop: '18px solid transparent', borderBottom: '18px solid transparent', borderLeft: `28px solid ${t.pop}` }),
  )
  return k.row({ alignItems: 'center', marginTop: 34, marginBottom: 26 }, k.display({ fontSize: 56, fontWeight: k.f.displayBlack, color: t.pop, letterSpacing: 4, lineHeight: 1 }, 'SWIPE'), arrow)
}

/**
 * The first slide of a swipe post: the covers that are coming, big words
 * that promise a list, and the cue to swipe. It must make people want the
 * next slide, so it never gives the answer away (a countdown shows the
 * lower ranks, never number one).
 * @param v { kicker, lines: [{ text, pop }], sub, pictures }
 */
export function hookSlide(k, v, f = CAROUSEL_FRAME) {
  const t = k.tone('dark')
  const pictures = (v.pictures || []).filter(Boolean).slice(0, HOOK.covers)
  const width = pictures.length ? Math.floor((innerOf(f) - HOOK.gap * (pictures.length - 1)) / pictures.length) : 0
  return slide(
    k,
    t,
    f,
    k.kicker(v.kicker, { ...k.clamp(1), color: t.soft, fontSize: 34, letterSpacing: 6 }),
    k.rule(t.line, 3, { marginTop: 22 }),
    pictures.length > 0 && k.row({ marginTop: 30, justifyContent: 'space-between', width: innerOf(f) }, pictures.map((picture) => k.art(picture, width, HOOK.height))),
    headLines(k, t, v.lines, f, { marginTop: 30 }),
    v.sub && k.body({ ...k.clamp(2), fontSize: 42, color: t.soft, marginTop: 20, lineHeight: 1.22 }, v.sub),
    k.fill(),
    swipeCue(k, t),
  )
}

/**
 * One item.
 * @param v { tag, tagNote, picture, title, note, step } - `tag` is the big word (a rank, a day, a time)
 */
export function itemSlide(k, v, f = REEL_FRAME) {
  const t = k.tone('dark')
  return slide(
    k,
    t,
    f,
    k.row(
      { justifyContent: 'space-between', alignItems: 'flex-end', height: f.tagRow },
      k.row(
        { alignItems: 'flex-end' },
        k.display({ fontSize: fitSize(v.tag, TAG_STEPS), fontWeight: k.f.displayBlack, color: t.pop, lineHeight: 0.9, marginLeft: -8, whiteSpace: 'nowrap' }, v.tag),
        v.tagNote && k.body({ fontSize: 40, color: t.soft, marginLeft: 26, marginBottom: 10 }, v.tagNote),
      ),
      v.step && k.kicker(v.step, { color: t.soft, fontSize: 30, letterSpacing: 4, marginBottom: 14 }),
    ),
    k.rule(t.line, 3, { marginTop: 24 }),
    k.box({ width: innerOf(f), height: f.cover.height, marginTop: 34, justifyContent: 'center', alignItems: 'center' }, k.art(v.picture, f.cover.width, f.cover.height)),
    k.display({ ...k.clamp(2), fontSize: fitSize(v.title, TITLE_STEPS), fontWeight: k.f.displayBlack, lineHeight: 1.06, marginTop: 34 }, v.title),
    v.note && k.body({ ...k.clamp(1), fontSize: 38, color: t.soft, marginTop: 12 }, v.note),
    k.fill(),
  )
}

/**
 * The closing slide: where the link is, and whose reel this is.
 * @param v { head, line }
 */
export function endSlide(k, v, f = REEL_FRAME) {
  const t = k.tone('accent')
  return slide(
    k,
    t,
    f,
    k.fill(),
    k.display({ ...k.clamp(3), fontSize: fitSize(v.head, END_STEPS), fontWeight: k.f.displayBlack, lineHeight: 1.04, marginLeft: -4 }, v.head),
    k.rule(t.ink, 5, { marginTop: 44 }),
    k.row({ alignItems: 'center', marginTop: 44 }, k.box({ width: 34, height: 34, backgroundColor: t.pop, marginRight: 26, flexShrink: 0 }), k.display({ fontSize: 50, lineHeight: 1.1 }, v.line)),
    k.body({ fontSize: 44, color: t.soft, marginTop: 30, fontWeight: k.f.textBold }, k.theme.domain),
    k.fill(),
  )
}

/** The closing words every reel ends on. */
export const END_LINE = 'Link in the first comment'
/** The closing words of a swipe post: links do not work in an Instagram caption. */
export const BIO_END_LINE = 'Link in bio'
