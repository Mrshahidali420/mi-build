// The owner's message buttons post here. Every check is in
// src/lib/message-actions.js, so this file only hands the request over. ALL
// answers every other method with 405 through the same handler.
import { handleMessageTap } from '../../../lib/message-actions.js'
import { envOf } from '../../../lib/runtime.js'

export const prerender = false

export const POST = (context) => handleMessageTap(context.request, envOf(context))
export const ALL = (context) => handleMessageTap(context.request, envOf(context))
