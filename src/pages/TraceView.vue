<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import MapLibreView from '../components/MapLibreView.vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchNotArrivedPeople } from '../api/people'

const route = useRoute()
const router = useRouter()
const person = ref(null)
const notArrivedList = ref([])
const selectedId = ref(null)

// 实时刷新：仅保留时钟显示
const now = ref(new Date())        // 实时钟表：每秒更新一次
let clockTimer = null

function formatTime(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
const nowText = computed(() => formatTime(now.value))

function startClock() {
  clearClock()
  clockTimer = setInterval(() => { now.value = new Date() }, 1000)
}
function clearClock(){ if (clockTimer) { clearInterval(clockTimer); clockTimer = null } }

// 已移除地图自动刷新/播放控制相关逻辑

onMounted(async () => {
  notArrivedList.value = await fetchNotArrivedPeople()
  selectedId.value = route.params.id ? String(route.params.id) : null
  startClock()
  // 页面启动时将轨迹末端时间锚定为当前时刻，避免与实时时钟脱节
  reanchorTimes(new Date())
})
onUnmounted(() => { clearClock() })

watch(selectedId, id => {
  person.value = notArrivedList.value.find(p => String(p.id) === String(id)) || null
  if (id && String(route.params.id) !== String(id)) {
    router.replace({ name: 'trace', params: { id } })
  }
  if (!id && route.params.id) {
    router.replace({ name: 'trace', params: {} })
  }
})

watch(() => route.params.id, rid => {
  if (rid && String(rid) !== String(selectedId.value)) {
    selectedId.value = String(rid)
  }
  if (!rid) {
    selectedId.value = null
  }
})

// Mock cameras as sectors (扇形)
// cx, cy are in 0..100 (SVG viewBox coords), a0/a1 in degrees
// 重绘摄像头布局：分散在各矩形区域附近，朝向厂区中心
// 先用相对布局（0..1）描述摄像头，基于容器宽高动态换算
const cameraDefs = [
  { id: 1, name: '摄像头1', zone: '生活区',   x: 0.12, y: 0.10, r: 0.18, a0: 330, a1:  60, color: '#3b82f6', online: true  },
  { id: 2, name: '摄像头2', zone: '燃气管区', x: 0.48, y: 0.10, r: 0.16, a0: 270, a1: 350, color: '#22c55e', online: true  },
  { id: 3, name: '摄像头3', zone: '仓储区',   x: 0.84, y: 0.12, r: 0.20, a0: 240, a1: 330, color: '#ef4444', online: true  },
  { id: 4, name: '摄像头4', zone: '办公区',   x: 0.10, y: 0.36, r: 0.16, a0: 350, a1: 120, color: '#8b5cf6', online: true  },
  { id: 5, name: '摄像头5', zone: '机房区',   x: 0.40, y: 0.36, r: 0.16, a0: 300, a1:  60, color: '#06b6d4', online: true  },
  { id: 6, name: '摄像头6', zone: '发电区',   x: 0.82, y: 0.40, r: 0.18, a0: 210, a1: 300, color: '#f59e0b', online: false },
  { id: 7, name: '摄像头7', zone: '生活配套', x: 0.20, y: 0.72, r: 0.18, a0: 330, a1:  60, color: '#0ea5e9', online: true  },
  { id: 8, name: '摄像头8', zone: '后勤区',   x: 0.70, y: 0.74, r: 0.20, a0: 200, a1: 300, color: '#10b981', online: true  },
]
const vbH = ref(100) // viewBox 高度（与容器比例匹配）
const mapWrapRef = ref(null)
onMounted(() => {
  const ro = new ResizeObserver((entries)=>{
    const cr = entries[0]?.contentRect
    if(!cr) return
    const w = Math.max(cr.width, 1)
    const h = Math.max(cr.height, 1)
    vbH.value = 100 * (h / w)
  })
  if (mapWrapRef.value) ro.observe(mapWrapRef.value)
})
const cameras = computed(() => cameraDefs.map(d => ({
  id: d.id, name: d.name, zone: d.zone,
  cx: d.x * 100,
  cy: d.y * vbH.value,
  r:  d.r * 100,
  a0: d.a0, a1: d.a1,
  color: d.color, online: d.online,
})))
// 最近活跃时间（示例）：初始化时生成
const camActivity = ref({})
function seedCamActivity(){
  const base = Date.now()
  const obj = {}
  for(const c of cameras.value){ obj[c.id] = new Date(base - Math.floor(Math.random()*8)*60*1000) }
  camActivity.value = obj
}
seedCamActivity()

const show = ref({ zones: true, cover: true, blind: true, predict: true, trace: true, hotspot: true })
// 地图模式：'sim' 使用内置模拟厂区；'web' 使用 MapLibre 离线/在线底图
const mapMode = ref('sim')
const selectedCam = ref(null)

// 概览模式：无 id 时默认概览；支持 query 强制
const overviewMode = ref(true)
function computeOverviewFromRoute(r){
  return !r.params.id || r.query?.overview === '1' || r.query?.mode === 'overview' || r.query?.allPredict === '1'
}
overviewMode.value = computeOverviewFromRoute(route)
watch(() => route.fullPath, () => { overviewMode.value = computeOverviewFromRoute(route) })

function setOverviewMode(v){
  overviewMode.value = v
  if (v) {
    selectedId.value = null
    router.replace({ name: 'trace', params: {} })
  } else {
    if (!selectedId.value) {
      const first = notArrivedList.value[0]?.id
      if (first != null) selectedId.value = String(first)
    }
  }
}

// 本地默认头像（来自 public/avatars/default.png）
const defaultAvatar = '/avatars/default.png'
function onAvatarError(e){ if (e?.target) e.target.src = defaultAvatar }

// 计算指定人员的预测地点（基于末段方向与盲区分布）
function predictedZoneFor(personId){
  ensureTraceData(personId)
  const data = traceStore.value[String(personId)]
  if (!data || !data.points?.length) return zones.value[0]?.name || ''
  const pts = data.points
  const end = pts[pts.length - 1]
  const prev = pts[pts.length - 2] || pts[pts.length - 1]
  const [vx0, vy0] = [end[0]-prev[0], end[1]-prev[1]]
  const L = Math.hypot(vx0, vy0) || 1
  const vx = vx0 / L, vy = vy0 / L
  const aheadMax = 28
  const corridor = 8
  const nearRadius = 20
  const tally = {}
  for (const c of blindCells.value){
    const cx = c.x + c.w/2, cy = c.y + c.h/2
    const px = cx - end[0], py = cy - end[1]
    const along = px*vx + py*vy
    if (along < 0 || along > aheadMax) continue
    const perp = Math.abs(px * (-vy) + py * vx)
    if (perp > corridor) continue
    if (Math.hypot(px, py) > nearRadius) continue
    const z = zones.value.find(z => pointInPolygon(cx, cy, z.poly))
    if (!z || z.maintain) continue
    tally[z.name] = (tally[z.name]||0) + 1
  }
  let best = ''
  let score = 0
  for (const k in tally){ if (tally[k] > score){ best = k; score = tally[k] } }
  if (best) return best
  // 回退1：如果当前点落在某个区域，返回该区域
  const currentZone = zones.value.find(z => pointInPolygon(end[0], end[1], z.poly))?.name
  if (currentZone) return currentZone
  // 回退2：选择最近的区域（按质心距离）
  if (zones.value.length){
    let minD = Infinity, nearName = zones.value[0].name
    for (const z of zones.value){
      const [cx, cy] = polygonCentroid(z.poly)
      const d = Math.hypot(end[0]-cx, end[1]-cy)
      if (d < minD){ minD = d; nearName = z.name }
    }
    return nearName
  }
  return ''
}

function back() { router.back() }

function toggleCam(c) {
  selectedCam.value = selectedCam.value?.id === c.id ? null : c
}

// Fake blind zones and predicted region (UI only)
// Basic map grid to approximate盲区/重叠显示
const gridStep = 2 // 更细网格，边缘更贴合
const cells = computed(() => {
  const arr = []
  for (let y = 0; y < vbH.value; y += gridStep) {
    for (let x = 0; x < 100; x += gridStep) {
      arr.push({ x, y, w: gridStep, h: gridStep })
    }
  }
  return arr
})

function deg2rad(a) { return (a * Math.PI) / 180 }
function normDeg(a) { return (a % 360 + 360) % 360 }

// 重绘厂区：9 个矩形区域，整幅铺满（无左右空白）
// 采用三行拼接，每行宽度之和为 1；高度分别为 0.28、0.32、0.40。
const zoneDefs = [
  // Row 1 (h = 0.28)
  { id: 'z1', name: '生活区',   color: '#60a5fa', x:0.00, y:0.00, w:0.28, h:0.28, maintain: false },
  { id: 'z2', name: '燃气管区', color: '#34d399', x:0.28, y:0.00, w:0.42, h:0.28, maintain: false },
  { id: 'z3', name: '仓储区',   color: '#fca5a5', x:0.70, y:0.00, w:0.30, h:0.28, maintain: false },
  // Row 2 (h = 0.32)
  { id: 'z4', name: '办公区',   color: '#fde68a', x:0.00, y:0.28, w:0.24, h:0.32, maintain: false },
  { id: 'z5', name: '机房区',   color: '#f59e0b', x:0.24, y:0.28, w:0.30, h:0.32, maintain: true  },
  { id: 'z6', name: '发电区',   color: '#a78bfa', x:0.54, y:0.28, w:0.46, h:0.32, maintain: false },
  // Row 3 (h = 0.40)
  { id: 'z7', name: '生活配套', color: '#93c5fd', x:0.00, y:0.60, w:0.36, h:0.40, maintain: false },
  { id: 'z8', name: '后勤区',   color: '#86efac', x:0.36, y:0.60, w:0.22, h:0.40, maintain: false },
  { id: 'z9', name: '成品区',   color: '#fbcfe8', x:0.58, y:0.60, w:0.42, h:0.40, maintain: false },
]
const zones = computed(() => zoneDefs.map(z => {
  const x0 = z.x * 100, y0 = z.y * vbH.value
  const w  = z.w * 100, h  = z.h * vbH.value
  return { id: z.id, name: z.name, color: z.color, maintain: z.maintain,
    poly: [[x0,y0],[x0+w,y0],[x0+w,y0+h],[x0,y0+h]] }
}))

function polygonCentroid(poly){
  let x=0,y=0; for(const p of poly){ x+=p[0]; y+=p[1]; } return [x/poly.length, y/poly.length]
}
function pointInPolygon(px,py,poly){
  // ray casting
  let inside=false
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const [xi,yi]=poly[i], [xj,yj]=poly[j]
    const intersect=((yi>py)!=(yj>py)) && (px < (xj-xi)*(py-yi)/(yj-yi+1e-9)+xi)
    if(intersect) inside=!inside
  }
  return inside
}

