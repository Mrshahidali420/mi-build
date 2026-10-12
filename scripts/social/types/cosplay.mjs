/**
 * "Cosplay" for this site: a cosplay of a character of a comic or novel that has a page here
 * (types/art-card.mjs holds the picker, the words and the design; art/ finds
 * and checks the pictures).
 */
import { artType } from './art-card.mjs'

export default artType({ kind: 'cosplay', verb: 'read' })
