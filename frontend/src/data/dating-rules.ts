import type { EntryRow } from './types'

// 测年送检判定口径：一切结论都按送检日期与报告收到日的前后关系得出。
// 清单页、详情页、统计、导出、出土物台账都从这里的判定结果取数，保证口径一致。

export const DATING_MODULE_KEY = 'dating'
export const FIND_MODULE_KEY = 'find'

const STATUS_ORDER = ['待送检', '已送检', '已出报告'] as const

export const DATING_VERDICT_FIELD = '校验说明'
export const FIND_CONCLUSION_FIELD = '测年结论'

/** 严格校验 YYYY-MM-DD；合法返回规范化字符串，非法或缺失返回 null。 */
export function parseDatingDate(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const text = value.trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) {
    return null
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return text
}

export type DatingVerdict = {
  /** false 表示记录不予保存（或报告被退回），true 表示数据本身成立。 */
  ok: boolean
  /** 按现有数据能成立的最高送检状态。 */
  status: string
  /** 退回 / 拒存原因；通过时为空串。 */
  reason: string
}

/**
 * 判定一张测年送检单：
 * - 承接实验室空缺、日期格式非法 → 不予保存；
 * - 报告收到日早于送检日期 → 退回，两类日期冲突时以送检日期为准；
 * - 有合法报告收到日且不早于送检日期 → 已出报告；否则已送检。
 */
export function judgeDatingEntry(row: EntryRow): DatingVerdict {
  const lab = String(row['承接实验室'] ?? '').trim()
  if (!lab) {
    return { ok: false, status: '待送检', reason: '承接实验室空缺，记录不予保存' }
  }
  const sent = parseDatingDate(row['送检日期'])
  if (!sent) {
    return { ok: false, status: '待送检', reason: '送检日期格式非法（应为 YYYY-MM-DD），记录不予保存' }
  }
  const rawReceived = String(row['报告收到日'] ?? '').trim()
  if (!rawReceived) {
    return { ok: true, status: '已送检', reason: '' }
  }
  const received = parseDatingDate(rawReceived)
  if (!received) {
    return { ok: false, status: '已送检', reason: '报告收到日格式非法（应为 YYYY-MM-DD），记录不予保存' }
  }
  if (received < sent) {
    return {
      ok: false,
      status: '已送检',
      reason: `报告收到日 ${received} 早于送检日期 ${sent}，报告退回，以送检日期为准`,
    }
  }
  return { ok: true, status: '已出报告', reason: '' }
}

/**
 * 存量送检单按新口径重判一条：只降不升（不替用户完成流转动作），
 * 已作废保持不动；校正年代一律沿用既有值，不重算。
 */
export function rejudgeDatingRow(row: EntryRow): EntryRow {
  if (String(row.status) === '已作废') {
    return row
  }
  const verdict = judgeDatingEntry(row)
  const claimed = STATUS_ORDER.indexOf(String(row.status) as (typeof STATUS_ORDER)[number])
  const ceiling = STATUS_ORDER.indexOf(verdict.status as (typeof STATUS_ORDER)[number])
  const status = claimed > ceiling || claimed < 0 ? verdict.status : String(row.status)
  return {
    ...row,
    status,
    pending: status !== '已出报告',
    abnormal: !verdict.ok,
    '送检状态': status,
    [DATING_VERDICT_FIELD]: verdict.reason,
  }
}

/** 重复提交（同一送检编号）只留先到的那一条。 */
export function dedupeDatingRows(rows: EntryRow[]): EntryRow[] {
  const seen = new Set<string>()
  const kept: EntryRow[] = []
  for (const row of rows) {
    const code = String(row['送检编号'] ?? '').trim()
    if (code) {
      if (seen.has(code)) {
        continue
      }
      seen.add(code)
    }
    kept.push(row)
  }
  return kept
}

/** 存量送检单整体重判：先按送检编号去重，再逐条按新口径重判。 */
export function rejudgeDatingRows(rows: EntryRow[]): EntryRow[] {
  return dedupeDatingRows(rows).map(rejudgeDatingRow)
}

/**
 * 把测年送检结论同步到出土物台账：样品来源与器物编号对上的出土物，
 * 带上最新的测年结论；同一来源有多张送检单时按先到那一条。
 */
export function applyDatingConclusionsToFinds(datingRows: EntryRow[], findRows: EntryRow[]): EntryRow[] {
  const conclusionBySource = new Map<string, string>()
  for (const row of datingRows) {
    const source = String(row['样品来源'] ?? '').trim()
    if (source && !conclusionBySource.has(source)) {
      conclusionBySource.set(source, String(row.status))
    }
  }
  return findRows.map((find) => {
    const code = String(find['器物编号'] ?? '').trim()
    const conclusion = conclusionBySource.get(code)
    if (!conclusion || find[FIND_CONCLUSION_FIELD] === conclusion) {
      return find
    }
    return { ...find, [FIND_CONCLUSION_FIELD]: conclusion }
  })
}