function pointInSector(px, py, cam) {
  const dx = px - cam.cx
  const dy = py - cam.cy
  const dist = Math.hypot(dx, dy)
  if (dist > cam.r) return false
  let ang = Math.atan2(dy, dx) * 180 / Math.PI
  ang = normDeg(ang)
  let a0 = normDeg(cam.a0)
  let a1 = normDeg(cam.a1)
  if (a0 <= a1) return ang >= a0 && ang <= a1
  // wrap-around case
  return ang >= a0 || ang <= a1
}

const coverageCounts = computed(() => {
  return cells.value.map(cell => {
    // 5 点采样：中心+四角，只要任一采样命中即视为覆盖
    const samples = [
      [cell.x + cell.w/2, cell.y + cell.h/2],
      [cell.x+0.5, cell.y+0.5],
      [cell.x+cell.w-0.5, cell.y+0.5],
      [cell.x+0.5, cell.y+cell.h-0.5],
      [cell.x+cell.w-0.5, cell.y+cell.h-0.5],
    ]
    const count = cameras.value.reduce((acc, cam) => {
      const hit = samples.some(([sx,sy]) => pointInSector(sx, sy, cam))
      return acc + (hit ? 1 : 0)
    }, 0)
    return { ...cell, count }
  })
})

const blindCells = computed(() => coverageCounts.value.filter(c => c.count === 0))

// 预测区域：基于轨迹末段方向，从盲区里筛选“前方走廊”网格
function dot(ax, ay, bx, by) { return ax*bx + ay*by }
function len(ax, ay) { return Math.hypot(ax, ay) }
function norm(ax, ay) { const l = len(ax, ay) || 1; return [ax/l, ay/l] }

const predictedCells = computed(() => {
  const pts = tracePoints.value
  if (!pts.length || blindCells.value.length === 0) return []
  const end = pts[pts.length - 1]
  const prev = pts[pts.length - 2] || pts[pts.length - 1]
  let [vx, vy] = norm(end[0]-prev[0], end[1]-prev[1])
  // 缩小遮罩范围
  const aheadMax = 22 // 原 28
  const corridor = 6  // 原 8
  const nearRadius = 14 // 原 20

  return blindCells.value.filter(c => {
    const cx = c.x + c.w/2, cy = c.y + c.h/2
    // 是否在末段方向的前方
    const px = cx - end[0], py = cy - end[1]
    const along = dot(px, py, vx, vy) // 投影到方向
    if (along < 0 || along > aheadMax) return false
    // 到方向线的横向距离
    const perp = Math.abs(px * (-vy) + py * vx)
    if (perp > corridor) return false
    // 限制整体半径，避免整个盲区都被选中
    if (Math.hypot(px, py) > nearRadius) return false
    // 维护中的区域不参与预测
    const zone = zones.value.find(z => pointInPolygon(cx, cy, z.poly))
    if (zone?.maintain) return false
    return true
  })
})

// 计算指定人员的预测网格（用于概览模式）
function predictedCellsForPerson(personId){
  ensureTraceData(personId)
  const data = traceStore.value[String(personId)]
  if (!data || !data.points?.length) return []
  const pts = data.points
  const end = pts[pts.length - 1]
  const prev = pts[pts.length - 2] || pts[pts.length - 1]
  let [vx, vy] = norm(end[0]-prev[0], end[1]-prev[1])
  const aheadMax = 22
  const corridor = 6
  const nearRadius = 14
  return blindCells.value.filter(c => {
    const cx = c.x + c.w/2, cy = c.y + c.h/2
    const px = cx - end[0], py = cy - end[1]
    const along = dot(px, py, vx, vy)
    if (along < 0 || along > aheadMax) return false
    const perp = Math.abs(px * (-vy) + py * vx)
    if (perp > corridor) return false
    if (Math.hypot(px, py) > nearRadius) return false
    const zone = zones.value.find(z => pointInPolygon(cx, cy, z.poly))
    if (zone?.maintain) return false
    return true
  })
}

