<script setup>
import { ref, computed, onMounted } from 'vue'
import { fetchArrivedPeople, fetchNotArrivedPeople } from './api/people'

const totalCount = 130 // 示例：系统总人数
const arrived = ref([])
const notArrived = ref([])

const filters = ref([
  { key: 1, label: '1号集合点', active: true },
  { key: 2, label: '2号集合点', active: true },
])

onMounted(async () => {
  const [a, n] = await Promise.all([
    fetchArrivedPeople(),
    fetchNotArrivedPeople(),
  ])
  arrived.value = a
  notArrived.value = n
})

const activeGroups = computed(() => filters.value.filter(f => f.active).map(f => f.key))
const arrivedFiltered = computed(() => arrived.value.filter(a => activeGroups.value.includes(a.group)))

function toggleFilter(key) {
  const item = filters.value.find(f => f.key === key)
  if (item) item.active = !item.active
}

// 统计
const statList = computed(() => {
  const arrivedCount = arrived.value.length
  const notArrivedCount = notArrived.value.length
  const group1 = arrived.value.filter(i => i.group === 1).length
  const group2 = arrived.value.filter(i => i.group === 2).length
  const expected = arrivedCount + notArrivedCount
  return [
    { label: '总人数', value: totalCount, color: '#5d71ff' },
    { label: '应到人数', value: expected, color: '#28c76f' },
    { label: '实到人数', value: arrivedCount, color: '#ff7a45' },
    { label: '未到场人数', value: notArrivedCount, color: '#f9c846' },
    { label: '1号集合点', value: group1, color: '#5d71ff' },
    { label: '2号集合点', value: group2, color: '#5d71ff' },
  ]
})
</script>

<template>
  <div class="page">
    <header class="summary">
      <div class="summary-left">
        <div v-for="s in statList" :key="s.label" class="summary-item">
          <div class="summary-number" :style="{ color: s.color }">{{ s.value }}</div>
          <div class="summary-label">{{ s.label }}</div>
        </div>
      </div>
      <div class="summary-actions">
        <button class="btn">数据看板</button>
        <button class="btn">实时视频</button>
        <button class="btn">查看大屏</button>
      </div>
    </header>

    <section class="panel">
      <div class="panel-title">未到人员</div>
      <div class="card-wrap">
        <div
          v-for="p in notArrived"
          :key="p.id"
          class="person-card not-arrived"
          :class="{ highlight: p.id % 6 === 0 }"
          @click="$router.push({ name: 'trace', params: { id: p.id } })"
        >
          <div class="card-head">{{ p.name }}</div>
          <div class="avatar">
            <img src="https://unpkg.com/@akryum/portrait-placeholder@1.0.0/dist/avatar-default.png" alt="avatar" />
          </div>
          <div class="info">
            <div>岗位：{{ p.position }}</div>
            <div>房间：{{ p.room }}</div>
            <div>部门：{{ p.dept }}</div>
          </div>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-title with-filters">
        <span>已到人员</span>
        <div class="filters">
          <label v-for="f in filters" :key="f.key" class="chip" :class="{ off: !f.active }">
            <input type="checkbox" :checked="f.active" @change="toggleFilter(f.key)" />
            <span class="chip-index">{{ f.key }}</span>{{ f.label }}
          </label>
        </div>
      </div>
      <div class="card-wrap">
        <div v-for="p in arrivedFiltered" :key="p.id" class="person-card arrived">
          <div class="badge">{{ p.group }}</div>
          <div class="card-head blue">{{ p.name }}</div>
          <div class="avatar">
            <img src="https://unpkg.com/@akryum/portrait-placeholder@1.0.0/dist/avatar-default.png" alt="avatar" />
          </div>
          <div class="info">
            <div>岗位：{{ p.position }}</div>
            <div>房间：{{ p.room }}</div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page {
  background: #f5f7fb;
  min-height: 100vh;
  padding: 12px;
  color: #333;
}
.summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  border: 1px solid #e6e9f0;
  border-radius: 6px;
  padding: 18px 20px;
}
.summary-left {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 28px;
}
.summary-item { text-align: center; }
.summary-number {
  font-size: 44px;
  line-height: 1;
  font-weight: 700;
}
.summary-label { color: #7a869a; margin-top: 6px; }
.summary-actions { display: flex; gap: 12px; }
.btn {
  background: #2d7eff;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 8px 14px;
  cursor: pointer;
}
.btn:hover { opacity: 0.92; }

.panel {
  background: #fff;
  border: 1px solid #e6e9f0;
  border-radius: 6px;
  margin-top: 14px;
  padding: 10px 12px 16px;
}
.panel-title {
  text-align: center;
  color: #6c7a92;
  padding: 8px 0 14px;
  border-bottom: 1px solid #e6e9f0;
}
.panel-title.with-filters {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
}
.filters { display: flex; gap: 10px; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid #d2def1;
  background: #f5f9ff;
  color: #2d7eff;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
}
.chip.off { opacity: 0.5; }
.chip input { display: none; }
.chip-index {
  display: inline-block;
  background: #ffdf2e;
  width: 18px;
  height: 18px;
  line-height: 18px;
  text-align: center;
  border-radius: 3px;
  margin-right: 4px;
}

.card-wrap {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
  padding: 14px 8px 0;
}
.person-card {
  position: relative;
  border: 1px solid #e6e9f0;
  border-radius: 6px;
  overflow: hidden;
  background: #fff;
}
.person-card .card-head {
  background: #eef2f7;
  color: #3f4d63;
  text-align: center;
  padding: 8px 0;
  font-weight: 600;
}
.person-card .card-head.blue {
  background: #1976f2;
  color: #fff;
}
.person-card .avatar {
  display: flex;
  justify-content: center;
  padding: 14px 0 6px;
}
.person-card .avatar img { width: 64px; height: 64px; border-radius: 50%; }
.person-card .info { color: #6c7a92; font-size: 12px; padding: 0 12px 12px; }
.person-card.not-arrived.highlight { box-shadow: 0 0 0 2px #2bd46c inset; }
.person-card.not-arrived.highlight .card-head { background: #d8ffe6; color: #17a24b; }

.person-card.arrived { border-color: #1976f2; }
.person-card.arrived .badge {
  position: absolute;
  left: 8px; top: 8px;
  background: #ffdf2e;
  width: 20px; height: 20px;
  border-radius: 3px;
  font-weight: 700;
  font-size: 12px;
  display: flex; align-items: center; justify-content: center;
}
</style>
