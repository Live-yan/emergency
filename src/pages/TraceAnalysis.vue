<script setup>
import { ref, onMounted, onUnmounted, watch, computed, nextTick } from 'vue'

import { useRoute } from 'vue-router'
import { fetchNotArrivedPeople } from '../api/people'
import MapLibreView from '../components/MapLibreView.vue'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'


const people = ref([])
const selected = ref(null)
const now = ref(new Date())
const mapView = ref(null)
let mapInstance = null
let clock
let destroyed = false


const showTrack = ref(true)
const showPredict = ref(true)
const showCamera = ref(true)

const customZones = ref([])
const activeZoneId = ref(null)
const editingZoneId = ref(null)
const currentMode = ref('simple_select')
const isMapReady = ref(false)

const isDrawing = computed(() => currentMode.value === 'draw_polygon')
const isEditingMode = computed(() => currentMode.value === 'direct_select')
const editingZoneName = computed(() => {
  if (!editingZoneId.value) return ''
  const zone = customZones.value.find(z => z.id === editingZoneId.value)
  return zone?.name || ''
})
const zonePanelHint = computed(() => {
  if (isDrawing.value) {
    return '正在绘制：单击地图放置顶点，双击闭合多边形完成区域。'
  }
  if (isEditingMode.value) {
    const label = editingZoneName.value ? `《${editingZoneName.value}》` : '选中的区域'
    return `正在编辑${label}，拖动顶点调整边界，完成后点击“完成编辑”。`
  }
  return '点击“新增区域”即可绘制多边形区域，可在列表中快速定位、重命名或删除。'
})
const canStartDrawing = computed(() => isMapReady.value && !isDrawing.value && !isEditingMode.value)

const baseZoom = 14
const zoomBoost = Math.log2(5)
const mapCenter = [116.3975, 39.9087]
const route = useRoute()

const emptyFc = { type: 'FeatureCollection', features: [] }

let drawControl = null
const drawEventCleanup = []
let zoneCounter = 0
const zonePalette = ['#38bdf8', '#34d399', '#f472b6', '#facc15', '#f97316', '#a855f7', '#22d3ee', '#f87171']

onMounted(async () => {
  destroyed = false
  people.value = await fetchNotArrivedPeople()
  clock = setInterval(() => (now.value = new Date()), 1000)


  const id = Number(route.query.id)
  if (id) {
    selected.value = people.value.find(p => p.id === id) || null
  }

  await nextTick()
  const map = await waitForMapInstance()
  if (!destroyed && map) {
    bindMap(map)
  }
})

onUnmounted(() => {
  destroyed = true
  clearInterval(clock)

  const map = getMap()
  if (map && drawControl) {
    drawEventCleanup.forEach(([event, handler]) => map.off(event, handler))
    map.removeControl(drawControl)
    drawControl = null
  }
  drawEventCleanup.length = 0
  mapInstance = null
  isMapReady.value = false
})

function getMap() {
  return mapInstance || mapView.value?.getMap()
}

async function waitForMapInstance() {
  const view = mapView.value
  if (!view) return null
  if (typeof view.getMap === 'function') {
    const existing = view.getMap()
    if (existing) return existing
  }
  if (typeof view.whenReady === 'function') {
    try {
      const map = await view.whenReady()
      return map || null
    } catch (err) {
      console.error(err)
      return null
    }
  }
  return null
}

function bindMap(map) {
  if (!map) return
  mapInstance = map

  const setupLayers = () => {
    const hasPeopleSource = !!map.getSource('people')
    if (!hasPeopleSource) {
      map.setZoom(map.getZoom() + zoomBoost)
      initLayers(map)
    }
    initDraw(map)
    currentMode.value = 'simple_select'
    editingZoneId.value = null
    if (drawControl) {
      syncCustomZones()
    }
    updateLayers()
    isMapReady.value = true
  }

  if (map.isStyleLoaded()) {
    setupLayers()
  } else {
    map.once('load', setupLayers)
  }
}