// 所有未到人员的预测区域（合并）
const allPredicted = computed(() => {
  const items = []
  for (const p of notArrivedList.value){
    ensureTraceData(p.id)
    const data = traceStore.value[String(p.id)]
    if (!data || !data.points?.length) continue
    const pts = data.points
    const end = pts[pts.length - 1]
    const cells = predictedCellsForPerson(p.id)
    items.push({ id: String(p.id), person: p, end, cells })
  }
  return items
})

// 标签防重叠布局（概览模式用）
const LABEL_W = 18
const LABEL_H = 7
const LABEL_GAP = 2.2
const LABEL_PAD = 0.8
function rectOverlap(a,b,pad = LABEL_PAD){
  return !(a.x + a.w + pad <= b.x || a.x >= b.x + b.w + pad || a.y + a.h + pad <= b.y || a.y >= b.y + b.h + pad)
}
function expandRect(r, m){ return { x: r.x - m, y: r.y - m, w: r.w + 2*m, h: r.h + 2*m } }
const arrangedPredicted = computed(() => {
  const out = []
  const items = allPredicted.value.slice()
  // 1) 预测网格分配给距离最近的人，避免不同人员遮罩相互重叠
  const owner = new Map()
  for (const it of items){
    const ex = it.end[0], ey = it.end[1]
    for (const c of (it.cells||[])){
      const key = `${c.x},${c.y}`
      const cx = c.x + c.w/2, cy = c.y + c.h/2
      const d = Math.hypot(cx-ex, cy-ey) || 1
      const score = -d
      const cur = owner.get(key)
      if (!cur || score > cur.score) owner.set(key, { id: it.id, score })
    }
  }

  // 2) 初始放置（避免已放置标签/头像），但先不裁剪遮罩
  const placed = []
  const avatarRects = items.map(it => ({ id: it.id, x: it.end[0]-1.6, y: it.end[1]-1.6, w: 3.2, h: 3.2 }))
  items.sort((a,b)=>a.end[0]-b.end[0])
  for (const it of items){
    const ex = it.end[0], ey = it.end[1]
    function findFreeBox(){
      const radii = [0,2,3.5,5,6.5,8,10,12,14,16,18,20,22,24,26]
      const angStep = 30
      for (const r of radii){
        for (let a=0; a<360; a+=angStep){
          const rad = a * Math.PI / 180
          const dx = r * Math.cos(rad)
          const dy = r * Math.sin(rad)
          const right = dx >= 0
          const x = right ? ex + LABEL_GAP + dx : ex - LABEL_W - LABEL_GAP + dx
          const y = ey - LABEL_H/2 + dy
          const rct = { x: Math.max(0, Math.min(100 - LABEL_W, x)), y: Math.max(0, Math.min(vbH.value - LABEL_H, y)), w: LABEL_W, h: LABEL_H }
          const collidePlaced = placed.some(p => rectOverlap(rct, p, 0.8))
          const collideAvatar = avatarRects.some(av => rectOverlap(rct, expandRect(av, 0.2), 0))
          if (!collidePlaced && !collideAvatar) return rct
        }
      }
      return { x: Math.max(0, Math.min(100 - LABEL_W, ex + 1.6)), y: Math.max(0, Math.min(vbH.value - LABEL_H, ey + 2.0)), w: LABEL_W, h: LABEL_H }
    }
    const box = findFreeBox()
    placed.push(box)
    out.push({ ...it, box })
  }

  // 3) 全局冲突消解：迭代推动直到没有任何两张卡片重叠或达到迭代上限
  function anyCollision(){
    for (let i=0;i<out.length;i++){
      for (let j=i+1;j<out.length;j++){
        if (rectOverlap(out[i].box, out[j].box, 0.6)) return true
      }
    }
    for (const it of out){
      for (const av of avatarRects){ if (rectOverlap(it.box, expandRect(av, 0.2), 0)) return true }
    }
    return false
  }
  let iterations = 0
  while (anyCollision() && iterations < 300){
    for (let i=0;i<out.length;i++){
      for (let j=i+1;j<out.length;j++){
        const a = out[i].box, b = out[j].box
        if (!rectOverlap(a,b,0.6)) continue
        // 将 j 向下推开，若到边界则切换到另一侧并上移一些
        const step = 1.0
        b.y = Math.min(vbH.value - LABEL_H, b.y + step)
        if (b.y >= vbH.value - LABEL_H - 0.01){
          const ex = out[j].end[0], ey = out[j].end[1]
          const leftSide = b.x > ex
          b.x = leftSide ? Math.max(0, ex - LABEL_W - LABEL_GAP) : Math.min(100 - LABEL_W, ex + LABEL_GAP)
          b.y = Math.max(0, Math.min(vbH.value - LABEL_H, ey - LABEL_H/2))
        }
      }
    }
    // 与头像冲突则远离头像中心
    for (const it of out){
      for (const av of avatarRects){
        if (!rectOverlap(it.box, expandRect(av, 0.2), 0)) continue
        const cx = it.box.x + it.box.w/2, cy = it.box.y + it.box.h/2
        const ax = av.x + av.w/2, ay = av.y + av.h/2
        const vx = Math.sign(cx-ax) || 1, vy = Math.sign(cy-ay) || 1
        it.box.x = Math.min(100 - LABEL_W, Math.max(0, it.box.x + vx*1.2))
        it.box.y = Math.min(vbH.value - LABEL_H, Math.max(0, it.box.y + vy*1.2))
      }
    }
    iterations++
  }

  // 4) 根据最终卡片位置构建全局挖洞并裁剪遮罩
  const cutouts = []
  for (const it of out){
    const ex = it.end[0], ey = it.end[1]
    const avatar = { x: ex - 1.6, y: ey - 1.6, w: 3.2, h: 3.2 }
    cutouts.push(expandRect(it.box, 0.6), expandRect(avatar, 0.4))
  }
  for (const it of out){
    const owned = (it.cells || []).filter(c => (owner.get(`${c.x},${c.y}`)?.id === it.id))
    it.cells = owned.filter(c => !cutouts.some(h => rectOverlap(c, h, 0)))
  }
  return out
})

// 近邻聚合（概览模式）：把密集的人员点按阈值聚为一簇
const CLUSTER_MIN = 3
const CLUSTER_DIST = 6
const clusterOpen = ref({})
function toggleCluster(key){ clusterOpen.value = { ...clusterOpen.value, [key]: !clusterOpen.value[key] } }
const clusters = computed(() => {
  const items = allPredicted.value.map(it => ({ id: String(it.id), name: it.person?.name || '', pos: it.end }))
  const used = new Set()
  const res = []
  for (let i=0;i<items.length;i++){
    if (used.has(items[i].id)) continue
    const group = [items[i]]
    used.add(items[i].id)
    for (let j=i+1;j<items.length;j++){
      if (used.has(items[j].id)) continue
      const a = items[i].pos, b = items[j].pos
      if (Math.hypot(a[0]-b[0], a[1]-b[1]) <= CLUSTER_DIST){ group.push(items[j]); used.add(items[j].id) }
    }
    const cx = group.reduce((s,g)=>s+g.pos[0],0)/group.length
    const cy = group.reduce((s,g)=>s+g.pos[1],0)/group.length
    res.push({ key: `c${i}`, members: group, center:[cx,cy] })
  }
  return res
})
const collapsedIds = computed(() => {
  const set = new Set()
  for (const c of clusters.value){
    const collapsed = (c.members.length >= CLUSTER_MIN) && !clusterOpen.value[c.key]
    if (collapsed){ for (const m of c.members){ set.add(String(m.id)) } }
  }
  return set
})
const arrangedVisible = computed(() => arrangedPredicted.value.filter(it => !collapsedIds.value.has(String(it.id))))

