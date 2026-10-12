/**
 * The building blocks every template image is made of: boxes, type in the
 * site's two faces, a hairline, a picture placed whole, and the small site
 * mark with the site name that closes every image.
 *
 * A template is a function (view, kit) -> tree. The tree is plain data in
 * the shape satori reads ({ type, props: { style, children } }), so a
 * template can be tested without drawing anything.
 *
 * The look is editorial on purpose: flat colour, big type, the art as the
 * hero, hairlines for structure. No badges, no glows, no card grids.
 */

export const W = 1080
export const H = 1350
export const PAD = 72
export const INNER = W - PAD * 2
/** The thin line round every picture, so dark art does not sink into a dark page. */
export const STROKE = { large: 3, small: 2, from: 300 }

const kidsOf = (kids) => {
  const list = kids.flat(Infinity).filter((kid) => kid !== null && kid !== undefined && kid !== false && kid !== '')
  return list.length === 0 ? undefined : list.length === 1 ? list[0] : list
}

/** One element. Empty children are dropped, so a template can write `cond && box(...)`. */
export const h = (type, style, ...kids) => ({ type, props: { style, children: kidsOf(kids) } })

export const box = (style, ...kids) => h('div', { display: 'flex', ...style }, ...kids)
export const row = (style, ...kids) => box({ flexDirection: 'row', ...style }, ...kids)
export const col = (style, ...kids) => box({ flexDirection: 'column', ...style }, ...kids)
/** A flexible gap that pushes what follows to the far edge. */
export const fill = () => box({ flexGrow: 1 })

/** A style that cuts text off (with an ellipsis) after this many lines, whatever its length. */
export const clamp = (lines) => ({ display: 'block', lineClamp: lines })

/** How wide a character of the reading face is, as a share of its size (an estimate, a little on the wide side). */
const CHAR_WIDTH = 0.56
export const SEPARATOR = ' · '

/**
 * "A · B · C" as lines that never end on a separator: the units are packed
 * into at most `lines` lines of `maxChars`, and a unit that does not fit is
 * left out rather than cut.
 */
export function wrapUnits(text, maxChars, lines = 2) {
  const out = []
  for (const unit of String(text || '').split(SEPARATOR).filter(Boolean)) {
    const last = out.at(-1)
    if (last !== undefined && `${last}${SEPARATOR}${unit}`.length <= maxChars) out[out.length - 1] = `${last}${SEPARATOR}${unit}`
    else if (out.length < lines) out.push(unit)
    else break
  }
  return out
}

/** How wide a character of the display face is, as a share of its size. */
const DISPLAY_WIDTH = 0.62

/** How many lines a text takes at this size in this width (an estimate), at most `max`. */
export function linesOf(text, size, width, { max = 2, face = DISPLAY_WIDTH } = {}) {
  if (!text) return 0
  return Math.min(max, Math.max(1, Math.ceil(String(text).length / Math.floor(width / (size * face)))))
}

/** The room the lines under the last content take: the first-comment line and the brand line. */
export const FOOT = 118

/** A last word this short is not left alone on a line; it is tied to a word before it that is no longer than PARTNER_MAX. */
const ORPHAN_MAX = 8
const PARTNER_MAX = 8
const ORPHAN_WORDS = 4
const NBSP = String.fromCharCode(160)

/**
 * The same text with its last two words tied by a non-breaking space when
 * both are short and the text has four words or more, so a wrapped title
 * never ends on a lone short word
 * ("Horizons: The / Series" becomes "Horizons: / The Series").
 */
export function noOrphan(text) {
  const words = String(text).split(" ")
  if (words.length < ORPHAN_WORDS || words.at(-1).length > ORPHAN_MAX || words.at(-2).length > PARTNER_MAX) return String(text)
  return [...words.slice(0, -2), words.slice(-2).join(NBSP)].join(" ")
}

/** The size of a picture of shape `ratio` (width / height) placed whole inside a box. */
export function contain(ratio, maxWidth, maxHeight) {
  const width = Math.min(maxWidth, maxHeight * ratio)
  return { width: Math.round(width), height: Math.round(width / ratio) }
}

