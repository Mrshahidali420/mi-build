/**
 * Manhwa Index's template post types, in the order they are tried when two
 * of them have news at once. Each one is a picker, a caption writer with a
 * few wordings, and its own image design (one file each).
 *
 * A type posts only when its key is in the repo variable FB_POST_TYPES
 * (gate.mjs). The classic post (a cover and a caption) is not in this list;
 * its name in the variable is `classic`.
 */
import birthday from './birthday.mjs'
import character from './character.mjs'
import fact from './fact.mjs'
import newTitle from './new-title.mjs'
import next from './next.mjs'
import ranking from './ranking.mjs'
import reelNext from './reel-next.mjs'
import reelRanking from './reel-ranking.mjs'
import where from './where.mjs'

export const TYPES = [newTitle, where, ranking, birthday, character, fact, next]

export const TYPE_KEYS = TYPES.map((type) => type.key)

/** The reels (reel/): short vertical videos made from slides. Gated like every type, by name. */
export const REELS = [reelRanking, reelNext]

/** Every kind a run can be asked for by name. */
export const KINDS = [...TYPES, ...REELS]