function sectorPathD(cam) {
  const a0 = deg2rad(cam.a0)
  const a1 = deg2rad(cam.a1)
  const x0 = cam.cx + cam.r * Math.cos(a0)
  const y0 = cam.cy + cam.r * Math.sin(a0)
  const x1 = cam.cx + cam.r * Math.cos(a1)
  const y1 = cam.cy + cam.r * Math.sin(a1)
  const large = Math.abs(normDeg(cam.a1) - normDeg(cam.a0)) > 180 ? 1 : 0
  const sweep = 1
  return `M ${cam.cx},${cam.cy} L ${x0},${y0} A ${cam.r},${cam.r} 0 ${large} ${sweep} ${x1},${y1} Z`
}

// Build a mock trace path with arrows (deterministic from id)
function buildTrace(id) {
  const base = Number(id || 1)
  const pts = []
  for (let i = 0; i < 16; i++) {
    const x = (base * 7 + i * 11) % 90 + 5
    const yRaw = (base * 13 + i * 17) % 90 + 5
    const y = (yRaw / 100) * (vbH.value - 10) + 5
    pts.push([x, y])
  }
  return pts
}
// 固定轨迹点与对应时间：为每个人员只生成一次，不随刷新改变
const traceStore = ref({}) // { [id]: { points: [ [x,y] ], ts: [number], times: [ 'HH:mm:ss' ], conf: [0..1] } }
const traceAnchor = ref(new Date())

function ensureTraceData(id) {
  if (!id) return
  const key = String(id)
  if (!traceStore.value[key]) {
    const pts = buildTrace(key)
    const step = 15 // 每个点之间相隔秒数（示例）
    const end = new Date() // 末点时间锚定为初始化时的当前时间
    const ts = Array.from({ length: pts.length }, (_, i) => end.getTime() - (pts.length - 1 - i) * step * 1000)
    const times = ts.map(t => formatTime(new Date(t)))
    const conf = Array.from({ length: pts.length }, () => 0.5 + Math.random()*0.5)
    traceStore.value[key] = { points: pts, ts, times, conf }
  }
}

watch(selectedId, (id) => ensureTraceData(id), { immediate: true })
watch([selectedId, notArrivedList], () => {
  person.value = notArrivedList.value.find(p => String(p.id)===String(selectedId.value)) || null
})

const tracePoints = computed(() => {
  const key = String(selectedId.value || '')
  return traceStore.value[key]?.points || []
})

const traceTimes = computed(() => {
  const key = String(selectedId.value || '')
  return traceStore.value[key]?.times || []
})

// 已移除时间窗口、倍速与回放逻辑

function pointsInWindow(personId){
  const data = traceStore.value[String(personId)]
  if (!data) return { points: [], times: [], conf: [] }
  // 直接返回完整轨迹
  return { points: data.points, times: data.times, conf: data.conf }
}

// 多选叠加
const selectedIds = ref([]) // 叠加选中集合
const palettes = ['#2563eb','#16a34a','#dc2626','#7c3aed','#0891b2','#ea580c']
function colorFor(personId){
  const list = [String(selectedId.value), ...selectedIds.value.filter(id => id!==String(selectedId.value))]
  const idx = list.indexOf(String(personId))
  return palettes[(idx>=0?idx:0)%palettes.length]
}
// 概览模式下，为每个 id 分配稳定颜色
function overviewColor(personId){
  const s = String(personId)
  let h = 0
  for (let i=0;i<s.length;i++){ h = (h*31 + s.charCodeAt(i)) >>> 0 }
  return palettes[h % palettes.length]
}
const hideLowConf = ref(false)

// 交互：地图缩放&拖动、提示与通知
const viewScale = ref(1)
const viewPan = ref({ x: 0, y: 0 })
let panning = false
let panStart = { x: 0, y: 0 }
function onWheel(e){ const k = e.deltaY>0?0.9:1.1; viewScale.value = Math.min(3, Math.max(0.5, viewScale.value*k)) }
function onPointerDown(e){ panning = true; panStart = { x: e.clientX - viewPan.value.x, y: e.clientY - viewPan.value.y } }
function onPointerMove(e){ if(!panning) return; viewPan.value = { x: e.clientX - panStart.x, y: e.clientY - panStart.y } }
function onPointerUp(){ panning = false }
// 仅在模拟图下启用拖拽/缩放
function onWheelWrap(e){ if (mapMode.value !== 'sim') return; onWheel(e) }
function onPointerDownWrap(e){ if (mapMode.value !== 'sim') return; onPointerDown(e) }
function onPointerMoveWrap(e){ if (mapMode.value !== 'sim') return; onPointerMove(e) }
function onPointerUpWrap(){ if (mapMode.value !== 'sim') return; onPointerUp() }

const overlayStyle = computed(() => ({
  transform: `translate(${viewPan.value.x}px, ${viewPan.value.y}px) scale(${viewScale.value})`,
  transformOrigin: '0 0'
}))

function zoomIn(){ viewScale.value = Math.min(3, viewScale.value * 1.15) }
function zoomOut(){ viewScale.value = Math.max(0.5, viewScale.value / 1.15) }
function resetView(){ viewScale.value = 1; viewPan.value = { x: 0, y: 0 } }

const tooltip = ref({ show:false, x:0, y:0, lines:[] })
function showTip(e, lines){ tooltip.value = { show:true, x:e.clientX+12, y:e.clientY+12, lines } }
function hideTip(){ tooltip.value.show=false }

const notices = ref([])
function pushNotice(text){ const id=Math.random().toString(36).slice(2); notices.value.unshift({id,text}); setTimeout(()=>{ notices.value=notices.value.filter(n=>n.id!==id) },4000) }

// 热点：根据当前选中人员的可见点汇总
const hotspotPoints = computed(() => {
  const ids = [String(selectedId.value), ...selectedIds.value]
  const pts = ids.flatMap(pid => pointsInWindow(pid).points)
  if (!pts.length) return []
  // 取每隔N个点采样，防止过密
  const out = []
  for (let i=0;i<pts.length;i+=2){
    out.push({ x: pts[i][0], y: pts[i][1], r: 2.6, a: 0.25 })
  }
  return out
})

// 人员搜索与分页
const personQuery = ref('')
const pageSize = ref(8)
const pageIndex = ref(0)
const filteredPeopleAll = computed(() => {
  const q = personQuery.value.trim()
  const list = notArrivedList.value
  if (!q) return list
  return list.filter(p => p.name.includes(q) || p.room.includes(q) || p.position.includes(q) || p.dept.includes(q))
})
const totalPages = computed(() => Math.max(1, Math.ceil(filteredPeopleAll.value.length / pageSize.value)))
const pagedPeople = computed(() => {
  const start = pageIndex.value * pageSize.value
  return filteredPeopleAll.value.slice(start, start + pageSize.value)
})
function prevPage(){ pageIndex.value = Math.max(0, pageIndex.value-1) }
function nextPage(){ pageIndex.value = Math.min(totalPages.value-1, pageIndex.value+1) }

