import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  listRows,
  readMeta,
  resetRows,
  saveRows,
  writeMeta,
} from '@/data/local-store'
import {
  DATING_STATUS,
  adjudicateDating,
  buildDatingRow,
  calibratedAge,
  datingView,
  formatDate,
  parseDate,
  rejudgeDatingRow,
  validateDatingInput,
  type DatingDraft,
  type DatingRowView,
} from '@/data/dating'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

const DATING_KEY = 'dating'
const FIND_KEY = 'find'
const DATING_MIGRATION_KEY = 'dating:rules-2026-10'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// ── 测年送检专用服务 ─────────────────────────────────────────────────────────
// 通用 runAction 只做无脑状态翻转，测年送检必须按「送检日 ↔ 报告收到日」口径判，所以单独走这里。

export function listDating(filters: Record<string, string> = {}): { items: DatingRowView[]; total: number } {
  // 每条都过 datingView：清单页与详情页读到的送检结论由同一个判定函数产出。
  const items = filterRows(listRows(DATING_KEY), filters).map((row) => datingView(row))
  return { items, total: items.length }
}

export function getDating(id: number): DatingRowView | null {
  const row = listRows(DATING_KEY).find((item) => Number(item.id) === id)
  return row ? datingView(row) : null
}

export function datingStats(): { label: string; value: number }[] {
  const rows = listDating().items
  const now = new Date()
  const monthReports = rows.filter((row) => {
    if (row.status !== '已出报告') {
      return false
    }
    const received = parseDate(row.报告收到日)
    return !!received && received.getFullYear() === now.getFullYear() && received.getMonth() === now.getMonth()
  }).length
  return [
    { label: '待送检批次', value: rows.filter((row) => row.status === '待送检').length },
    { label: '已送检批次', value: rows.filter((row) => row.status === '已送检').length },
    { label: '本月出报告数', value: monthReports },
  ]
}

export function createDating(draft: DatingDraft): ActionResult {
  const rows = listRows(DATING_KEY)
  // 重复提交按先到那一条留存：送检编号已存在就拒收本次提交。
  const validation = validateDatingInput(draft, rows.map((row) => String(row.送检编号)))
  if (validation.invalid) {
    return { ok: false, message: validation.message }
  }
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const row = buildDatingRow(nextId, draft)
  saveRows(DATING_KEY, [...rows, row])
  syncDatingResultsToFindLedger()
  if (row.status === '已退回') {
    return { ok: true, message: `送检单 ${draft.送检编号} 已登记，但报告收到日早于送检日，已直接退回：${row.退回原因}` }
  }
  return { ok: true, message: `送检单 ${draft.送检编号} 登记成功，送检结论：${row.status}` }
}

// 「登记报告」：补录报告收到日。收到日早于送检日的直接退回并说明原因；不早于送检日才出报告，
// 校正年代一律按送检日推算（两类日期冲突时按送检日处理）。
export function registerDatingReport(id: number, receiveRaw: string): ActionResult {
  const rows = listRows(DATING_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的测年送检单` }
  }
  const current = rows[index]
  if (String(current.status) === '已作废') {
    return { ok: false, message: '该送检单已作废，不能再登记报告' }
  }
  if (!String(current.承接实验室 ?? '').trim()) {
    return { ok: false, message: '承接实验室空缺，不能登记报告，请先补全承接实验室后重新登记送检单' }
  }
  const sendDate = parseDate(current.送检日期)
  if (!sendDate) {
    return { ok: false, message: `送检日期「${String(current.送检日期 ?? '')}」格式非法，请先更正送检日期（YYYY-MM-DD）` }
  }
  const receiveDate = parseDate(receiveRaw)
  if (!receiveDate) {
    return { ok: false, message: `报告收到日「${receiveRaw}」格式非法（须为 YYYY-MM-DD 合法日期），未保存` }
  }

  const updated: EntryRow = { ...current, 报告收到日: formatDate(receiveDate) }
  const verdict = adjudicateDating(updated, 'submit')
  updated.status = verdict.status
  updated.pending = verdict.pending
  updated.abnormal = verdict.abnormal
  updated.送检结论 = verdict.送检结论
  updated.退回原因 = verdict.退回原因
  updated.送检状态 = verdict.status
  if (verdict.status === '已出报告' && !String(current.校正年代 ?? '').trim()) {
    updated.校正年代 = calibratedAge(sendDate)
  }

  const next = [...rows]
  next[index] = updated
  saveRows(DATING_KEY, next)
  syncDatingResultsToFindLedger()
  if (verdict.status === '已退回') {
    return { ok: true, message: `报告收到日早于送检日，送检单已退回：${verdict.退回原因}` }
  }
  return { ok: true, message: `报告已登记，送检结论：${verdict.status}，校正年代按送检日 ${formatDate(sendDate)} 推算` }
}

export function voidDating(id: number): ActionResult {
  const rows = listRows(DATING_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的测年送检单` }
  }
  const current = rows[index]
  const updated: EntryRow = {
    ...current,
    status: '已作废',
    pending: false,
    abnormal: false,
    送检状态: '已作废',
    送检结论: '已作废',
    退回原因: '',
  }
  const next = [...rows]
  next[index] = updated
  saveRows(DATING_KEY, next)
  syncDatingResultsToFindLedger()
  return { ok: true, message: '送检单已作废' }
}

export function resetDating(): PageResult {
  resetRows(DATING_KEY)
  migrateDatingRules()
  return { items: listDating().items, total: listDating().total, page: 1, size: listDating().total }
}

// 校验结果落到出土物台账：送检单「样品来源」对出土物「器物编号」，同一件器物的多批送检单按送检单
// 编号逐条列结论，台账上的测年校验结果与送检单送检结论始终保持一致。
export function syncDatingResultsToFindLedger(): void {
  const datingRows = listRows(DATING_KEY)
  const finds = listRows(FIND_KEY)
  const resultByFind = new Map<string, string[]>()
  for (const row of datingRows.map((item) => datingView(item))) {
    const source = String(row.样品来源 ?? '').trim()
    if (!source) {
      continue
    }
    const text = `${String(row.送检编号)}：${row.送检结论}`
    const bucket = resultByFind.get(source)
    if (bucket) {
      bucket.push(text)
    } else {
      resultByFind.set(source, [text])
    }
  }
  const next = finds.map((find) => {
    const code = String(find.器物编号 ?? '').trim()
    const result = resultByFind.get(code)
    return { ...find, 测年校验结果: result ? result.join('；') : '' }
  })
  saveRows(FIND_KEY, next)
}

// 存量送检单按新口径重判一遍（只在升级后执行一次）。
// - 已出报告的沿用既有校正年代，不重算（rejudgeDatingRow 只改判定相关字段）；
// - 承接实验室空缺、日期非法的存量记录退回待送检并写明原因；
// - 报告收到日早于送检日的判为已退回；
// - 重复送检编号按先到那一条留存。
export function migrateDatingRules(): void {
  if (readMeta(DATING_MIGRATION_KEY) === 'applied') {
    return
  }
  const rows = listRows(DATING_KEY)
  const seen = new Set<string>()
  const rejudged: EntryRow[] = []
  for (const row of rows) {
    const code = String(row.送检编号 ?? '').trim()
    if (code) {
      if (seen.has(code)) {
        continue
      }
      seen.add(code)
    }
    rejudged.push(rejudgeDatingRow(row))
  }
  saveRows(DATING_KEY, rejudged)
  syncDatingResultsToFindLedger()
  writeMeta(DATING_MIGRATION_KEY, 'applied')
}

export { DATING_STATUS }