function initLayers(map) {
  map.addSource('people', { type: 'geojson', data: emptyFc })
  map.addLayer({
    id: 'people',
    type: 'symbol',
    source: 'people',
    layout: {
      'icon-image': 'marker-15',
      'icon-anchor': 'bottom',
      'text-field': ['get', 'name'],
      'text-size': 12,
      'text-offset': [0, 1],
    },
  })

  map.addSource('track', { type: 'geojson', data: emptyFc })
  map.addLayer({
    id: 'track',
    type: 'line',
    source: 'track',
    paint: { 'line-color': '#ef4444', 'line-width': 2 },
  })

  map.addSource('predict', { type: 'geojson', data: emptyFc })
  map.addLayer({
    id: 'predict',
    type: 'fill',
    source: 'predict',
    paint: { 'fill-color': '#fbbf24', 'fill-opacity': 0.3 },
  })

  map.addSource('cams', { type: 'geojson', data: { type: 'FeatureCollection', features: cameraFeatures() } })
  map.addLayer({
    id: 'cam-fill',
    type: 'fill',
    source: 'cams',
    paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.1 },
  })
  map.addLayer({
    id: 'cam-line',
    type: 'line',
    source: 'cams',
    paint: { 'line-color': '#3b82f6', 'line-width': 1 },
  })
}


function initDraw(map) {
  if (drawControl) return

  drawControl = new MapboxDraw({
    displayControlsDefault: false,
    defaultMode: 'simple_select',
    userProperties: true,
  })
  map.addControl(drawControl)

  const handleCreate = e => {
    e.features.forEach(f => {
      zoneCounter += 1
      const defaultName = `区域${zoneCounter}`
      const color = zonePalette[(zoneCounter - 1) % zonePalette.length]
      drawControl.setFeatureProperty(f.id, 'name', defaultName)
      drawControl.setFeatureProperty(f.id, 'color', color)
    })
    if (e.features.length) {
      activeZoneId.value = e.features[e.features.length - 1].id
    }
    syncCustomZones()
  }

  const handleUpdate = () => {
    syncCustomZones()
  }

  const handleDelete = e => {
    const removed = e.features?.map(f => f.id) || []
    syncCustomZones()
    if (removed.includes(activeZoneId.value)) {
      activeZoneId.value = null
    }
    if (removed.includes(editingZoneId.value)) {
      editingZoneId.value = null
    }
  }

  const handleSelectionChange = e => {
    const first = e.features[0]?.id || null
    activeZoneId.value = first
    if (currentMode.value === 'direct_select') {
      editingZoneId.value = first
    }
  }

  const handleModeChange = e => {
    currentMode.value = e.mode
    if (e.mode === 'direct_select') {
      editingZoneId.value = activeZoneId.value
    } else {
      editingZoneId.value = null
    }
  }

  map.on('draw.create', handleCreate)
  map.on('draw.update', handleUpdate)
  map.on('draw.delete', handleDelete)
  map.on('draw.selectionchange', handleSelectionChange)
  map.on('draw.modechange', handleModeChange)

  drawEventCleanup.push(
    ['draw.create', handleCreate],
    ['draw.update', handleUpdate],
    ['draw.delete', handleDelete],
    ['draw.selectionchange', handleSelectionChange],
    ['draw.modechange', handleModeChange]
  )

  syncCustomZones()
}

function syncCustomZones() {
  if (!drawControl) {
    customZones.value = []
    return
  }
  const features = drawControl.getAll().features || []
  const mapped = features
    .filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
    .map(f => ({
      id: f.id,
      name: f.properties?.name || '未命名区域',
      color: f.properties?.color || '#2563eb',
      geometry: f.geometry,
    }))
  customZones.value = mapped
  if (activeZoneId.value && !mapped.some(z => z.id === activeZoneId.value)) {
    activeZoneId.value = null
  }
  if (editingZoneId.value && !mapped.some(z => z.id === editingZoneId.value)) {
    editingZoneId.value = null
  }
}

