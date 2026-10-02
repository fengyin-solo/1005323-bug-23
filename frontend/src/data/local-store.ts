import { applyDatingConclusionsToFinds, rejudgeDatingRows } from './dating-rules'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'archaeology-field:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 测年送检判定口径调整后，存量数据在读取时统一重判一遍：
 * 送检单按送检日期与报告收到日的前后关系重判（已出报告的校正年代不重算），
 * 校验结论随记录落库，并同步到出土物台账。重判是幂等的，已判过的数据不会再变。
 */
function migrateStoredRows(rows: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const dating = rejudgeDatingRows(rows['dating'] ?? [])
  const find = applyDatingConclusionsToFinds(dating, rows['find'] ?? [])
  if (
    JSON.stringify(dating) === JSON.stringify(rows['dating'] ?? []) &&
    JSON.stringify(find) === JSON.stringify(rows['find'] ?? [])
  ) {
    return rows
  }
  return { ...rows, dating, find }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return migrateStoredRows(fallback)
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = migrateStoredRows(fallback)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const migrated = migrateStoredRows({ ...fallback, ...parsed })
    if (JSON.stringify(migrated) !== JSON.stringify({ ...fallback, ...parsed })) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
    }
    return migrated
  } catch {
    const seeded = migrateStoredRows(fallback)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  let rows = clone(SEED_ROWS[key] ?? [])
  if (key === 'dating') {
    rows = rejudgeDatingRows(rows)
    saveRows(key, rows)
    saveRows('find', applyDatingConclusionsToFinds(rows, listRows('find')))
    return rows
  }
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
