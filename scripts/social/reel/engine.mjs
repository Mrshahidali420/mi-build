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
import { REEL, assemble } from './video.mjs'

async function loadReelArt(art = {}, deps) {
  const [hero, thumbs] = await Promise.all([art.hero ? loadArt(art.hero, { ...deps, size: ART_SIZE.hero }) : null, Promise.all((art.thumbs || []).map((url) => loadArt(url, { ...deps, size: ART_SIZE.hero })))])
  return { hero, thumbs }
}

/**
 * @param avoidTrack the music of the reel before this one, so two in a row never sound the same
 * @returns {Promise<{ mp4: Buffer, seconds: number, pngs: Buffer[], track: string }>}
 */
export async function renderReel(type, post, { theme, fetch = globalThis.fetch, ffmpeg, avoidTrack = null } = {}) {
  const { kit, sharp } = await kitFor(theme)
  const first = await loadReelArt(post.art, { fetch, sharp })
  const bad = first.thumbs.flatMap((picture, i) => (!picture || picture.blank ? [i] : []))
  const shown = (bad.length && post.without?.(bad)) || post
  const art = shown === post ? first : await loadReelArt(shown.art, { fetch, sharp })
  const trees = type.slides({ ...shown.view, art }, kit)
  const pngs = []
  for (const tree of trees) pngs.push(await renderTree(tree, theme, REEL))
  const track = trackFor(slugOf(type, post), avoidTrack)
  const { mp4, seconds } = await assemble(pngs, { ...(ffmpeg ? { ffmpeg } : {}), track: join(AUDIO_DIR, track) })
  return { mp4, seconds, pngs, track }
}
