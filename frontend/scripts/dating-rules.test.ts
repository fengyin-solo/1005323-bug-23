import {
  applyDatingConclusionsToFinds,
  dedupeDatingRows,
  judgeDatingEntry,
  rejudgeDatingRows,
} from '@/data/dating-rules'
import { listRows, resetRows, saveRows } from '@/data/local-store'
import { runAction, saveDatingEntry } from '@/api/local-service'
import { SEED_ROWS } from '@/data/seed'
import type { EntryRow } from '@/data/types'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`ok   ${name}`)
  } else {
    failures += 1
    console.log(`FAIL ${name}`, extra ?? '')
  }
}

// ---- 判定口径 ----
check('实验室空缺不予保存', judgeDatingEntry({ '承接实验室': '', '送检日期': '2026-09-01' } as unknown as EntryRow).ok === false)
check(
  '送检日期非法不予保存',
  judgeDatingEntry({ '承接实验室': 'lab', '送检日期': '2026-9-1' } as unknown as EntryRow).ok === false,
)
check(
  '报告收到日非法不予保存',
  judgeDatingEntry({ '承接实验室': 'lab', '送检日期': '2026-09-01', '报告收到日': '昨天' } as unknown as EntryRow).ok === false,
)
const conflict = judgeDatingEntry({
  '承接实验室': 'lab',
  '送检日期': '2026-09-10',
  '报告收到日': '2026-09-05',
} as unknown as EntryRow)
check('收到日早于送检日退回', conflict.ok === false && conflict.status === '已送检' && conflict.reason.includes('早于'), conflict)
const reported = judgeDatingEntry({
  '承接实验室': 'lab',
  '送检日期': '2026-09-01',
  '报告收到日': '2026-09-10',
} as unknown as EntryRow)
check('合法报告判已出报告', reported.ok && reported.status === '已出报告')
check(
  '无报告收到日判已送检',
  judgeDatingEntry({ '承接实验室': 'lab', '送检日期': '2026-09-01' } as unknown as EntryRow).status === '已送检',
)
check(
  '2月30日算非法日期',
  judgeDatingEntry({ '承接实验室': 'lab', '送检日期': '2026-02-30' } as unknown as EntryRow).ok === false,
)

// ---- 重复提交留先到 ----
const dup = dedupeDatingRows([
  { id: 1, '送检编号': 'A' },
  { id: 2, '送检编号': 'A' },
  { id: 3, '送检编号': 'B' },
] as unknown as EntryRow[])
check('重复编号只留先到一条', dup.length === 2 && dup[0].id === 1 && dup[1].id === 3, dup)

// ---- 存量重判 ----
const rejudged = rejudgeDatingRows(SEED_ROWS['dating'])
check('重判后去重剩 5 条', rejudged.length === 5, rejudged.map((r) => r['送检编号']))
const byCode = new Map(rejudged.map((r) => [String(r['送检编号']), r]))
check('DATI-0001 实验室空缺仍待送检且标异常', byCode.get('DATI-0001')?.status === '待送检' && byCode.get('DATI-0001')?.abnormal === true)
check('DATI-0002 保持已送检', byCode.get('DATI-0002')?.status === '已送检' && byCode.get('DATI-0002')?.abnormal === false)
check('DATI-0003 保持已出报告', byCode.get('DATI-0003')?.status === '已出报告')
check('DATI-0003 校正年代不重算', byCode.get('DATI-0003')?.['校正年代'] === '距今2350±30年')
check(
  'DATI-0004 收到日早于送检日退回已送检',
  byCode.get('DATI-0004')?.status === '已送检' &&
    byCode.get('DATI-0004')?.abnormal === true &&
    String(byCode.get('DATI-0004')?.['校验说明']).includes('早于'),
  byCode.get('DATI-0004'),
)
check('DATI-0004 校正年代沿用既有值', byCode.get('DATI-0004')?.['校正年代'] === '距今1800±25年')
check('DATI-0005 实验室空缺降回待送检', byCode.get('DATI-0005')?.status === '待送检' && byCode.get('DATI-0005')?.abnormal === true)
const again = rejudgeDatingRows(rejudged)
check('重判幂等', JSON.stringify(again) === JSON.stringify(rejudged))

