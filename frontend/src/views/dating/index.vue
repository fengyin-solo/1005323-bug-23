<template>
  <section class="page" data-module="dating">
    <header class="page-head">
      <div>
        <h2>测年送检管理</h2>
        <p class="page-desc">维护测年送检单，围绕送检编号、样品来源、承接实验室、测年方法做登记、筛选与状态流转。</p>
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
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">查看</button>
            <button
              v-for="action in actions"
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
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="detailRow" class="modal-mask" @click.self="closeDetail">
      <div class="modal-panel">
        <header class="modal-head">
          <h3>测年送检单详情 · {{ detailRow['送检编号'] }}</h3>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </header>
        <dl class="detail-list">
          <template v-for="column in columns" :key="column">
            <dt>{{ column }}</dt>
            <dd>{{ detailRow[column] ?? '—' }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd>{{ detailRow.status }}</dd>
        </dl>
        <p class="modal-note">清单页与详情页的送检结论同源读取，口径一致。</p>
      </div>
    </div>

    <div v-if="createVisible" class="modal-mask" @click.self="closeCreate">
      <form class="modal-panel" @submit.prevent="submitCreate">
        <header class="modal-head">
          <h3>登记测年送检单</h3>
          <button class="btn ghost" type="button" @click="closeCreate">取消</button>
        </header>
        <div class="form-grid">
          <label v-for="field in createFields" :key="field.name" class="form-item">
            <span>{{ field.label }}</span>
            <input
              v-model="createForm[field.name]"
              :placeholder="field.placeholder"
              :type="field.date ? 'date' : 'text'"
            />
          </label>
        </div>
        <p class="modal-note">
          承接实验室空缺、日期格式非法的记录不予保存；报告收到日早于送检日期的直接退回；
          同一送检编号重复提交按先到那一条留存。
        </p>
        <p v-if="createError" class="error-text">{{ createError }}</p>
        <footer class="modal-foot">
          <button class="btn primary" type="submit">保存送检单</button>
        </footer>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  saveDatingEntry,
} from '@/api/local-service'
import { parseDatingDate } from '@/data/dating-rules'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('dating')
const columns = ["送检编号", "样品来源", "承接实验室", "测年方法", "送检日期", "校正年代", "报告收到日", "送检状态", "校验说明"]
const actions = ["提交送检", "登记报告", "作废送检"]
const statuses = ["待送检", "已送检", "已出报告", "已作废"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

// 统计与明细同一份数据、同一判定口径，避免对不上。
const stats = computed(() => {
  const now = new Date()
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  return [
    { label: '待送检批次', value: rows.value.filter((row) => String(row.status) === '待送检').length },
    { label: '已送检批次', value: rows.value.filter((row) => String(row.status) === '已送检').length },
    {
      label: '本月出报告数',
      value: rows.value.filter(
        (row) =>
          String(row.status) === '已出报告' &&
          parseDatingDate(row['报告收到日'])?.startsWith(monthPrefix),
      ).length,
    },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const detailRow = ref<EntryRow | null>(null)
const createVisible = ref(false)
const createError = ref('')
const createForm = ref<Record<string, string>>({})
const createFields = [
  { name: '送检编号', label: '送检编号', placeholder: '如 DATI-0007', date: false },
  { name: '样品来源', label: '样品来源', placeholder: '器物编号或层位样品', date: false },
  { name: '承接实验室', label: '承接实验室', placeholder: '必填，空缺不予保存', date: false },
  { name: '测年方法', label: '测年方法', placeholder: '如 碳十四（AMS）', date: false },
  { name: '送检日期', label: '送检日期', placeholder: 'YYYY-MM-DD', date: true },
  { name: '校正年代', label: '校正年代', placeholder: '报告未回可留空', date: false },
  { name: '报告收到日', label: '报告收到日', placeholder: 'YYYY-MM-DD，可留空', date: true },
]

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  createForm.value = {}
  createError.value = ''
  createVisible.value = true
}

function closeCreate() {
  createVisible.value = false
}

function submitCreate() {
  createError.value = ''
  const result = saveDatingEntry(createForm.value)
  if (!result.ok) {
    createError.value = result.message
    return
  }
  createVisible.value = false
  reload()
}

function openDetail(row: EntryRow) {
  // 详情直接读当前行（与清单同一份落库数据），结论必然一致。
  detailRow.value = row
}

function closeDetail() {
  detailRow.value = null
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '测年送检列表读取失败'
  }
}

onMounted(reload)
</script>
