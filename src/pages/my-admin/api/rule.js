// The owner's buttons post here. Every check is in src/lib/admin-actions.js,
// so this file only hands the request over. ALL answers every other method
// with 405 through the same handler.
import { handleTap } from '../../../lib/admin-actions.js'
import { envOf } from '../../../lib/runtime.js'

export const prerender = false

export const POST = (context) => handleTap(context.request, envOf(context))
export const ALL = (context) => handleTap(context.request, envOf(context))
