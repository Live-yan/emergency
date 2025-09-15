<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { fetchNotArrivedPeople } from '../api/people'
import MapLibreView from '../components/MapLibreView.vue'

const people = ref([])
const selected = ref(null)
const now = ref(new Date())
const mapView = ref(null)
let clock

const showTrack = ref(true)
const showPredict = ref(true)
const showCamera = ref(true)

onMounted(async () => {
  people.value = await fetchNotArrivedPeople()
  clock = setInterval(() => (now.value = new Date()), 1000)
  // 若通过首页传入 id，则默认选中该人员
  const route = useRoute()
  const id = Number(route.query.id)
  if (id) {
    selected.value = people.value.find(p => p.id === id) || null
  }
  const map = mapView.value.getMap()
  map.on('load', () => {
    initLayers(map)
    updateLayers()
  })
})

onUnmounted(() => {
  clearInterval(clock)
})

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

  // 摄像头覆盖示意
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

const emptyFc = { type: 'FeatureCollection', features: [] }

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
        coordinates: [[
          [c.lon - hw, c.lat - hh],
          [c.lon + hw, c.lat - hh],
          [c.lon + hw, c.lat + hh],
          [c.lon - hw, c.lat + hh],
          [c.lon - hw, c.lat - hh],
        ]],
      },
    }
  })
}

function selectPerson(p) {
  selected.value = p
  updateLayers()
  const map = mapView.value.getMap()
  map.flyTo({ center: [p.lastLon, p.lastLat], zoom: 17 })
}

function updateLayers() {
  const map = mapView.value.getMap()
  if (!map || !map.isStyleLoaded()) return
  const p = selected.value
  map.getSource('people').setData(
    p
      ? { type: 'FeatureCollection', features: [pointFeature(p)] }
      : emptyFc
  )
  map.getSource('track').setData(
    p && showTrack.value
      ? { type: 'FeatureCollection', features: [lineFeature(p)] }
      : emptyFc
  )
  map.getSource('predict').setData(
    p && showPredict.value
      ? predictionFeature(p)
      : emptyFc
  )
}

watch([showTrack, showPredict], updateLayers)
watch(showCamera, val => {
  const map = mapView.value.getMap()
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
        <div v-for="p in people" :key="p.id" class="person" :class="{ selected: selected && selected.id === p.id }" @click="selectPerson(p)">
          <img :src="p.avatar" class="avatar" />
          <div class="meta">
            <div class="name">{{ p.name }}</div>
            <div class="detail">最后: {{ formatTime(p.lastTime) }}</div>
            <div class="detail">置信度: {{ p.confidence }}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="map-container">
      <MapLibreView ref="mapView" :center="[116.3975,39.9087]" :zoom="14" />
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
  padding: 8px 12px;
  border-bottom: 1px solid #e5e7eb;
  cursor: pointer;
}
.person.selected {
  background: #dbeafe;
}
.person .avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
}
.person .meta {
  font-size: 12px;
  color: #334155;
}
.map-container {
  position: relative;
  flex: 1;
}
</style>
