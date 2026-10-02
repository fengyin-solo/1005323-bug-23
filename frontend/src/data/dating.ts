import type { EntryRow } from './types'

// 测年送检判定口径（2026-10 调整后）：
// 1. 一律以「送检日期」为基准日：送检日是登记必填、且必须是合法日期；两类日期冲突时（报告收到日
//    与送检日矛盾），校正年代等推算一律按送检日处理。
// 2. 承接实验室空缺、送检日/报告收到日日期格式非法的记录不予保存（登记入口直接拒绝落库）。
// 3. 报告收到日早于送检日：直接退回（结论=已退回），并写明退回原因。
// 4. 报告收到日合法且不早于送检日：已出报告；有送检日但无收到日：已送检；其余：待送检。
// 5. 重复提交（送检编号相同）只留先到的一条。
// 6. 存量送检单按本口径重判一遍；重判前已经是「已出报告」的，沿用既有校正年代，不重算。
// 7. 清单页与详情页都只能读本模块产出的「送检结论」，口径一致。

export const DATING_STATUS = ['待送检', '已送检', '已出报告', '已退回', '已作废'] as const
export type DatingStatus = (typeof DATING_STATUS)[number]

// 校正年代的基准年（BP = Before Present，惯例 Present=1950）；纯前端脚手架里按送检日做确定性推算。
export const BP_PRESENT_YEAR = 1950

type Mode = 'submit' | 'view'

export type DatingInput = {
  送检编号?: unknown
  样品来源?: unknown
  承接实验室?: unknown
  测年方法?: unknown
  送检日期?: unknown
  校正年代?: unknown
  报告收到日?: unknown
}

export type DatingVerdict = {
  status: DatingStatus
  pending: boolean
  abnormal: boolean
  送检结论: string
  退回原因: string
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

// 只接受 YYYY-MM-DD：月、日必须真实存在（2026-02-30、2026/09/01 都判非法）。
export function parseDate(value: unknown): Date | null {
  const raw = text(value)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!match) {
    return null
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1) {
    return null
  }
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return date
}

// 以送检日为基准的校正年代：只有新登记为「已出报告」时才计算；存量重判沿用既有的校正年代。
export function calibratedAge(sendDate: Date): string {
  const bp = sendDate.getFullYear() - BP_PRESENT_YEAR
  return `约 ${bp} BP（按送检日 ${formatDate(sendDate)} 推算）`
}

export function formatDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function conclusion(status: DatingStatus, reason: string): string {
  return reason ? `${status}（${reason}）` : status
}

// 登记入口用：任何硬伤（实验室空缺、送检日非法、报告收到日格式非法）都返回 invalid=true，调用方不得保存。
export type DatingValidateResult =
  | { invalid: true; message: string }
  | { invalid: false; sendDate: Date; receiveDate: Date | null }

export function validateDatingInput(input: DatingInput, existingCodes: string[] = []): DatingValidateResult {
  const code = text(input.送检编号)
  if (!code) {
    return { invalid: true, message: '送检编号为必填项，未填写的送检单不予保存' }
  }
  if (existingCodes.includes(code)) {
    return { invalid: true, message: `送检编号 ${code} 已存在，重复提交只留存先到的一条，本条不予保存` }
  }
  if (!text(input.承接实验室)) {
    return { invalid: true, message: '承接实验室空缺，送检单不予保存，请先补全承接实验室' }
  }
  const sendDate = parseDate(input.送检日期)
  if (!sendDate) {
    return { invalid: true, message: `送检日期「${text(input.送检日期)}」格式非法（须为 YYYY-MM-DD 合法日期），送检单不予保存` }
  }
  const receiveRaw = text(input.报告收到日)
  if (receiveRaw) {
    const receiveDate = parseDate(receiveRaw)
    if (!receiveDate) {
      return { invalid: true, message: `报告收到日「${receiveRaw}」格式非法（须为 YYYY-MM-DD 合法日期），送检单不予保存` }
    }
    // 收到日早于送检日：登记时直接退回并说明原因（仍然落库留痕，但结论为已退回）。
    return { invalid: false, sendDate, receiveDate }
  }
  return { invalid: false, sendDate, receiveDate: null }
}