function startDrawing() {
  if (!drawControl || !canStartDrawing.value) return
  drawControl.changeMode('draw_polygon')
}

function finishEditing() {
  if (!drawControl) return
  if (editingZoneId.value) {
    drawControl.changeMode('simple_select', { featureIds: [editingZoneId.value] })
  } else {
    drawControl.changeMode('simple_select')
  }
}

function selectZone(zone) {
  if (!drawControl) return
  activeZoneId.value = zone.id
  drawControl.changeMode('simple_select', { featureIds: [zone.id] })
}

function focusZone(zone) {
  selectZone(zone)
  const map = getMap()
  if (!map) return
  const bounds = geometryBounds(zone.geometry)
  if (bounds) {
    map.fitBounds(bounds, { padding: 60, duration: 600 })
  }
}

function enableEdit(zone) {
  if (!drawControl) return
  activeZoneId.value = zone.id
  editingZoneId.value = zone.id
  drawControl.changeMode('direct_select', { featureId: zone.id })
}

function removeZone(zone) {
  if (!drawControl) return
  drawControl.delete(zone.id)
}

function renameZone(zone) {
  if (!drawControl) return
  const value = zone.name ? zone.name.trim() : ''
  const finalName = value || '未命名区域'
  zone.name = finalName
  drawControl.setFeatureProperty(zone.id, 'name', finalName)
  syncCustomZones()
}

function geometryBounds(geometry) {
  if (!geometry) return null
  const coords = []
  const gather = nodes => {
    nodes.forEach(item => {
      if (Array.isArray(item[0])) {
        gather(item)
      } else if (Array.isArray(item) && item.length >= 2) {
        coords.push(item)
      }
    })
  }
  if (geometry.type === 'Polygon') {
    gather(geometry.coordinates)
  } else if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach(gather)
  } else {
    return null
  }
  if (!coords.length) return null
  let [minLng, minLat] = coords[0]
  let [maxLng, maxLat] = coords[0]
  coords.forEach(([lng, lat]) => {
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  })
  if (minLng === maxLng && minLat === maxLat) {
    const delta = 0.0005
    minLng -= delta
    maxLng += delta
    minLat -= delta
    maxLat += delta
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ]
}

function cameraFeatures() {
  const cams = [
    { lon: 116.395, lat: 39.909, width: 0.002, height: 0.001 },
    { lon: 116.401, lat: 39.905, width: 0.0018, height: 0.0012 },
  ]
  return cams.map(c => {
    const hw = c.width / 2
    const hh = c.height / 2
    return {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [c.lon - hw, c.lat - hh],
            [c.lon + hw, c.lat - hh],
            [c.lon + hw, c.lat + hh],
            [c.lon - hw, c.lat + hh],
            [c.lon - hw, c.lat - hh],
          ],
        ],

      },
    }
  })
}

function selectPerson(p) {
  selected.value = p
  const map = getMap()
  if (map && map.isStyleLoaded()) {
    map.flyTo({ center: [p.lastLon, p.lastLat], zoom: Math.max(map.getZoom(), 17) })
  }
}

function updateLayers() {
  const map = getMap()
  if (!map || !map.isStyleLoaded()) return

  const peopleSource = map.getSource('people')
  const trackSource = map.getSource('track')
  const predictSource = map.getSource('predict')
  if (!peopleSource || !trackSource || !predictSource) return

  const p = selected.value
  peopleSource.setData(p ? { type: 'FeatureCollection', features: [pointFeature(p)] } : emptyFc)
  trackSource.setData(p && showTrack.value ? { type: 'FeatureCollection', features: [lineFeature(p)] } : emptyFc)
  predictSource.setData(p && showPredict.value ? predictionFeature(p) : emptyFc)
}

watch([showTrack, showPredict], updateLayers)
watch(selected, updateLayers)
watch(showCamera, val => {
  const map = getMap()

  if (!map || !map.isStyleLoaded()) return
  const vis = val ? 'visible' : 'none'
  if (map.getLayer('cam-fill')) map.setLayoutProperty('cam-fill', 'visibility', vis)
  if (map.getLayer('cam-line')) map.setLayoutProperty('cam-line', 'visibility', vis)
})

