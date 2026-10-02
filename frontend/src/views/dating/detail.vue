<template>
  <section class="page" data-module="dating-detail">
    <header class="page-head">
      <div>
        <h2>测年送检单详情</h2>
        <p class="page-desc">送检结论由统一判定口径产出，与清单页完全一致；校正年代只在新出报告时按送检日推算，已出报告的沿用既有值。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/dating">返回清单</RouterLink>
      </div>
    </header>

    <div v-if="!row" class="empty-state">没有找到这张测年送检单，可能已被重置或退回列表查看。</div>

    <article v-else class="detail-card">
      <div class="detail-status" :class="{ 'cell-warning': row.abnormal }">
        <span class="detail-status-label">送检结论</span>
        <strong>{{ row.送检结论 }}</strong>
      </div>
      <dl class="detail-grid">
        <div v-for="field in detailFields" :key="field" class="detail-item">
          <dt>{{ field }}</dt>
          <dd>{{ row[field] || '—' }}</dd>
        </div>
      </dl>
      <div v-if="row.退回原因" class="detail-reason">
        <span>退回原因：</span>{{ row.退回原因 }}
      </div>
    </article>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import { getDating } from '@/api/local-service'
import type { DatingRowView } from '@/data/dating'

const route = useRoute()
const row = ref<DatingRowView | null>(null)
const detailFields = ["送检编号", "样品来源", "承接实验室", "测年方法", "送检日期", "报告收到日", "校正年代", "送检状态"]

function reload() {
  const id = Number(route.params.id)
  row.value = Number.isFinite(id) ? getDating(id) : null
}

onMounted(reload)
</script>
