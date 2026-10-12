/**
 * Data a kind needs that the catalog does not hold, fetched while the run
 * loads its data: a kind may carry `extra: { name, load }`, and
 * data[name] is then what load({ book, now, data, kinds, fetch, say })
 * returns. Kinds that share a name share one load (fan art and cosplay
 * share the picture search). A run with no such kind switched on never
 * fetches anything.
 */
export function withExtras(loadPools, kinds, { book, fetch = globalThis.fetch, say = () => {} }) {
  const loaders = new Map()
  for (const kind of kinds) if (kind && typeof kind !== 'string' && kind.extra && !loaders.has(kind.extra.name)) loaders.set(kind.extra.name, kind.extra.load)
  if (!loaders.size) return loadPools
  return async (options = {}) => {
    const loaded = await loadPools(options)
    const now = options.now ?? Date.now()
    const extra = {}
    for (const [name, load] of loaders) extra[name] = await load({ book, now, data: loaded.data, kinds, fetch, say })
    return { ...loaded, data: { ...loaded.data, ...extra } }
  }
}