function pointFeature(p) {
  return {
    type: 'Feature',
    properties: { name: p.name },
    geometry: { type: 'Point', coordinates: [p.lastLon, p.lastLat] },
  }
}

function lineFeature(p) {
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: p.track.map(t => [t.lon, t.lat]),
    },
  }
}

function predictionFeature(p) {
  const R = 0.0015
  const steps = 24
  const coords = []
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2
    coords.push([p.lastLon + Math.cos(a) * R, p.lastLat + Math.sin(a) * R])
  }
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } }] }
}

function formatTime(t) {
  const d = new Date(t)
  return d.toLocaleString()
}
</script>



<template>
  <div class="trace-page">
    <div class="sidebar">
      <div class="now">{{ now.toLocaleTimeString() }}</div>
      <div class="controls">
        <label><input type="checkbox" v-model="showTrack" />轨迹</label>
        <label><input type="checkbox" v-model="showPredict" />预测区域</label>
        <label><input type="checkbox" v-model="showCamera" />摄像头覆盖</label>
      </div>
      <div class="list">
        <div
          v-for="p in people"
          :key="p.id"
          class="person"
          :class="{ selected: selected && selected.id === p.id }"
          @click="selectPerson(p)"
        >
          <img :src="p.avatar" class="avatar" alt="" />
          <div class="meta">
            <div class="name-row">
              <span class="name">{{ p.name }}</span>
              <span class="tag" v-if="p.position">{{ p.position }}</span>
            </div>
            <div class="detail">岗位：{{ p.position || '未知岗位' }}</div>
            <div class="detail location">当前位置：{{ p.lastArea || '未知区域' }}</div>
            <div class="detail">最后出现：{{ formatTime(p.lastTime) }}</div>

          </div>
        </div>
      </div>
    </div>
    <div class="map-container">
      <MapLibreView ref="mapView" :center="mapCenter" :zoom="baseZoom" />
      <div class="map-overlay">
        <div class="zone-panel">
          <div class="zone-panel__header">
            <div class="zone-panel__title">自定义区域</div>
            <div class="zone-panel__actions">
              <button class="zone-btn" @click="startDrawing" :disabled="!canStartDrawing">新增区域</button>
              <button
                v-if="isEditingMode"
                class="zone-btn zone-btn--secondary"
                @click="finishEditing"
              >完成编辑</button>
            </div>
          </div>
          <div class="zone-panel__hint">{{ zonePanelHint }}</div>
          <div class="zone-panel__list">
            <div v-if="!customZones.length" class="zone-empty">
              暂无自定义区域，点击“新增区域”开始绘制。
            </div>
            <div
              v-for="zone in customZones"
              :key="zone.id"
              :class="['zone-item', { active: zone.id === activeZoneId, editing: zone.id === editingZoneId }]"
              @click="selectZone(zone)"
            >
              <div class="zone-item__row">
                <span class="zone-color" :style="{ background: zone.color }"></span>
                <input
                  class="zone-name"
                  v-model="zone.name"
                  @blur="renameZone(zone)"
                  @keyup.enter.prevent="renameZone(zone)"
                />
              </div>
              <div class="zone-item__actions">
                <button class="zone-link" @click.stop="focusZone(zone)">定位</button>
                <button
                  class="zone-link"
                  @click.stop="enableEdit(zone)"
                  :disabled="!isMapReady || isDrawing"
                >编辑</button>
                <button class="zone-link danger" @click.stop="removeZone(zone)">删除</button>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
