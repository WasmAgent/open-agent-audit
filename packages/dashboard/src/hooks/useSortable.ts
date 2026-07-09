import { useState, useMemo, useCallback } from 'react'

export type SortDirection = 'asc' | 'desc'

export interface SortState<K extends string> {
  key: K
  direction: SortDirection
}

/**
 * Generic sortable hook — no external deps, ~30 lines of logic.
 * Returns sorted data and helpers to toggle sort columns.
 */
export function useSortable<T, K extends string>(
  data: T[],
  getters: Record<K, (item: T) => string | number | undefined>,
  defaultKey: K,
  defaultDirection: SortDirection = 'asc',
) {
  const [sort, setSort] = useState<SortState<K>>({ key: defaultKey, direction: defaultDirection })

  const toggleSort = useCallback(
    (key: K) => {
      setSort((prev) =>
        prev.key === key
          ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
          : { key, direction: 'asc' },
      )
    },
    [],
  )

  const sorted = useMemo(() => {
    const getter = getters[sort.key]
    if (!getter) return data
    const dir = sort.direction === 'asc' ? 1 : -1
    return [...data].sort((a, b) => {
      const va = getter(a) ?? ''
      const vb = getter(b) ?? ''
      if (va < vb) return -1 * dir
      if (va > vb) return 1 * dir
      return 0
    })
  }, [data, getters, sort])

  return { sorted, sort, toggleSort }
}