function togglePersonOverlay(id){
  const sid = String(id)
  if (sid === String(selectedId.value)) return // 主选默认叠加
  const i = selectedIds.value.indexOf(sid)
  if (i>=0) selectedIds.value.splice(i,1)
  else selectedIds.value.push(sid)
}

function reanchorTimes(to = new Date()){
  traceAnchor.value = to
  const step = 15
  for (const key in traceStore.value){
    const data = traceStore.value[key]
    if (!data) continue
    const ts = Array.from({ length: data.points.length }, (_, i) => to.getTime() - (data.points.length - 1 - i) * step * 1000)
    data.ts = ts
    data.times = ts.map(t => formatTime(new Date(t)))
  }
}

function lastSeenText(id){
  ensureTraceData(id)
  const data = traceStore.value[String(id)]
  if (!data) return ''
  const lastIdx = data.points.length-1
  const p = data.points[lastIdx]
  const zone = zones.value.find(z => pointInPolygon(p[0], p[1], z.poly))
  // 仅返回地点 + 时间，去掉相对时间描述
  return `${zone?.name||'未知'} @ ${data.times[lastIdx]}`
}

// 当前是否被摄像头看见、所在区域名
const visibleNow = computed(() => {
  const arr = tracePoints.value || []
  const p = arr.length ? arr[arr.length - 1] : null
  if(!p) return false
  return cameras.value.some(cam => pointInSector(p[0], p[1], cam))
})
const currentZoneName = computed(() => {
  const arr = tracePoints.value || []
  const p = arr.length ? arr[arr.length - 1] : null
  if(!p) return ''
  const z = zones.value.find(z => pointInPolygon(p[0], p[1], z.poly))
  return z?.name || ''
})

function zoneAtPoint(p){
  const z = zones.value.find(z => pointInPolygon(p[0], p[1], z.poly))
  return z?.name || ''
}

// 视口比例变化时，重算所有人员坐标以保持矩形地图填充
watch(vbH, () => {
  for (const key in traceStore.value){
    const pts = buildTrace(key)
    if (traceStore.value[key]) traceStore.value[key].points = pts
  }
})

const lastVisibleZoneName = computed(() => {
  const pts = tracePoints.value
  for (let i=pts.length-1;i>=0;i--){
    const p = pts[i]
    const vis = cameras.value.some(cam => pointInSector(p[0], p[1], cam))
    if (vis) return zoneAtPoint(p)
  }
  return ''
})

// 获取某人的轨迹末端点
function personEndPoint(personId){
  ensureTraceData(personId)
  const data = traceStore.value[String(personId)]
  if (!data || !data.points?.length) return null
  return data.points[data.points.length - 1]
}

// 判断某人的末端点是否被任一摄像头覆盖
function personVisibleNow(personId){
  const p = personEndPoint(personId)
  if (!p) return false
  return cameras.value.some(cam => pointInSector(p[0], p[1], cam))
}

// 目前地点：若被摄像头识别则直接显示区域名；否则显示预测区域并在末尾附加“预测”二字
function currentPlaceFor(personId){
  const p = personEndPoint(personId)
  if (!p) return predictedZoneFor(personId)
  const visible = personVisibleNow(personId)
  const zone = zoneAtPoint(p) || predictedZoneFor(personId)
  if (visible && zone) return zone
  return zone ? `${zone}（预测）` : ''
}

const predictedTopZoneName = computed(() => {
  if (!predictedCells.value.length) return ''
  const tally = {}
  for (const c of predictedCells.value){
    const cx = c.x + c.w/2, cy = c.y + c.h/2
    const z = zones.value.find(z => pointInPolygon(cx, cy, z.poly))
    if (!z) continue
    tally[z.name] = (tally[z.name]||0) + 1
  }
  let best='', score=0
  for (const k in tally){ if (tally[k]>score){ best=k; score=tally[k] } }
  return best
})

// 顶部不再显示“最后/预测”的状态汇总

// 摄像头搜索过滤（默认在线优先排序，无需按钮）
const camQuery = ref('')
const camZoneFilter = ref('')
const filteredCameras = computed(() => {
  const q = camQuery.value.trim()
  let list = cameras.value.filter(c => (!q || c.name.includes(q)) && (!camZoneFilter.value || c.zone===camZoneFilter.value))
  return list.slice().sort((a,b)=> (b.online?1:0)-(a.online?1:0))
})
</script>