const withAlpha = (hex, alpha) => {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/**
 * The colours of one background.
 *   dark    the site's night colour, cream type, the accent for emphasis
 *   light   cream paper, night type; the accent is a fill there, never type
 *   accent  the accent as the page, night type
 */
export function toneOf(theme, name) {
  const c = theme.color
  if (name === 'light') return { name, bg: c.paper, ink: c.night, soft: withAlpha(c.night, 0.62), line: withAlpha(c.night, 0.2), pop: c.night, block: c.accent }
  if (name === 'accent') return { name, bg: c.accent, ink: c.night, soft: withAlpha(c.night, 0.7), line: withAlpha(c.night, 0.28), pop: c.night, block: c.night }
  return { name: 'dark', bg: c.night, ink: c.paper, soft: withAlpha(c.paper, 0.62), line: withAlpha(c.paper, 0.2), pop: c.accent, block: c.accent }
}

/** Everything a template draws with, bound to one site's theme. */
export function kitOf(theme, marks = {}) {
  const f = theme.font

  /** Text in the display face (names, numbers, headlines). */
  const display = (style, value) => box({ fontFamily: f.display, fontWeight: f.displayBold, lineHeight: 1.08, ...style }, noOrphan(String(value)))
  /** Text in the reading face. */
  const body = (style, value) => box({ fontFamily: f.text, fontWeight: f.textRegular, lineHeight: 1.3, ...style }, String(value))
  /** A small spaced label that names the kind of post. Plain type, no shape behind it. */
  const kicker = (value, style = {}) => body({ fontWeight: f.textBold, fontSize: 26, letterSpacing: 5, textTransform: 'uppercase', lineHeight: 1.2, ...style }, value)

  const rule = (color, thickness = 2, style = {}) => box({ height: thickness, backgroundColor: color, alignSelf: 'stretch', flexShrink: 0, ...style })

  /**
   * A picture placed whole inside maxWidth x maxHeight, with a thin solid line
   * round it in the paper colour (a flat line: no glow, no gradient). A flat
   * panel when the picture is missing. The line is inside the size given.
   */
  const art = (picture, maxWidth, maxHeight, style = {}) => {
    if (!picture) return box({ width: maxWidth, height: maxHeight, backgroundColor: theme.color.raised, flexShrink: 0, ...style })
    const size = contain(picture.ratio, maxWidth, maxHeight)
    const line = Math.min(size.width, size.height) >= STROKE.from ? STROKE.large : STROKE.small
    const img = { type: 'img', props: { src: picture.src, width: size.width - line * 2, height: size.height - line * 2, style: { flexShrink: 0 } } }
    return box({ width: size.width, height: size.height, padding: line, backgroundColor: theme.color.paper, flexShrink: 0, ...style }, img)
  }

  /**
   * Quick context for someone who never reads the caption: labelled lines
   * (SCORE, GENRE, STATUS, ALT TITLE), a small spaced label and its value in
   * plain type with a hairline above. No shapes behind anything. A line the
   * record lacks is left out; null when there is nothing at all.
   * @param info { rating, genres, status, alt } (shared.mjs aboutOf)
   * @param width the room the block has; the value wraps inside it
   */
  const about = (info, tone, { size = 26, width = INNER, style = {} } = {}) => {
    const rows = [
      info?.rating && ['Score', row({ alignItems: 'baseline' }, display({ fontSize: size, fontWeight: f.displayBlack, color: tone.pop, lineHeight: 1.2 }, info.rating), body({ fontSize: size, color: tone.ink, marginLeft: 8, lineHeight: 1.2 }, 'on AniList'))],
      info?.genres && ['Genre', col({}, wrapUnits(info.genres, Math.floor((width - Math.round(size * 4.5)) / (size * CHAR_WIDTH))).map((line) => body({ fontSize: size, fontWeight: f.textBold, color: tone.ink, lineHeight: 1.2 }, line)))],
      info?.status && ['Status', info.status],
      info?.alt && ['Alt title', info.alt],
    ].filter(Boolean)
    if (!rows.length) return null
    const label = Math.round(size * 4.5)
    return col(
      { width, ...style },
      rows.map(([name, value]) =>
        row(
          { borderTop: `2px solid ${tone.line}`, paddingTop: 7, paddingBottom: 7, alignItems: 'flex-start' },
          kicker(name, { fontSize: Math.round(size * 0.62), letterSpacing: 2, color: tone.soft, width: label, flexShrink: 0, lineHeight: 1.2, marginTop: Math.round(size * 0.3) }),
          typeof value === 'string' ? body({ ...clamp(2), fontSize: size, fontWeight: f.textBold, color: tone.ink, lineHeight: 1.2, width: width - label }, value) : value,
        ),
      ),
    )
  }

  /** One sentence about the story, under a title: the reading face, soft, two lines at most. */
  const tagline = (value, tone, style = {}) => (value ? body({ ...clamp(2), fontSize: 27, color: tone.soft, lineHeight: 1.3, ...style }, noOrphan(value)) : null)

  /** The line that sends the reader to the first comment, above the brand line. A small flat square, then plain type. */
  const cta = (value, tone) =>
    row({ alignItems: 'center', marginBottom: 20, flexShrink: 0 }, box({ width: 16, height: 16, backgroundColor: tone.pop, marginRight: 14, flexShrink: 0 }), body({ fontSize: 25, fontWeight: f.textBold, color: tone.ink, lineHeight: 1.2 }, value))

  /** The closing line of every image: the mark, the site name, the address. `scale` makes it larger on a taller canvas (a reel). */
  const brand = (tone, scale = 1) =>
    row(
      { alignItems: 'center', justifyContent: 'space-between', borderTop: `2px solid ${tone.line}`, paddingTop: Math.round(22 * scale), flexShrink: 0 },
      row(
        { alignItems: 'center' },
        marks[tone.name] && { type: 'img', props: { src: marks[tone.name], width: Math.round(44 * scale), height: Math.round(44 * scale), style: { marginRight: Math.round(14 * scale) } } },
        // A site may set its name in its wordmark face (font.brand); the display face otherwise.
        display({ fontSize: Math.round((f.brandSize || 26) * scale), color: tone.ink, fontFamily: f.brand || f.display, fontWeight: f.brandWeight || f.displayBold }, theme.name),
      ),
      body({ fontSize: Math.round(24 * scale), color: tone.soft, fontWeight: f.textMedium }, theme.domain),
    )

  /**
   * The whole image: one background, the standard margins, then the line
   * about the first comment (when the first child is { cta }) and the brand
   * line last.
   */
  const page = (tone, ...kids) => {
    const options = kids[0] && typeof kids[0] === 'object' && !Array.isArray(kids[0]) && !kids[0].type ? kids[0] : null
    const inside = options ? kids.slice(1) : kids
    return box(
      { width: W, height: H, backgroundColor: tone.bg, color: tone.ink, fontFamily: f.text },
      col({ width: INNER, height: H - PAD * 2, marginLeft: PAD, marginTop: PAD }, ...inside, options?.cta && cta(options.cta, tone), brand(tone)),
    )
  }

  return { theme, f, tone: (name) => toneOf(theme, name), display, body, kicker, rule, art, about, tagline, cta, brand, page, box, row, col, fill, contain, clamp }
}
