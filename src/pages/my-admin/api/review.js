// The owner's review buttons post here. Every check is in
// src/lib/review-actions.js, so this file only hands the request over. ALL
// answers every other method with 405 through the same handler.
import { handleReviewTap } from '../../../lib/review-actions.js'
import { envOf } from '../../../lib/runtime.js'

export const prerender = false

export const POST = (context) => handleReviewTap(context.request, envOf(context))
export const ALL = (context) => handleReviewTap(context.request, envOf(context))