// 核心判定：登记、存量重判、清单/详情读取都走这里。
// mode=submit（登记/动作产生的新数据）：实验室与日期字段已由 validateDatingInput 保证合法。
// mode=view（存量/展示）：硬伤不删数据，落成「待送检」并在结论里写明原因，等业务补正。
export function adjudicateDating(row: EntryRow, mode: Mode = 'view'): DatingVerdict {
  const storedStatus = text(row.status)
  if (storedStatus === '已作废') {
    return { status: '已作废', pending: false, abnormal: false, 送检结论: '已作废', 退回原因: '' }
  }
  // 存量重判前已是已出报告：沿用既有校正年代，不重算；只要日期关系仍然成立，结论维持已出报告。
  const wasReported = storedStatus === '已出报告'

  const sendRaw = text(row.送检日期)
  const receiveRaw = text(row.报告收到日)
  const sendDate = sendRaw ? parseDate(sendRaw) : null
  const receiveDate = receiveRaw ? parseDate(receiveRaw) : null
  const reasons: string[] = []

  if (!text(row.承接实验室)) {
    reasons.push('承接实验室空缺')
  }
  // 收到日都有了却没有送检日，本身也是矛盾数据
  if (receiveRaw && !sendRaw) {
    reasons.push('送检日空缺但已登记报告收到日')
  }
  // 非空但解析不了才算「格式非法」；送检日完全空着是尚未提交的草稿，按正常待送检处理。
  if (sendRaw && !sendDate) {
    reasons.push(`送检日期「${sendRaw}」格式非法`)
  }
  if (receiveRaw && !receiveDate) {
    reasons.push(`报告收到日「${receiveRaw}」格式非法`)
  }

  const hardInvalid = reasons.length > 0
  if (hardInvalid && mode === 'submit') {
    // 理论上 validateDatingInput 已拦在外面，兜底不给出错误结论。
    return {
      status: '待送检',
      pending: true,
      abnormal: true,
      送检结论: '待送检（' + reasons.join('；') + '）',
      退回原因: reasons.join('；'),
    }
  }

  // 日期冲突（收到日早于送检日）：直接退回并说明原因；校正年代等一律以送检日为准，不按收到日算。
  if (sendDate && receiveDate && receiveDate.getTime() < sendDate.getTime()) {
    const reason = `报告收到日 ${formatDate(receiveDate)} 早于送检日 ${formatDate(sendDate)}，按送检日口径直接退回`
    return { status: '已退回', pending: false, abnormal: true, 送检结论: conclusion('已退回', reason), 退回原因: reason }
  }

  if (hardInvalid) {
    // 存量里的硬伤记录：保留落库的那条，但不能再算已送检/已出报告，退回待送检并写清原因。
    const reason = reasons.join('；') + '，按新口径退回待送检，补齐后方可提交'
    return { status: '待送检', pending: true, abnormal: true, 送检结论: conclusion('待送检', reason), 退回原因: reason }
  }

  // 既有的已出报告：日期关系合法就维持已出报告。校正年代是否沿用不在判定层处理——
  // 视图/重判函数从不改写校正年代字段，结构上保证「已出报告的沿用既有校正年代，不重算」。
  if (wasReported && receiveDate) {
    return { status: '已出报告', pending: false, abnormal: false, 送检结论: '已出报告', 退回原因: '' }
  }

  if (receiveDate && sendDate) {
    return { status: '已出报告', pending: false, abnormal: false, 送检结论: '已出报告', 退回原因: '' }
  }

  // 有送检日、无收到日：仅在实验室等字段齐全时才算已送检（硬伤已在上面拦回待送检）。
  return { status: '已送检', pending: true, abnormal: false, 送检结论: '已送检', 退回原因: '' }
}

export type DatingRowView = EntryRow & {
  送检结论: string
  退回原因: string
}

// 清单页/详情页读取时统一过一遍判定，保证两处读到的送检结论完全一致。
export function datingView(row: EntryRow): DatingRowView {
  const verdict = adjudicateDating(row, 'view')
  return {
    ...row,
    status: verdict.status,
    pending: verdict.pending,
    abnormal: verdict.abnormal,
    送检结论: verdict.送检结论,
    退回原因: verdict.退回原因,
  }
}

// 存量送检单按新口径重判：已出报告的沿用既有校正年代，不重算（adjudicateDating 内部处理）。
export function rejudgeDatingRow(row: EntryRow): EntryRow {
  const verdict = adjudicateDating(row, 'view')
  return {
    ...row,
    status: verdict.status,
    pending: verdict.pending,
    abnormal: verdict.abnormal,
    送检结论: verdict.送检结论,
    退回原因: verdict.退回原因,
  }
}

export type DatingDraft = {
  送检编号: string
  样品来源: string
  承接实验室: string
  测年方法: string
  送检日期: string
  报告收到日: string
}

// 登记入口建行：validateDatingInput 已保证实验室/日期合法，收到日早于送检日时直接落为「已退回」并写原因。
export function buildDatingRow(id: number, draft: DatingDraft): EntryRow {
  const sendDate = parseDate(draft.送检日期) as Date
  const receiveDate = draft.报告收到日 ? (parseDate(draft.报告收到日) as Date) : null
  const base: EntryRow = {
    id,
    status: '待送检',
    pending: true,
    abnormal: false,
    送检编号: draft.送检编号,
    样品来源: draft.样品来源,
    承接实验室: draft.承接实验室,
    测年方法: draft.测年方法,
    送检日期: formatDate(sendDate),
    校正年代: '',
    报告收到日: receiveDate ? formatDate(receiveDate) : '',
    送检状态: '',
    送检结论: '',
    退回原因: '',
  }
  const verdict = adjudicateDating(base, 'submit')
  // 两类日期冲突时一律按送检日处理：只有合法收到日不早于送检日，才按送检日推算校正年代。
  const 校正年代 = verdict.status === '已出报告' ? calibratedAge(sendDate) : ''
  return {
    ...base,
    status: verdict.status,
    pending: verdict.pending,
    abnormal: verdict.abnormal,
    校正年代,
    送检结论: verdict.送检结论,
    退回原因: verdict.退回原因,
  }
}
