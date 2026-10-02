<template>
  <section class="page" data-module="dating">
    <header class="page-head">
      <div>
        <h2>测年送检管理</h2>
        <p class="page-desc">判定按送检日与报告收到日的前后关系：收到日早于送检日直接退回；承接实验室空缺、日期格式非法的记录不予保存；日期冲突一律按送检日处理。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记测年送检单</button>
        <button class="btn" type="button" @click="exportRows">导出测年送检清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>送检结论</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <RouterLink v-if="column === '送检编号'" class="link" :to="`/dating/${row.id}`">
              {{ row[column] ?? '—' }}
            </RouterLink>
            <span v-else :class="{ 'cell-warning': column === '退回原因' && row[column] }">
              {{ row[column] || '—' }}
            </span>
          </td>
          <td :class="{ 'cell-warning': row.abnormal }">{{ row.送检结论 }}</td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无测年送检数据，可先登记测年送检单</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条测年送检记录</span>
      <span v-if="feedback" :class="feedbackOk ? 'ok-text' : 'error-text'">{{ feedback }}</span>
    </footer>

    <div v-if="formOpen" class="modal-mask" @click.self="closeForm">
      <form class="modal-card" @submit.prevent="submitCreate">
        <h3 class="modal-title">登记测年送检单</h3>
        <p class="modal-tip">承接实验室与送检日期为必填；收到日早于送检日的直接退回并记录原因，重复送检编号只留存先到的一条。</p>
        <label v-for="field in formFields" :key="field.key" class="modal-field">
          <span>{{ field.label }}</span>
          <input
            v-model="form[field.key]"
            :type="field.type"
            :required="field.required"
            :placeholder="field.placeholder"
          />
        </label>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn primary" type="submit">保存送检单</button>
          <button class="btn ghost" type="button" @click="closeForm">取消</button>
        </div>
      </form>
    </div>

    <div v-if="reportTarget" class="modal-mask" @click.self="closeReport">
      <form class="modal-card" @submit.prevent="submitReport">
        <h3 class="modal-title">登记报告收到日</h3>
        <p class="modal-tip">送检单 {{ reportTarget.送检编号 }} · 送检日 {{ reportTarget.送检日期 }}。早于送检日将直接退回。</p>
        <label class="modal-field">
          <span>报告收到日（YYYY-MM-DD）</span>
          <input v-model="reportDate" type="date" required />
        </label>
        <p v-if="reportError" class="error-text">{{ reportError }}</p>
        <div class="modal-actions">
          <button class="btn primary" type="submit">确认登记</button>
          <button class="btn ghost" type="button" @click="closeReport">取消</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  createDating,
  datingStats,
  downloadEntries,
  listDating,
  moduleMeta,
  registerDatingReport,
  voidDating,
} from '@/api/local-service'
import type { DatingRowView } from '@/data/dating'
import { DATING_STATUS } from '@/data/dating'
import type { DatingDraft } from '@/data/dating'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('dating')
// 送检结论单独成列，保证和详情页读到的是同一个字段。
const columns = ["送检编号", "样品来源", "承接实验室", "测年方法", "送检日期", "校正年代", "报告收到日", "退回原因"]
const filterFields = ["送检编号", "样品来源", "承接实验室"]

const rows = ref<DatingRowView[]>([])
const total = ref(0)
const feedback = ref('')
const feedbackOk = ref(false)
const filters = ref<Record<string, string>>({})
const stats = ref<{ label: string; value: number }[]>([])
const statusSummary = computed(() =>
  DATING_STATUS.map((status) => ({
    status,
    count: rows.value.filter((row) => row.status === status).length,
  })),
)

const emptyForm: DatingDraft = {
  送检编号: '',
  样品来源: '',
  承接实验室: '',
  测年方法: '',
  送检日期: '',
  报告收到日: '',
}
const formOpen = ref(false)
const form = ref<DatingDraft>({ ...emptyForm })
const formError = ref('')
const formFields = [
  { key: '送检编号', label: '送检编号', type: 'text', required: true, placeholder: '如 DATI-0005' },
  { key: '样品来源', label: '样品来源（对应出土物器物编号，校验结果回写台账）', type: 'text', required: false, placeholder: '如 FIND-0001' },
  { key: '承接实验室', label: '承接实验室', type: 'text', required: true, placeholder: '必填，空缺不予保存' },
  { key: '测年方法', label: '测年方法', type: 'text', required: false, placeholder: '如 碳十四（AMS）' },
  { key: '送检日期', label: '送检日期（YYYY-MM-DD）', type: 'date', required: true, placeholder: '' },
  { key: '报告收到日', label: '报告收到日（选填，收到时即登记）', type: 'date', required: false, placeholder: '' },
] as const

const reportTarget = ref<DatingRowView | null>(null)
const reportDate = ref('')
const reportError = ref('')

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function availableActions(row: EntryRow): string[] {
  switch (String(row.status)) {
    case '待送检':
    case '已送检':
      return ['登记报告', '作废送检']
    case '已出报告':
    case '已退回':
      return ['作废送检']
    default:
      return []
  }
}

function openCreate() {
  form.value = { ...emptyForm }
  formError.value = ''
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
}

function submitCreate() {
  const result = createDating({ ...form.value })
  if (!result.ok) {
    formError.value = result.message
    return
  }
  formOpen.value = false
  reload()
  feedback.value = result.message
  feedbackOk.value = true
}

function closeReport() {
  reportTarget.value = null
  reportDate.value = ''
  reportError.value = ''
}

function runAction(action: string, row: DatingRowView) {
  feedback.value = ''
  if (action === '登记报告') {
    reportTarget.value = row
    reportDate.value = ''
    reportError.value = ''
    return
  }
  if (action === '作废送检') {
    const result = voidDating(Number(row.id))
    if (!result.ok) {
      feedback.value = result.message
      feedbackOk.value = false
    } else {
      feedback.value = result.message
      feedbackOk.value = true
    }
    reload()
  }
}

function submitReport() {
  if (!reportTarget.value) {
    return
  }
  const result = registerDatingReport(Number(reportTarget.value.id), reportDate.value.trim())
  if (!result.ok) {
    reportError.value = result.message
    return
  }
  closeReport()
  reload()
  feedback.value = result.message
  feedbackOk.value = true
}

function reload() {
  feedback.value = ''
  try {
    const payload = listDating(filters.value)
    rows.value = payload.items
    total.value = payload.total
    stats.value = datingStats()
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : '测年送检列表读取失败'
    feedbackOk.value = false
  }
}

onMounted(reload)
</script>
