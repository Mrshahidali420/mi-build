/**
 * The sound of a reel: a music bed, and a short sound on each change of
 * slide.
 *
 * The music is one of the tracks in ../audio/. Every one of them is CC0
 * (public domain): the page it came from and its licence are listed in
 * ../audio/SOURCES.md. Nothing else may be added there: no commercial
 * music, no track that asks for credit or a licence, no soundtrack.
 *
 * The sounds on the slide changes are made by ffmpeg itself (noise and sine
 * sources), so they belong to nobody: a soft whoosh as one slide gives way
 * to the next, and a low hit as the closing slide comes in.
 *
 * The music gives way a little under each of those sounds, fades in and
 * out, and the whole mix is brought to about -16 LUFS.
 *
 * Everything here is pure: soundGraph() only writes the filter text.
 */
import { fileURLToPath } from 'node:url'

export const AUDIO_DIR = fileURLToPath(new URL('../audio/', import.meta.url))

/** The music beds, each 30 seconds or a little less. See ../audio/SOURCES.md. */
export const TRACKS = ['fast-fight.m4a', 'the-rush.m4a', 'anime-intro.m4a', 'battle-theme-a.m4a', 'winning-the-race.m4a', 'happy-adventure.m4a']

export const SOUND = {
  rate: 48000,
  /** The level of the music under the effects, and of each effect. */
  music: 0.55,
  whoosh: 0.5,
  hit: 0.9,
  fadeIn: 0.4,
  fadeOut: 0.9,
  /** Where the finished mix is brought to. */
  lufs: -16,
  peak: -1.5,
  /** Seconds a whoosh and a hit last. */
  whooshLength: 0.45,
  hitLength: 0.8,
}

const hashOf = (text) => {
  let h = 2166136261
  for (const ch of String(text)) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0
  return h
}

/**
 * The track of one reel: always the same for the same reel, and never the
 * one the reel before it had.
 * @param key what names the reel (its ledger slug)
 * @param avoid the file name of the track of the last reel, if any
 */
export function trackFor(key, avoid = null, tracks = TRACKS) {
  const first = hashOf(key) % tracks.length
  return tracks[first] === avoid && tracks.length > 1 ? tracks[(first + 1) % tracks.length] : tracks[first]
}

/** The moments a slide gives way to the next: a whoosh on each, a hit on the last (the closing slide). */
export function cuesOf(holds, fade) {
  const cues = []
  let at = 0
  for (let i = 1; i < holds.length; i += 1) {
    at = Math.round((at + holds[i - 1] - fade) * 100) / 100
    cues.push({ at, kind: i === holds.length - 1 ? 'hit' : 'whoosh' })
  }
  return cues
}

const STEREO = `aformat=sample_rates=${SOUND.rate}:channel_layouts=stereo`
const delay = (seconds) => `adelay=${Math.max(0, Math.round(seconds * 1000))}:all=1`

/** Rushing air: filtered noise that swells and dies away, placed across the cross-fade. */
function whoosh(cue, name) {
  const d = SOUND.whooshLength
  return `anoisesrc=d=${d}:c=pink:r=${SOUND.rate}:a=1,highpass=f=700,lowpass=f=6000,afade=t=in:d=${d * 0.6},afade=t=out:st=${d * 0.6}:d=${d * 0.4},volume=${SOUND.whoosh},${STEREO},${delay(cue.at - 0.1)}[${name}]`
}

/** A low hit: a deep tone that dies away, with a short knock of noise on top. */
function hit(cue, name) {
  const d = SOUND.hitLength
  return [
    `sine=f=58:d=${d}:r=${SOUND.rate},afade=t=out:d=${d}:curve=exp[${name}a]`,
    `anoisesrc=d=0.14:c=brown:r=${SOUND.rate}:a=1,lowpass=f=2500,afade=t=out:d=0.14[${name}b]`,
    `[${name}a][${name}b]amix=inputs=2:normalize=0,volume=${SOUND.hit},${STEREO},${delay(cue.at + 0.05)}[${name}]`,
  ].join(';')
}

/**
 * The audio half of the ffmpeg filter graph.
 * @param input the number of the music input
 * @param total the length of the reel in seconds
 * @returns {{ filters: string[], out: string }} `out` is the label to map
 */
export function soundGraph({ input, holds, fade, total }) {
  const cues = cuesOf(holds, fade)
  const made = cues.map((cue, i) => (cue.kind === 'hit' ? hit(cue, `s${i}`) : whoosh(cue, `s${i}`)))
  const labels = cues.map((_, i) => `[s${i}]`).join('')
  const bed = `[${input}:a]atrim=0:${total},asetpts=PTS-STARTPTS,volume=${SOUND.music},${STEREO}[bed]`
  const finish = `afade=t=in:d=${SOUND.fadeIn},afade=t=out:st=${Math.max(0, Math.round((total - SOUND.fadeOut) * 100) / 100)}:d=${SOUND.fadeOut},loudnorm=I=${SOUND.lufs}:TP=${SOUND.peak}:LRA=11,aresample=${SOUND.rate},atrim=0:${total}[aout]`
  if (!cues.length) return { filters: [bed, `[bed]${finish}`], out: 'aout' }
  return {
    filters: [
      bed,
      ...made,
      // The effects twice: once to be heard, once to push the music down under them.
      `${labels}amix=inputs=${cues.length}:normalize=0:duration=longest,apad=whole_dur=${total},asplit=2[fx][key]`,
      `[bed][key]sidechaincompress=threshold=0.04:ratio=5:attack=5:release=300[ducked]`,
      `[ducked][fx]amix=inputs=2:normalize=0:duration=first,${finish}`,
    ],
    out: 'aout',
  }
}
