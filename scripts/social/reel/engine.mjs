/**
 * A reel for one post of one reel type: the slides are drawn with the post
 * images' own renderer (satori and sharp), then put together with ffmpeg
 * (video.mjs).
 *
 * A reel type is { key, reel: true, find(data, ctx), slides(view, kit),
 * captions, questions, tags }. Its post names its pictures in
 * `art.thumbs` (one per item, in the order of `view.items`) and, for the
 * opening slide, `art.hero`. slides() returns the trees, opening slide first.
 *
 * An item whose cover cannot be loaded or is a blank placeholder is left
 * out when the post can do without it (`post.without`), like a tile in a
 * list image.
 */
import { kitFor, loadArt, renderTree, ART_SIZE } from '../render/engine.mjs'
import { join } from 'node:path'
import { slugOf } from '../plan.mjs'
import { AUDIO_DIR, trackFor } from './sound.mjs'
import { CAROUSEL_FRAME } from './slides.mjs'
import { REEL, assemble } from './video.mjs'

async function loadReelArt(art = {}, deps) {
  const [hero, thumbs] = await Promise.all([art.hero ? loadArt(art.hero, { ...deps, size: ART_SIZE.hero }) : null, Promise.all((art.thumbs || []).map((url) => loadArt(url, { ...deps, size: ART_SIZE.hero })))])
  return { hero, thumbs }
}

/** The view the slides are drawn from, with its pictures; an item with a blank cover is left out when the post allows. */
async function viewOf(post, deps) {
  const first = await loadReelArt(post.art, deps)
  const bad = first.thumbs.flatMap((picture, i) => (!picture || picture.blank ? [i] : []))
  const shown = (bad.length && post.without?.(bad)) || post
  const art = shown === post ? first : await loadReelArt(shown.art, deps)
  return { ...shown.view, art }
}

const JPEG = { quality: 92, chromaSubsampling: '4:4:4' }

/**
 * An Instagram swipe post (a carousel) for one post: the type's carousel()
 * slides at 1080x1350, as JPEGs, hook first.
 * @param post a post of the reel type (type.fromPost of the picture post)
 * @returns {Promise<Buffer[]>}
 */
export async function renderCarousel(type, post, { theme, fetch = globalThis.fetch } = {}) {
  const { kit, sharp } = await kitFor(theme)
  const trees = type.carousel(await viewOf(post, { fetch, sharp }), kit)
  const jpegs = []
  for (const tree of trees) jpegs.push(await sharp(await renderTree(tree, theme, CAROUSEL_FRAME)).jpeg(JPEG).toBuffer())
  return jpegs
}

/**
 * @param avoidTrack the music of the reel before this one, so two in a row never sound the same
 * @returns {Promise<{ mp4: Buffer, seconds: number, pngs: Buffer[], track: string }>}
 */
export async function renderReel(type, post, { theme, fetch = globalThis.fetch, ffmpeg, avoidTrack = null } = {}) {
  const { kit, sharp } = await kitFor(theme)
  const trees = type.slides(await viewOf(post, { fetch, sharp }), kit)
  const pngs = []
  for (const tree of trees) pngs.push(await renderTree(tree, theme, REEL))
  const track = trackFor(slugOf(type, post), avoidTrack)
  const { mp4, seconds } = await assemble(pngs, { ...(ffmpeg ? { ffmpeg } : {}), track: join(AUDIO_DIR, track) })
  return { mp4, seconds, pngs, track }
}