<template>
  <div class="trace-page">
    <!-- 顶部去除全宽未到人员，移入左列 -->

    <div class="content">
      <div class="left-col">

      <section class="panel people-panel">
        <div class="people-head">
          <div class="left">
            <button class="back" @click="back">返回</button>
            <div class="title">轨迹研判 · 未到人员</div>
          </div>
          <input class="search" placeholder="搜索人员" v-model="personQuery" />
        </div>
        <div class="people-grid">
          <div
            v-for="p in filteredPeopleAll"
            :key="p.id"
            class="mini-card"
            :class="{ active: String(p.id) === String(selectedId) }"
            @click="selectedId = String(p.id)"
          >
            <div class="mini-head">
              <span class="badge danger">未到</span>
              <span class="name">{{ p.name }}</span>
              <label class="check"><input type="checkbox" :checked="selectedIds.includes(String(p.id)) || String(p.id)===String(selectedId)" @click.stop="togglePersonOverlay(p.id)"/>叠加</label>
            </div>
            <div class="mini-body">
              <div class="mini-avatar center"><img :src="p.avatar || defaultAvatar" @error="onAvatarError" alt="avatar" /></div>
              <div class="info-grid">
                <div class="info-item" @click.stop="setOverviewMode(false); selectedId = String(p.id)"><span class="label">岗位</span><span class="value">{{ p.position }}</span></div>
                <div class="info-item"><span class="label">房间</span><span class="value">{{ p.room }}</span></div>
                <div class="info-item"><span class="label">上次出现</span><span class="value">{{ lastSeenText(p.id) }}</span></div>
                <div class="info-item"><span class="label">目前地点</span><span class="value">{{ currentPlaceFor(p.id) }}</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="map-panel">
        <div class="panel-header">
          <div class="left">
            <label><input type="checkbox" v-model="show.zones"/> 区域</label>
            <label><input type="checkbox" v-model="show.cover"/> 覆盖区域</label>
            <label><input type="checkbox" v-model="show.blind"/> 盲区</label>
            <label><input type="checkbox" v-model="show.predict"/> 预测区域</label>
            <label><input type="checkbox" v-model="show.trace"/> 轨迹</label>
            <label><input type="checkbox" v-model="hideLowConf"/> 忽略低置信</label>
          </div>
          <div class="metrics">
            <span class="clock">{{ nowText }}</span>
          </div>
          <div class="right">
            <div class="mode-switch" role="tablist">
              <button class="btn mode" :class="{ active: overviewMode }" role="tab" aria-selected="overviewMode" @click="setOverviewMode(true)">概览模式</button>
              <button class="btn mode" :class="{ active: !overviewMode }" role="tab" aria-selected="!overviewMode" @click="setOverviewMode(false)">单人模式</button>
            </div>
            <div class="mode-switch" role="tablist" style="margin-left:8px">
              <button class="btn mode" :class="{ active: mapMode==='sim' }" @click="mapMode='sim'">模拟图</button>
              <button class="btn mode" :class="{ active: mapMode==='web' }" @click="mapMode='web'">离线地图</button>
            </div>
          </div>
        </div>

          <div class="map-wrap" ref="mapWrapRef" @wheel.prevent="onWheelWrap" @pointerdown="onPointerDownWrap" @pointermove="onPointerMoveWrap" @pointerup="onPointerUpWrap" @pointerleave="onPointerUpWrap">
          <!-- 背景：模拟图 或 Web 地图 -->
          <div class="map-bg" v-show="mapMode==='sim'"></div>
          <MapLibreView v-if="mapMode==='web'" class="webmap" />
          <svg v-show="mapMode==='sim'" class="overlay" :viewBox="`0 0 100 ${vbH}`" preserveAspectRatio="xMidYMid meet" :style="overlayStyle">
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#1d4ed8" />
              </marker>
              <!-- mask: show only NOT covered area for blind zones -->
              <mask id="notCoveredMask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="100" :height="vbH">
                <rect x="0" y="0" width="100" :height="vbH" fill="white" />
              <g>
                <path v-for="c in cameras" :key="'mk'+c.id" :d="sectorPathD(c)" fill="black"/>
              </g>
              </mask>
              <radialGradient id="hotGrad">
                <stop offset="0%" stop-color="#ef4444" />
                <stop offset="100%" stop-color="#fbbf24" />
              </radialGradient>
              <pattern id="gridPattern" width="10" height="10" patternUnits="userSpaceOnUse">
                <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#e5e7eb" stroke-width="0.4" />
              </pattern>
            </defs>
            <g>
            <rect v-if="show.zones" x="0" y="0" width="100" :height="vbH" fill="url(#gridPattern)" opacity="0.35" />
            <g v-if="show.zones">
              <g v-for="z in zones" :key="z.id" opacity="0.18">
                <polygon :points="z.poly.map(p=>p.join(',')).join(' ')" :fill="z.color" stroke="#94a3b8" stroke-width="0.2" />
                <text :x="polygonCentroid(z.poly)[0]" :y="polygonCentroid(z.poly)[1]" font-size="2.6" fill="#334155" text-anchor="middle">{{ z.name }}</text>
              </g>
            </g>
            </g>
            <g v-if="show.blind">
              <rect x="0" y="0" width="100" :height="vbH" fill="#9ca3af" opacity="0.18" mask="url(#notCoveredMask)" />
            </g>
            <g v-if="show.cover" style="mix-blend-mode:multiply">
              <path v-for="c in cameras" :key="c.id" :d="sectorPathD(c)"
                    :fill="c.color" opacity="0.14" :stroke="selectedCam?.id===c.id? c.color: c.color+'77'" stroke-width="0.4"/>
            </g>
            
            <!-- 概览模式：展示所有未到人员的预测区域与头像标注 -->
            <g v-if="mapMode==='sim' && show.predict && overviewMode">
              <!-- 聚合气泡（收起的簇） -->
              <template v-for="c in clusters" :key="c.key">
                <g v-if="c && c.members && c.members.length>=3 && !clusterOpen[c.key]" @click.stop="toggleCluster(c.key)" style="cursor:pointer">
                  <circle :cx="c.center[0]" :cy="c.center[1]" r="3.6" fill="#0ea5e9" opacity="0.22" />
                  <rect :x="c.center[0]-8" :y="c.center[1]-5" rx="1.6" width="16" height="10" fill="rgba(17,24,39,0.68)" stroke="#0ea5e9" stroke-width="0.4" />
                  <text :x="c.center[0]" :y="c.center[1]-1.0" text-anchor="middle" font-size="2.6" fill="#fff">{{ c.members.length }}人</text>
                  <text :x="c.center[0]" :y="c.center[1]+2.4" text-anchor="middle" font-size="2.2" fill="#cbd5e1">{{ c.members.slice(0,2).map(m=>m.name).join('、') }}{{ c.members.length>2?'等':'' }}</text>
                </g>
              </template>
              <!-- 展开的成员渲染 -->
              <template v-for="it in arrangedVisible" :key="'ap'+it.id">
                <rect v-for="(cell,i) in it.cells" :key="'apc'+it.id+'-'+i" :x="cell.x" :y="cell.y" :width="cell.w" :height="cell.h" :fill="overviewColor(it.id)" opacity="0.22" />
                <!-- 头像略小 + 彩色光晕，增强对应关系 -->
                <circle :cx="it.end[0]" :cy="it.end[1]" r="2.2" :fill="overviewColor(it.id)" opacity="0.18" />
                <image :href="it.person.avatar || defaultAvatar" :x="it.end[0]-1.6" :y="it.end[1]-1.6" width="3.2" height="3.2" @error="onAvatarError" />
                <!-- 自适应避让的标签：左上角为 (box.x, box.y) -->
                <g :transform="'translate(' + it.box.x + ',' + it.box.y + ')'"><!-- label group -->
                  <rect x="0" y="0" :width="LABEL_W" :height="LABEL_H" rx="1.2" fill="rgba(17,24,39,0.66)" />
                  <rect x="0" y="0" width="1.4" :height="LABEL_H" :fill="overviewColor(it.id)" opacity="0.9" />
                  <text x="2.0" y="2.8" font-size="2.2" fill="#ffffff">岗位：{{ it.person.position }}</text>
                  <text x="2.0" y="5.6" font-size="2.2" fill="#ffffff">姓名：{{ it.person.name }}</text>
                </g>
                <!-- 引导线，连接末端点与标签 -->
                <line :x1="it.end[0]" :y1="it.end[1]" :x2="it.box.x + (it.box.x > it.end[0] ? 0 : LABEL_W)" :y2="it.box.y + LABEL_H/2" :stroke="overviewColor(it.id)" stroke-width="0.4" opacity="0.8" />
              </template>
            </g>
            <!-- 单人模式：展示选中人员轨迹与预测区域 -->
            <g v-if="mapMode==='sim' && show.predict && !overviewMode">
              <rect v-for="(cell,i) in predictedCells" :key="'p'+i" :x="cell.x" :y="cell.y" :width="cell.w" :height="cell.h" fill="#f59e0b" opacity="0.28" />
            </g>
            <g v-if="mapMode==='sim' && show.trace && !overviewMode">
              <template v-for="pid in [String(selectedId), ...selectedIds]" :key="'t'+pid">
                <template v-if="pointsInWindow(pid).points.length">
                  <polyline :points="pointsInWindow(pid).points.map(p=>p.join(',')).join(' ')" fill="none" :stroke="colorFor(pid)" stroke-width="0.9" :stroke-dasharray="hideLowConf && pointsInWindow(pid).conf.some(c=>c<0.6)? '3 2': 'none'" marker-mid="url(#arrow)" marker-end="url(#arrow)" />
                  <g :fill="colorFor(pid)">
                    <circle v-for="(p,i) in pointsInWindow(pid).points" :key="'pt'+pid+i" :cx="p[0]" :cy="p[1]" r="1.2" :opacity="pointsInWindow(pid).conf[i]<0.6? 0.4: 1" />
                  </g>
                  <g class="labels" fill="#0f172a">
                    <text v-for="(p,i) in pointsInWindow(pid).points" :key="'lbl'+pid+i" :x="p[0] + 1.8" :y="p[1] - 1.0" font-size="3.2" stroke="#ffffff" stroke-width="0.8">{{ pointsInWindow(pid).times[i] }}</text>
                  </g>
                </template>
              </template>
            </g>
            <g v-if="show.hotspot">
              <circle v-for="(h,idx) in hotspotPoints" :key="'h'+idx" :cx="h.x" :cy="h.y" :r="h.r" fill="url(#hotGrad)" :opacity="h.a" />
            </g>
          </svg>
          <div class="legend" v-show="mapMode==='sim'">
            <span class="dot blue"></span>覆盖 <span class="dot gray"></span>盲区 <span class="dot orange"></span>预测
          </div>
          <div v-if="tooltip.show" class="tooltip" :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }">
            <div v-for="(t,i) in tooltip.lines" :key="i">{{ t }}</div>
          </div>
          <div class="toasts">
            <div v-for="n in notices" :key="n.id" class="toast">{{ n.text }}</div>
          </div>
          <!-- 视图缩放控件 -->
          <div class="zoom-controls" v-show="mapMode==='sim'">
            <button class="zbtn" @click.stop="zoomOut">-</button>
            <button class="zbtn" @click.stop="resetView">100%</button>
            <button class="zbtn" @click.stop="zoomIn">+</button>
          </div>
        </div>

        <div class="status-bar">
          <div class="chip" :class="{ ok: visibleNow, warn: !visibleNow }">
            <span class="label">当前</span>
            <span class="val">{{ visibleNow ? (currentZoneName || '未知区域') : '未被摄像头覆盖' }}</span>
          </div>
          <div class="chip">
            <span class="label">最后</span>
            <span class="val">{{ lastVisibleZoneName || '未知' }}</span>
          </div>
          <div class="chip">
            <span class="label">预测</span>
            <span class="val">{{ predictedTopZoneName || '—' }}</span>
          </div>
          <div class="sep"></div>
        </div>
      </section>

      </div>

      <aside class="video-panel panel">
        <div class="panel-header">
          <div>摄像头</div>
          <div class="right cam-tools">
            <select v-model="camZoneFilter">
              <option value="">全部区域</option>
              <option v-for="z in zones" :key="z.id" :value="z.name">{{ z.name }}</option>
            </select>
            <input placeholder="搜索摄像头" class="search" v-model="camQuery">
          </div>
        </div>
        <div class="videos side">
          <div
            v-for="c in filteredCameras"
            :key="c.id"
            class="video-card"
            :class="{selected: selectedCam?.id===c.id}"
            @click="toggleCam(c)"
          >
            <div class="tag" :style="{background: c.color}">{{ c.name }}</div>
            <div class="screen">
              <span class="cam-dot" :class="{ on: c.online }"></span>
              <span class="cam-meta">{{ c.zone }} · 最近: {{ formatTime(camActivity[c.id] || new Date()) }}</span>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.trace-page { padding: 12px; height: 100vh; display: flex; flex-direction: column; }
