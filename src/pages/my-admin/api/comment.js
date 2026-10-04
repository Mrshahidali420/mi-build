// The owner's comment buttons post here. Every check is in
// src/lib/comment-actions.js, so this file only hands the request over. ALL
// answers every other method with 405 through the same handler.
import { handleCommentTap } from '../../../lib/comment-actions.js'
import { envOf } from '../../../lib/runtime.js'

export const prerender = false

export const POST = (context) => handleCommentTap(context.request, envOf(context))
export const ALL = (context) => handleCommentTap(context.request, envOf(context))
