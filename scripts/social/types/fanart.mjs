/**
 * "Fan art" for this site: a character of a comic or novel that has a page here
 * (types/art-card.mjs holds the picker, the words and the design; art/ finds
 * and checks the pictures).
 */
import { artType } from './art-card.mjs'

export default artType({ kind: 'fanart', verb: 'read' })
