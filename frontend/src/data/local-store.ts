import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'archaeology-field:entries'
const META_KEY = 'archaeology-field:meta'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
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
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function readMeta(key: string): string {
  if (typeof window === 'undefined' || !window.localStorage) {
    return ''
  }
  const raw = window.localStorage.getItem(META_KEY)
  if (!raw) {
    return ''
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, string>
    return parsed[key] ?? ''
  } catch {
    return ''
  }
}

export function writeMeta(key: string, value: string): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  const raw = window.localStorage.getItem(META_KEY)
  let parsed: Record<string, string> = {}
  if (raw) {
    try {
      parsed = JSON.parse(raw) as Record<string, string>
    } catch {
      parsed = {}
    }
  }
  parsed[key] = value
  window.localStorage.setItem(META_KEY, JSON.stringify(parsed))
}

export function storageKey(): string {
  return STORAGE_KEY
}
