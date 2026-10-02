import {
  DATING_MODULE_KEY,
  DATING_VERDICT_FIELD,
  FIND_MODULE_KEY,
  applyDatingConclusionsToFinds,
  judgeDatingEntry,
} from '@/data/dating-rules'
import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

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

/** 测年送检结论同步到出土物台账：样品来源与器物编号对上的出土物带上最新测年结论。 */
function syncDatingConclusionsToFinds(): void {
  const finds = listRows(FIND_MODULE_KEY)
  const next = applyDatingConclusionsToFinds(listRows(DATING_MODULE_KEY), finds)
  if (JSON.stringify(next) !== JSON.stringify(finds)) {
    saveRows(FIND_MODULE_KEY, next)
  }
}

function persistDatingRows(rows: EntryRow[]): void {
  saveRows(DATING_MODULE_KEY, rows)
  syncDatingConclusionsToFinds()
}

/**
 * 登记测年送检单。判定口径：
 * - 承接实验室空缺、日期格式非法 → 不予保存；
 * - 报告收到日早于送检日期 → 退回并说明原因；
 * - 同一送检编号重复提交 → 按先到那一条留存，本次不予保存。
 */
export function saveDatingEntry(input: Record<string, string>): ActionResult {
  const meta = moduleMeta(DATING_MODULE_KEY)
  const code = String(input['送检编号'] ?? '').trim()
  if (!code) {
    return { ok: false, message: '送检编号不能为空，记录不予保存' }
  }
  const rows = listRows(DATING_MODULE_KEY)
  if (rows.some((row) => String(row['送检编号'] ?? '').trim() === code)) {
    return { ok: false, message: `送检编号 ${code} 重复提交，按先到那一条留存，本次不予保存` }
  }
  const candidate: EntryRow = {
    id: rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1,
    status: '待送检',
    pending: true,
    abnormal: false,
    '送检编号': code,
    '样品来源': String(input['样品来源'] ?? '').trim(),
    '承接实验室': String(input['承接实验室'] ?? '').trim(),
    '测年方法': String(input['测年方法'] ?? '').trim(),
    '送检日期': String(input['送检日期'] ?? '').trim(),
    '校正年代': String(input['校正年代'] ?? '').trim(),
    '报告收到日': String(input['报告收到日'] ?? '').trim(),
    '送检状态': '待送检',
    [DATING_VERDICT_FIELD]: '',
  }
  const verdict = judgeDatingEntry(candidate)
  if (!verdict.ok) {
    return { ok: false, message: verdict.reason }
  }
  const saved: EntryRow = {
    ...candidate,
    status: verdict.status,
    pending: verdict.status !== '已出报告',
    '送检状态': verdict.status,
  }
  persistDatingRows([...rows, saved])
  return { ok: true, message: `${meta.entity}已保存，当前状态「${verdict.status}」` }
}

/** 测年送检单的状态流转：先按送检日期与报告收到日的前后关系判定，校验结论随记录落库。 */
function runDatingAction(id: number, action: string): ActionResult {
  const rows = listRows(DATING_MODULE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的测年送检单` }
  }
  const row = rows[index]
  const persist = (updated: EntryRow) => {
    const next = [...rows]
    next[index] = updated
    persistDatingRows(next)
  }
  if (action === '作废送检') {
    if (String(row.status) === '已作废') {
      return { ok: false, message: '测年送检单已经是「已作废」，不用重复操作' }
    }
    persist({ ...row, status: '已作废', pending: false, abnormal: true, '送检状态': '已作废' })
    return { ok: true, message: '测年送检单已作废送检，当前状态「已作废」' }
  }
  if (String(row.status) === '已作废') {
    return { ok: false, message: '测年送检单已作废，不能再流转' }
  }
  if (action === '提交送检') {
    if (String(row.status) === '已出报告') {
      return { ok: false, message: '测年送检单已经是「已出报告」，不用重复操作' }
    }
    const verdict = judgeDatingEntry(row)
    if (!verdict.ok) {
      persist({ ...row, abnormal: true, [DATING_VERDICT_FIELD]: verdict.reason })
      return { ok: false, message: verdict.reason }
    }
    persist({
      ...row,
      status: '已送检',
      pending: true,
      abnormal: false,
      '送检状态': '已送检',
      [DATING_VERDICT_FIELD]: '',
    })
    return { ok: true, message: '测年送检单已提交送检，当前状态「已送检」' }
  }
  if (action === '登记报告') {
    if (!String(row['报告收到日'] ?? '').trim()) {
      return { ok: false, message: '尚未登记报告收到日，不能登记报告' }
    }
    const verdict = judgeDatingEntry(row)
    if (!verdict.ok || verdict.status !== '已出报告') {
      const reason = verdict.reason || '报告收到日与送检日期对不上，报告退回'
      persist({ ...row, abnormal: true, [DATING_VERDICT_FIELD]: reason })
      return { ok: false, message: reason }
    }
    persist({
      ...row,
      status: '已出报告',
      pending: false,
      abnormal: false,
      '送检状态': '已出报告',
      [DATING_VERDICT_FIELD]: '',
    })
    return { ok: true, message: '测年送检单已登记报告，当前状态「已出报告」' }
  }
  return { ok: false, message: `测年送检单没有登记「${action}」这个动作` }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  if (key === DATING_MODULE_KEY) {
    return runDatingAction(id, action)
  }
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
