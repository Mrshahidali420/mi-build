/**
 * The one renderer behind every template image: a tree of boxes and text
 * (render/parts.mjs) becomes a 1080x1350 picture, on the Actions runner, with
 * no browser.
 *
 *   satori   lays the tree out and writes an SVG with every letter already
 *            drawn as a shape, from the site's own font files (@fontsource,
 *            .woff), so the picture is the same on any machine
 *   sharp    turns that SVG into a PNG or JPEG, and prepares the art
 *
 * Art is fetched once, made upright, fitted inside a box and handed to the
 * template as a data address with its shape, so a template can place a cover
 * whole (never cropped) without knowing its size in advance.
 *
 * satori and sharp are loaded only when a picture is made; a run that sends
 * classic posts never touches them.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveCover } from '../image.mjs'
import { kitOf } from './parts.mjs'

export const WIDTH = 1080
export const HEIGHT = 1350
const SUBSETS = ['latin', 'latin-ext']
/** The longest side art is prepared at: the hero art, and the small pictures in a list. */
export const ART_SIZE = { hero: 1000, thumb: 420 }
const MARK_PX = 192
const FETCH_TIMEOUT_MS = 15_000
const JPEG_QUALITY = 92
/** A source narrower than this (AniList portraits are 230 px) is enlarged this much at most, and sharpened a little more. */
const SMALL_SOURCE = { below: 400, grow: 1.75, sharpen: 1.0 }
const SHARPEN = 0.5
/** A cover is "blank" when this share of it is plain white or plain black (a logo on an empty page). */
export const BLANK = { share: 0.82, white: 238, black: 16, probe: 48 }

const requireHere = createRequire(import.meta.url)
const requireSite = createRequire(pathToFileURL(join(process.cwd(), 'package.json')))

function packageDir(name) {
  for (const req of [requireSite, requireHere]) {
    try {
      return dirname(req.resolve(`${name}/package.json`))
    } catch {
      // try the next place
    }
  }
  throw new Error(`the font package ${name} is not installed`)
}

/** Every font file the theme asks for, in the shape satori reads. */
export function loadFonts(theme) {
  const fonts = theme.fonts.flatMap((face) => {
    const dir = join(packageDir(face.pkg), 'files')
    return face.weights.flatMap((weight) =>
      SUBSETS.map((subset) => join(dir, `${face.file}-${subset}-${weight}-normal.woff`))
        .filter((file) => existsSync(file))
        .map((file) => ({ name: face.name, data: readFileSync(file), weight, style: 'normal' })),
    )
  })
  if (!fonts.length) throw new Error('no font file found for the template images')
  return fonts
}

const dataUrl = (bytes, type) => `data:${type};base64,${bytes.toString('base64')}`

/** The site mark as small pictures, one per tone it is drawn in. */
export async function loadMarks(theme, sharp) {
  if (!theme.mark?.file || !existsSync(theme.mark.file)) return {}
  const svg = readFileSync(theme.mark.file, 'utf8')
  const tones = Object.entries(theme.mark.tones || { dark: null, light: null })
  const made = await Promise.all(
    tones.map(async ([tone, color]) => {
      const tinted = color ? svg.replaceAll('currentColor', color) : svg
      const png = await sharp(Buffer.from(tinted), { density: 600 }).resize(MARK_PX, MARK_PX, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
      return [tone, dataUrl(png, 'image/png')]
    }),
  )
  return Object.fromEntries(made)
}

/** True when a picture is almost all plain white or plain black: a placeholder, not cover art. */
export async function isBlankCover(input, sharp) {
  const { data, info } = await sharp(input).flatten({ background: '#ffffff' }).resize(BLANK.probe, BLANK.probe, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
  let white = 0
  let black = 0
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
    if (r >= BLANK.white && g >= BLANK.white && b >= BLANK.white) white += 1
    else if (r <= BLANK.black && g <= BLANK.black && b <= BLANK.black) black += 1
  }
  return Math.max(white, black) / (BLANK.probe * BLANK.probe) >= BLANK.share
}

/**
 * One picture, ready for a template: { src, ratio (width / height), blank },
 * or null when it cannot be fetched or read. A small source (a 230 px
 * portrait) is enlarged with lanczos by a set factor only, and sharpened.
 */
export async function loadArt(url, { fetch = globalThis.fetch, sharp, size = ART_SIZE.hero } = {}) {
  if (!url) return null
  try {
    const best = await resolveCover(url, { fetch })
    const res = await fetch(best.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) return null
    const input = Buffer.from(await res.arrayBuffer())
    const meta = await sharp(input).metadata()
    const small = meta.width > 0 && meta.width < SMALL_SOURCE.below
    const side = small ? Math.min(size, Math.round(Math.max(meta.width, meta.height) * SMALL_SOURCE.grow)) : size
    const { data, info } = await sharp(input)
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({ width: side, height: side, fit: 'inside', kernel: 'lanczos3' })
      .sharpen({ sigma: small ? SMALL_SOURCE.sharpen : SHARPEN })
      .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
      .toBuffer({ resolveWithObject: true })
    return { src: dataUrl(data, 'image/jpeg'), ratio: info.width / info.height, blank: await isBlankCover(input, sharp) }
  } catch {
    return null
  }
}

/** The art a post names ({ hero, thumbs }) as loaded pictures in the same shape. */
export async function loadPostArt(art = {}, deps) {
  const [hero, thumbs] = await Promise.all([
    art.hero ? loadArt(art.hero, { ...deps, size: ART_SIZE.hero }) : null,
    Promise.all((art.thumbs || []).map((url) => loadArt(url, { ...deps, size: ART_SIZE.thumb }))),
  ])
  if (art.hero && !hero) throw new Error('the main picture could not be loaded')
  return { hero, thumbs }
}

let ready = null
/** satori, sharp, the fonts and the marks, loaded once per process and theme. */
async function tools(theme) {
  if (!ready || ready.theme !== theme) {
    const [{ default: satori }, { default: sharp }] = await Promise.all([import('satori'), import('sharp')])
    ready = { theme, satori, sharp, fonts: loadFonts(theme), marks: await loadMarks(theme, sharp) }
  }
  return ready
}

/** A tree of boxes as a PNG. */
export async function renderTree(tree, theme) {
  const { satori, sharp, fonts } = await tools(theme)
  const svg = await satori(tree, { width: WIDTH, height: HEIGHT, fonts })
  return sharp(Buffer.from(svg)).resize(WIDTH, HEIGHT).png().toBuffer()
}

/**
 * The picture for one post of one type.
 * @returns {Promise<{ png: Buffer, jpeg: Buffer }>}
 */
export async function renderPost(type, post, { theme, fetch = globalThis.fetch } = {}) {
  const { sharp, marks } = await tools(theme)
  const first = await loadPostArt(post.art, { fetch, sharp })
  // A list post can leave out a tile whose cover is a blank placeholder, when it has another title to show.
  // A placeholder as the main picture is never posted: the item is skipped for this run.
  if (first.hero?.blank) throw new Error('its cover is a blank placeholder')
  const blank = first.thumbs.flatMap((picture, i) => (picture?.blank ? [i] : []))
  const shown = (blank.length && post.without?.(blank)) || post
  const art = shown === post ? first : await loadPostArt(shown.art, { fetch, sharp })
  const png = await renderTree(type.template({ ...shown.view, art }, kitOf(theme, marks)), theme)
  const jpeg = await sharp(png).jpeg({ quality: JPEG_QUALITY, chromaSubsampling: '4:4:4' }).toBuffer()
  return { png, jpeg }
}