// ---- 校验结果落到出土物台账 ----
const finds = applyDatingConclusionsToFinds(rejudged, SEED_ROWS['find'])
const findByCode = new Map(finds.map((f) => [String(f['器物编号']), f]))
check('FIND-0001 台账带测年结论 待送检', findByCode.get('FIND-0001')?.['测年结论'] === '待送检')
check('FIND-0002 台账带测年结论 已送检', findByCode.get('FIND-0002')?.['测年结论'] === '已送检')
check('FIND-0003 台账带测年结论 已出报告', findByCode.get('FIND-0003')?.['测年结论'] === '已出报告')

// ---- 服务层：登记 ----
resetRows('dating')
let r = saveDatingEntry({ '送检编号': 'DATI-0100', '承接实验室': '', '送检日期': '2026-10-01' })
check('登记：实验室空缺不予保存', !r.ok && r.message.includes('承接实验室'), r)
r = saveDatingEntry({ '送检编号': 'DATI-0100', '承接实验室': 'lab', '送检日期': '10/01/2026' })
check('登记：日期非法不予保存', !r.ok && r.message.includes('格式非法'), r)
r = saveDatingEntry({ '送检编号': 'DATI-0100', '承接实验室': 'lab', '送检日期': '2026-10-10', '报告收到日': '2026-10-01' })
check('登记：收到日早于送检日退回', !r.ok && r.message.includes('早于'), r)
check('退回后未落库', !listRows('dating').some((row) => row['送检编号'] === 'DATI-0100'))
r = saveDatingEntry({ '送检编号': 'DATI-0100', '承接实验室': 'lab', '送检日期': '2026-10-01' })
check('登记：合法保存为已送检', r.ok && listRows('dating').find((row) => row['送检编号'] === 'DATI-0100')?.status === '已送检', r)
r = saveDatingEntry({ '送检编号': 'DATI-0100', '承接实验室': 'lab', '送检日期': '2026-10-02' })
check('登记：重复提交留先到', !r.ok && r.message.includes('重复提交'), r)
check('重复提交后仍只有一条', listRows('dating').filter((row) => row['送检编号'] === 'DATI-0100').length === 1)
r = saveDatingEntry({ '送检编号': 'DATI-0101', '承接实验室': 'lab', '送检日期': '2026-09-01', '报告收到日': '2026-09-20', '校正年代': '距今1000年' })
check('登记：带合法报告直接已出报告', r.ok && listRows('dating').find((row) => row['送检编号'] === 'DATI-0101')?.status === '已出报告', r)

// ---- 服务层：流转 ----
resetRows('dating')
const target = listRows('dating').find((row) => row['送检编号'] === 'DATI-0002')!
saveRows('dating', listRows('dating').map((row) => (row.id === target.id ? { ...row, '报告收到日': '2026-08-01' } : row)))
r = runAction('dating', Number(target.id), '登记报告')
check('流转：收到日早于送检日退回并说明原因', !r.ok && r.message.includes('早于'), r)
const after = listRows('dating').find((row) => row['送检编号'] === 'DATI-0002')!
check('退回结论落库且状态不升', after.status === '已送检' && String(after['校验说明']).includes('早于') && after.abnormal === true, after)
saveRows('dating', listRows('dating').map((row) => (row.id === target.id ? { ...row, '报告收到日': '2026-10-02' } : row)))
r = runAction('dating', Number(target.id), '登记报告')
check('流转：合法报告登记成功', r.ok && listRows('dating').find((row) => row['送检编号'] === 'DATI-0002')?.status === '已出报告', r)
const noLab = listRows('dating').find((row) => row['送检编号'] === 'DATI-0001')!
r = runAction('dating', Number(noLab.id), '提交送检')
check('流转：实验室空缺不能提交送检', !r.ok && r.message.includes('承接实验室'), r)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