:root {
  --bg: #f5f7fb;
  --panel-bg: #5f4b4b;
  --panel-border: #e6e9f0;
  --panel-shadow: 0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.08);
  --text: #334155;
  --muted: #64748b;
  --brand: #3b82f6;
  --brand-600: #2563eb;
  --brand-700: #1d4ed8;
  --chip-bg: #eef6ff;
  --chip-border: #d6e4ff;
  --surface-subtle: #fbfdff;
  --divider: #eef2f7;
  --ok-bg: #dcfce7;
  --ok-fg: #166534;
  --warn-bg: #fee2e2;
  --warn-fg: #991b1b;
}
.toolbar {
  display: grid; grid-template-columns: 80px 1fr; align-items: center;
  gap: 12px; background: #fff; border: 1px solid #e6e9f0; border-radius: 6px; padding: 8px 12px;
}
.back { background: var(--brand-600); color: #fff; border: 1px solid var(--brand-700); border-radius: 8px; padding: 8px 12px; cursor: pointer; font-weight: 600; box-shadow: 0 1px 2px rgba(16,24,40,.1); }
.back:hover { background: var(--brand-700); }
.back:focus-visible { outline: 2px solid #93c5fd; outline-offset: 2px; }
.title { font-weight: 700; color: #334155; }
.person .name { display:none; }
.person .meta { display:none; }
.selector { display:none; }
.metrics { display: flex; align-items: center; gap: 10px; color: #475569; }
.metrics .clock { font-weight: 800; color: #0f172a; font-size: 18px; letter-spacing: .3px; }


.content { display: grid; grid-template-columns: 3fr 1fr; gap: 12px; margin-top: 12px; flex: 1; min-height: 0; }
.left-col { display: flex; flex-direction: column; gap: 12px; }

.map-panel, .video-panel, .camera-panel, .side-panel, .people-panel { background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: 8px; overflow: hidden; box-shadow: var(--panel-shadow); }
.panel-header { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--divider); background: var(--surface-subtle); }
.panel-header .left { display:flex; gap:8px; white-space:nowrap; overflow:auto; scrollbar-width: thin; -ms-overflow-style: none; }
.panel-header .left::-webkit-scrollbar{ height:6px }
.panel-header .left label { margin-right: 0; color: #475569; border:1px solid var(--chip-border); background: var(--chip-bg); padding:4px 10px; border-radius: 999px; display:inline-flex; align-items:center; gap:6px; font-size:12px; }
.panel-header .left label input{ accent-color: var(--brand); }
.panel-header .metrics, .panel-header .right { white-space:nowrap; display:flex; align-items:center; gap:10px; }
.mode-switch { display:flex; align-items:center; gap:0; border:1px solid var(--brand-700); border-radius: 999px; overflow:hidden; background:#fff; box-shadow: 0 2px 6px rgba(37,99,235,.08); }
.btn.mode { border: none; background: transparent; color: var(--brand-700); padding: 8px 16px; font-weight: 700; font-size: 13px; cursor: pointer; }
.btn.mode.active { background: var(--brand-600); color:#fff; }
.btn.mode:not(.active):hover { background: #eef2ff; }
.btn.small {
  border: 1px solid var(--brand-700);
  background: var(--brand-600);
  color: #fff;
  padding: 10px 16px;
  border-radius: 10px;
  cursor: pointer;
  font-weight: 700;
  font-size: 14px;
  letter-spacing: .2px;
  box-shadow: 0 2px 6px rgba(37, 99, 235, .25), 0 1px 2px rgba(16,24,40,.1);
  transition: background .15s ease, transform .05s ease, box-shadow .15s ease;
}
/* Ensure buttons above the map are solid blue and readable */
.panel-header .metrics .btn.small,
.panel-header .right .btn.small {
  background: var(--brand-600, #2563eb) !important;
  border-color: var(--brand-700, #1d4ed8) !important;
  color: #fff !important;
}
.panel-header .metrics .btn.small:disabled,
.panel-header .right .btn.small:disabled {
  opacity: 1 !important; /* 保持蓝底的可读性 */
}
.btn.small:hover { background: var(--brand-700); box-shadow: 0 3px 10px rgba(37, 99, 235, .32), 0 1px 2px rgba(16,24,40,.12); }
.btn.small:active { transform: translateY(1px); box-shadow: 0 1px 4px rgba(37, 99, 235, .22); }
.btn.small:focus-visible { outline: 2px solid #93c5fd; outline-offset: 2px; }
.btn.small:disabled { opacity: .6; cursor: not-allowed; box-shadow: none; }

.map-wrap { position: relative; height: 56vh; min-height: 460px; background: linear-gradient(180deg,#fcfdff, #f7f9fc); border-top: 1px solid var(--divider); }
.webmap { position:absolute; inset:0; }
.tooltip { position:absolute; background:#111827; color:#fff; font-size:12px; padding:6px 8px; border-radius:6px; box-shadow: var(--panel-shadow); pointer-events:none; opacity:.95 }
.toasts { position:absolute; right:12px; top:12px; display:flex; flex-direction:column; gap:6px; }
.toast { background:#111827; color:#fff; padding:6px 10px; border-radius:6px; font-size:12px; box-shadow: var(--panel-shadow); opacity:.92 }
.zoom-controls{ position:absolute; right:8px; top:8px; display:flex; gap:6px; z-index:2 }
.zbtn{ border:1px solid #cbd5e1; background:#fff; border-radius:6px; padding:4px 8px; cursor:pointer; font-weight:700; color:#334155; box-shadow: var(--panel-shadow) }
.zbtn:hover{ background:#f1f5f9 }
.map-bg { position: absolute; inset: 0; background-image: linear-gradient(90deg,#fbfdff 24%, #f6f8fb 25%, #f6f8fb 26%, #fbfdff 27%), linear-gradient(#fbfdff 24%, #eef2f7 25%, #eef2f7 26%, #fbfdff 27%); background-size: 46px 46px; filter: saturate(.9) contrast(.98); }
.overlay { position: absolute; inset: 0; width: 100%; height: 100%; }
.overlay .labels text { font-weight: 700; paint-order: stroke; }
.legend { position: absolute; left: 10px; bottom: 10px; background: rgba(255,255,255,.92); border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 10px; font-size: 12px; color: #374151; display: flex; gap: 10px; align-items: center; box-shadow: var(--panel-shadow); }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin: 0 4px 0 2px; }
.dot.blue { background: #3b82f6; }
.dot.purple { background: #9333ea; }
.dot.gray { background: #9ca3af; }
.dot.orange { background: #f59e0b; }
.pulse { animation: pulse 2s infinite ease-in-out; }
@keyframes pulse { 0%,100%{ opacity: .18 } 50%{ opacity: .35 } }

.timeline { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-top: 1px solid #eef2f7; }
.timeline input[type="range"]{ flex: 1; }
.timeline .ts { color: #64748b; font-size: 12px; }

.video-panel { display: flex; flex-direction: column; height: 100%; }
.videos { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 10px; }
.videos.wide { grid-template-columns: repeat(3, 1fr); }
.videos.side { grid-template-columns: 1fr; flex: 1; overflow: auto; }
.video-card { position: relative; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; cursor: pointer; background: #0b1220; color: #94a3b8; aspect-ratio: 16 / 9; box-shadow: var(--panel-shadow); }
.video-card .tag { position: absolute; left: 8px; top: 8px; color: #fff; font-size: 12px; padding: 2px 6px; border-radius: 3px; }
.video-card .screen { position: absolute; inset: 0; display: grid; place-items: center; opacity: .7; color: #cbd5e1; font-size: 12px; }
.video-card.selected { outline: 2px solid #2d7eff; }
.search { border: 1px solid #e5e7eb; padding: 5px 8px; border-radius: 4px; }
.cam-tools { display:flex; align-items:center; gap:8px; }
.cam-dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:#9ca3af; margin-right:6px; }
.cam-dot.on { background:#22c55e; }
.cam-meta { font-size:12px; opacity:.9; }

/* mini people cards */
.panel.mini { margin-top: 12px; }
.people-head { display:flex; align-items:center; justify-content: space-between; padding:12px; background:#f8fafc; border-bottom:1px solid var(--divider); }
.people-head .left { display:flex; align-items:center; gap:10px; }
.people-head .title{ font-weight:700; color:#334155; white-space:nowrap; }
.people-head .search{ border:1px solid #cbd5e1; padding:6px 10px; border-radius:6px; background:#fff; color:#0f172a; min-width: 200px; }
.people-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 180px)); gap:8px; padding: 10px; max-height: 160px; overflow-y: auto; justify-content: center; }
.mini-card { border: 1px solid #cbd5e1; border-radius: 8px; background: #ffffff; cursor: pointer; width: 100%; transition: border-color .15s ease, background-color .15s ease, transform .15s ease; }
.mini-card:hover { border-color: #3b82f6; background: #fafcff; }
.mini-card.active { border-color: #22c55e; }
.mini-head { display:grid; grid-template-columns: auto 1fr auto; align-items:center; gap:6px; background: #f8fafc; color: #0f172a; padding: 4px 8px; font-weight: 600; font-size: 11px; border-bottom:1px solid #e2e8f0; }
.mini-head .name { font-weight: 700; text-align: center; }
.badge { font-size: 10px; padding: 1px 6px; border-radius: 999px; background:#e5e7eb; color:#374151; }
.badge.danger { background: #fee2e2; color: #991b1b; }
.mini-body { padding: 6px 8px 6px; color: #475569; font-size: 12px; }
.mini-avatar { display:flex; justify-content: center; margin-bottom: 6px; }
.mini-avatar img { width: 28px; height: 28px; border-radius: 50%; }
.info-grid { display:grid; grid-template-columns: 1fr; gap: 4px 6px; }
.info-item { display:flex; flex-direction: row; align-items: center; gap: 4px; min-width: 0; }
.info-item .label { color:#64748b; font-size: 10px; line-height: 1.2; }
.info-item .label::after { content: '：'; }
.info-item .value { color:#334155; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2; }
.info-item.span2 { grid-column: 1 / -1; }
.mini-row { line-height: 1.4; }
.mini-row + .mini-row { border-top: 1px dashed #e2e8f0; margin-top: 6px; padding-top: 6px; }
.mini-row.tip { color:#64748b; font-size:11px; }
.check { font-weight:500; color:#334155; }
.check input { vertical-align: -1px; margin-right: 4px; accent-color: #3b82f6; }
.mini-pager { display:none; }

/* 更柔和的轨迹时间标签 */
.overlay .labels text { font-weight: 700; paint-order: stroke; stroke-width: .4; opacity:.98 }
.side-list { display: flex; flex-direction: column; gap: 8px; padding: 10px; max-height: 760px; overflow: auto; }

/* 状态总览条 */
.status-bar { display:flex; align-items:center; gap:10px; padding: 10px 12px; border-top: 1px solid var(--divider); background: #fff; }
.status-bar .chip { display:flex; align-items:center; gap:6px; border:1px solid #e5e7eb; background:#fff; border-radius:999px; padding:6px 10px; font-size:12px; color:#0f172a; }
.status-bar .chip .label{ color:#64748b }
.status-bar .chip.ok{ background: var(--ok-bg); border-color: #bbf7d0; }
.status-bar .chip.warn{ background: var(--warn-bg); border-color: #fecaca; }
.status-bar .sep{ flex:1 }
.status-bar .muted{ color:#64748b; font-size:12px }

/* 响应式布局优化 */
@media (max-width: 1200px) {
  .content { grid-template-columns: 1fr; }
  .map-wrap { height: 50vh; }
}
@media (max-width: 768px) {
  .people-head { flex-wrap: wrap; gap: 10px; }
  .panel-header { grid-template-columns: 1fr; gap: 8px; }
  .panel-header .metrics { flex-wrap: wrap; gap: 8px; }
  .overlay .labels text { font-size: 2.6px; }
}
</style>