.trace-page {
  display: flex;
  height: 100vh;
  overflow: hidden;
}
.sidebar {
  width: 320px;
  background: #f8fafc;
  border-right: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
}
.now {
  text-align: center;
  padding: 8px 0;
  border-bottom: 1px solid #e2e8f0;
  font-size: 18px;
  font-weight: 600;
  color: #0f172a;

}
.controls {
  display: flex;
  gap: 12px;
  padding: 8px;
  border-bottom: 1px solid #e2e8f0;
  flex-wrap: wrap;
}
.list {
  flex: 1;
  overflow: auto;
}
.person {
  display: flex;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid #e5e7eb;
  cursor: pointer;
  transition: background 0.2s;
}
.person:hover {
  background: #eff6ff;

}
.person.selected {
  background: #dbeafe;
}
.person .avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}
.meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #334155;
}
.name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}
.tag {
  background: #dbeafe;
  color: #1d4ed8;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 12px;
}
.detail {
  color: #475569;
}
.detail.location {
  color: #0f172a;
  font-weight: 500;
}

.map-container {
  position: relative;
  flex: 1;
}
.map-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  display: flex;
  justify-content: flex-end;
  align-items: flex-end;
  padding: 16px;
}
.zone-panel {
  pointer-events: auto;
  width: clamp(240px, 24vw, 320px);
  max-height: calc(100% - 32px);
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  box-shadow: 0 20px 40px -24px rgba(15, 23, 42, 0.85);
  display: flex;
  flex-direction: column;
  backdrop-filter: blur(6px);
}
.zone-panel__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 16px 16px 8px;
}
.zone-panel__title {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}
.zone-panel__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.zone-btn {
  border: none;
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 12px;
  cursor: pointer;
  background: #2563eb;
  color: #ffffff;
  transition: background 0.2s ease, opacity 0.2s ease;
}
.zone-btn:hover {
  background: #1d4ed8;
}
.zone-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
  background: #93c5fd;
}
.zone-btn--secondary {
  background: #0f172a;
  color: #e0f2fe;
}
.zone-btn--secondary:hover {
  background: #1e293b;
}
.zone-panel__hint {
  padding: 0 16px 12px;
  font-size: 12px;
  color: #475569;
  line-height: 1.5;
  border-bottom: 1px dashed #e2e8f0;
}
.zone-panel__list {
  padding: 12px 16px 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.zone-empty {
  font-size: 12px;
  color: #94a3b8;
  text-align: center;
  padding: 12px;
  border: 1px dashed #cbd5f5;
  border-radius: 10px;
  background: rgba(241, 245, 249, 0.6);
}
.zone-item {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.95);
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: 0 14px 30px -22px rgba(15, 23, 42, 0.9);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}
.zone-item:hover {
  transform: translateY(-1px);
}
.zone-item.active {
  border-color: #2563eb;
  box-shadow: 0 20px 32px -20px rgba(37, 99, 235, 0.55);
}
.zone-item.editing {
  border-color: #f97316;
  box-shadow: 0 20px 32px -20px rgba(249, 115, 22, 0.55);
}
.zone-item__row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.zone-color {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid #ffffff;
  box-shadow: 0 0 0 1px rgba(148, 163, 184, 0.4);
  flex-shrink: 0;
}
.zone-name {
  flex: 1;
  border: none;
  background: transparent;
  font-size: 13px;
  font-weight: 500;
  color: #0f172a;
  padding: 2px 4px;
  border-radius: 6px;
  transition: box-shadow 0.2s ease, background 0.2s ease;
}
.zone-name:focus {
  outline: none;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.3);
  background: rgba(226, 232, 240, 0.35);
}
.zone-item__actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.zone-link {
  border: none;
  background: none;
  padding: 0;
  font-size: 12px;
  color: #2563eb;
  cursor: pointer;
  transition: color 0.2s ease;
}
.zone-link:hover {
  text-decoration: underline;
}
.zone-link.danger {
  color: #dc2626;
}
.zone-link:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

@media (max-width: 1280px) {
  .zone-panel {
    width: clamp(220px, 32vw, 300px);
  }
}

@media (max-width: 1024px) {
  .sidebar {
    width: 280px;
  }
  .zone-panel {
    width: clamp(200px, 40vw, 280px);
  }
}

</style>
