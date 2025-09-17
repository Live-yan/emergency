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
let hasFittedInitialView = false
let pendingFocus = null


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
const mapInteractionCleanup = []
let zoneCounter = 0
const zonePalette = ['#38bdf8', '#34d399', '#f472b6', '#facc15', '#f97316', '#a855f7', '#22d3ee', '#f87171']

const peopleClusterSourceId = 'people-all'
const avatarImagePromises = new Map()
const labelBackgroundId = 'person-label-bg'

onMounted(async () => {
  destroyed = false
  hasFittedInitialView = false
  pendingFocus = null
  people.value = await fetchNotArrivedPeople()
  clock = setInterval(() => (now.value = new Date()), 1000)


  const id = Number(route.query.id)
  if (id) {
    const target = people.value.find(p => p.id === id) || null
    if (target) {
      selected.value = target
      focusPersonOnMap(target, { instant: true, preserveZoom: true })
    }
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
  hasFittedInitialView = false
  pendingFocus = null

  const map = getMap()
  if (map && drawControl) {
    drawEventCleanup.forEach(([event, handler]) => map.off(event, handler))
    map.removeControl(drawControl)
    drawControl = null
  }
  drawEventCleanup.length = 0
  if (map) {
    mapInteractionCleanup.forEach(([event, layer, handler]) => {
      if (typeof layer === 'string' && handler) {
        map.off(event, layer, handler)
      } else if (handler) {
        map.off(event, handler)
      }
    })
  }
  mapInteractionCleanup.length = 0
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

  const setupLayers = async () => {
    const hasPeopleSource = !!map.getSource('people')
    if (!hasPeopleSource) {
      map.setZoom(map.getZoom() + zoomBoost)
      initLayers(map)
    }
    if (!mapInteractionCleanup.length) {
      registerPeopleInteractions(map)
    }
    initDraw(map)
    currentMode.value = 'simple_select'
    editingZoneId.value = null
    if (drawControl) {
      syncCustomZones()
    }
    updateLayers()
    await refreshPeopleSource()
    isMapReady.value = true

    if (pendingFocus && pendingFocus.id) {
      const target = people.value.find(p => p.id === pendingFocus.id)
      if (target) {
        const options = pendingFocus.options || {}
        focusPersonOnMap(target, { ...options, instant: true })
      }
    } else if (!hasFittedInitialView) {
      fitMapToPeople()
    }
  }

  if (map.isStyleLoaded()) {
    setupLayers()
  } else {
    map.once('load', setupLayers)
  }
}


function initLayers(map) {
  ensureLabelBackground(map)
  map.addSource('predict', { type: 'geojson', data: emptyFc })
  map.addLayer({
    id: 'predict',
    type: 'fill',
    source: 'predict',
    paint: { 'fill-color': '#fbbf24', 'fill-opacity': 0.3 },
  })

  map.addSource('track', { type: 'geojson', data: emptyFc })
  map.addLayer({
    id: 'track',
    type: 'line',
    source: 'track',
    paint: { 'line-color': '#ef4444', 'line-width': 2 },
  })

  map.addSource('people', { type: 'geojson', data: emptyFc })
  map.addLayer({
    id: 'people-focus',
    type: 'circle',
    source: 'people',
    paint: {
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        12,
        18,
        18,
        28,
      ],
      'circle-color': '#f97316',
      'circle-opacity': 0.22,
      'circle-stroke-color': '#f97316',
      'circle-stroke-width': 2,
    },
  })

  map.addSource(peopleClusterSourceId, {
    type: 'geojson',
    data: emptyFc,
    cluster: true,
    clusterRadius: 64,
    clusterMaxZoom: 16,
  })

  map.addLayer({
    id: 'people-clusters',
    type: 'circle',
    source: peopleClusterSourceId,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#2563eb',
      'circle-opacity': 0.85,
      'circle-radius': [
        'step',
        ['get', 'point_count'],
        20,
        10,
        26,
        25,
        34,
        50,
        42,
      ],
    },
  })

  map.addLayer({
    id: 'people-cluster-count',
    type: 'symbol',
    source: peopleClusterSourceId,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count'],
      'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
      'text-size': 12,
    },
    paint: {
      'text-color': '#ffffff',
    },
  })

  map.addLayer({
    id: 'people-avatars',
    type: 'symbol',
    source: peopleClusterSourceId,
    filter: ['!', ['has', 'point_count']],
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-size': [
        'case',
        ['==', ['get', 'selected'], 1],
        0.58,
        0.48,
      ],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  })

  map.addLayer({
    id: 'people-labels',
    type: 'symbol',
    source: peopleClusterSourceId,
    minzoom: 12,
    filter: ['!', ['has', 'point_count']],
    layout: {
      'icon-image': labelBackgroundId,
      'icon-size': 1,
      'icon-anchor': 'left',
      'text-anchor': 'left',
      'icon-allow-overlap': false,
      'text-field': ['get', 'label'],
      'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
      'text-size': 12,
      'text-line-height': 1.3,
      'text-offset': [1.1, 0],
      'icon-offset': [1.1, 0],
      'icon-text-fit': 'both',
      'icon-text-fit-padding': [12, 18, 14, 18],
      'text-max-width': 28,
    },
    paint: {
      'text-color': '#0f172a',
    },
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

function roundedRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + radius, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

function ensureLabelBackground(map) {
  if (!map || map.hasImage(labelBackgroundId)) return
  const width = 240
  const height = 170
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = 'rgba(248, 250, 252, 0.94)'
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.6)'
  ctx.lineWidth = 4
  roundedRectPath(ctx, 4, 4, width - 8, height - 8, 18)
  ctx.fill()
  ctx.stroke()
  const imageData = ctx.getImageData(0, 0, width, height)
  map.addImage(
    labelBackgroundId,
    { width, height, data: imageData.data },
    { pixelRatio: 2 }
  )
}

function iconIdForAvatar(url) {
  if (!url) return 'avatar-default'
  return `avatar-${url.replace(/[^a-z0-9]/gi, '_')}`
}

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = err => reject(err)
    img.src = url
  })
}

async function ensureAvatarIcon(map, url) {
  const fallbackUrl = '/avatars/default.png'
  const targetUrl = url || fallbackUrl
  const iconId = iconIdForAvatar(targetUrl)
  if (!map) return iconId
  if (map.hasImage(iconId)) return iconId
  if (avatarImagePromises.has(iconId)) {
    await avatarImagePromises.get(iconId)
    return iconId
  }
  const promise = (async () => {
    try {
      const img = await loadImageElement(targetUrl)
      const size = 160
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      const radius = size / 2 - 4
      ctx.clearRect(0, 0, size, size)
      ctx.save()
      ctx.beginPath()
      ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2)
      ctx.closePath()
      ctx.clip()
      ctx.drawImage(img, 0, 0, size, size)
      ctx.restore()
      ctx.beginPath()
      ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.3)'
      ctx.lineWidth = 6
      ctx.stroke()
      const imageData = ctx.getImageData(0, 0, size, size)
      map.addImage(
        iconId,
        { width: size, height: size, data: imageData.data },
        { pixelRatio: 2 }
      )
      return iconId
    } catch (err) {
      console.warn('加载头像失败，将使用默认头像', err)
      if (targetUrl !== fallbackUrl) {
        return ensureAvatarIcon(map, fallbackUrl)
      }
      return 'avatar-default'
    }
  })()
  avatarImagePromises.set(iconId, promise)
  try {
    return await promise
  } finally {
    avatarImagePromises.delete(iconId)
  }
}

function normalizeNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function tryCoordinatePair(lon, lat, source) {
  const lonNum = normalizeNumber(lon)
  const latNum = normalizeNumber(lat)
  if (lonNum == null || latNum == null) return null
  return { lon: lonNum, lat: latNum, source }
}

function coordinateFromLocationObject(obj) {
  if (!obj) return null
  if (Array.isArray(obj)) {
    const [lon, lat] = obj
    return tryCoordinatePair(lon, lat, 'prediction')
  }
  if (typeof obj !== 'object') return null

  if (Array.isArray(obj.center)) {
    const [lon, lat] = obj.center
    const coord = tryCoordinatePair(lon, lat, 'prediction')
    if (coord) return coord
  } else if (obj.center && typeof obj.center === 'object') {
    const coord = tryCoordinatePair(obj.center.lon ?? obj.center.lng ?? obj.center.longitude, obj.center.lat ?? obj.center.latitude, 'prediction')
    if (coord) return coord
  }
  if (Array.isArray(obj.centre)) {
    const [lon, lat] = obj.centre
    const coord = tryCoordinatePair(lon, lat, 'prediction')
    if (coord) return coord
  } else if (obj.centre && typeof obj.centre === 'object') {
    const coord = tryCoordinatePair(obj.centre.lon ?? obj.centre.lng ?? obj.centre.longitude, obj.centre.lat ?? obj.centre.latitude, 'prediction')
    if (coord) return coord
  }

  const nested = obj.location || obj.position
  if (Array.isArray(nested)) {
    const [lon, lat] = nested
    const coord = tryCoordinatePair(lon, lat, 'prediction')
    if (coord) return coord
  } else if (nested && typeof nested === 'object') {
    const coord =
      tryCoordinatePair(nested.lon ?? nested.lng ?? nested.longitude, nested.lat ?? nested.latitude, 'prediction') ||
      tryCoordinatePair(nested.x, nested.y, 'prediction')
    if (coord) return coord
  }

  const coord =
    tryCoordinatePair(obj.lon ?? obj.lng ?? obj.longitude, obj.lat ?? obj.latitude, 'prediction') ||
    tryCoordinatePair(obj.x, obj.y, 'prediction')
  if (coord) return coord

  return null
}

function resolvePersonCoordinate(person) {
  if (!person) return null
  const direct =
    tryCoordinatePair(person.lastLon, person.lastLat, 'last') ||
    tryCoordinatePair(person.lastLng, person.lastLat, 'last') ||
    tryCoordinatePair(person.currentLon, person.currentLat, 'current') ||
    tryCoordinatePair(person.currentLng, person.currentLat, 'current') ||
    tryCoordinatePair(person.currentLongitude, person.currentLatitude, 'current') ||
    tryCoordinatePair(person.lon, person.lat, 'last') ||
    tryCoordinatePair(person.lng, person.lat, 'last') ||
    tryCoordinatePair(person.longitude, person.latitude, 'last')
  if (direct) return direct

  if (Array.isArray(person.track)) {
    for (let i = person.track.length - 1; i >= 0; i -= 1) {
      const point = person.track[i]
      const coord = tryCoordinatePair(point?.lon ?? point?.lng ?? point?.longitude, point?.lat ?? point?.latitude, 'history')
      if (coord) return coord
    }
  }

  const predictedPair =
    tryCoordinatePair(person.predictLon, person.predictLat, 'prediction') ||
    tryCoordinatePair(person.predictedLon, person.predictedLat, 'prediction') ||
    tryCoordinatePair(person.estimateLon, person.estimateLat, 'prediction') ||
    tryCoordinatePair(person.predictionLon, person.predictionLat, 'prediction')
  if (predictedPair) return predictedPair

  const predictionSources = [
    person.prediction,
    person.predict,
    person.predicted,
    person.estimatedLocation,
    person.estimate,
    person.predictionCenter,
  ]
  for (const item of predictionSources) {
    const coord = coordinateFromLocationObject(item)
    if (coord) return coord
  }

  return null
}

function maskPhone(phone) {
  if (!phone) return '未知电话'
  const value = String(phone)
  if (value.length < 7) return value
  return value.replace(/(\d{3})\d{4}(\d+)/, '$1****$2')
}

function buildLabelText(p) {
  const role = p.position || '未知岗位'
  const dept = p.dept || '未知部门'
  const room = p.room || '未知房间'
  const shift = p.shift || '未知班次'
  const phone = p.maskedPhone || maskPhone(p.phone)
  const area = p.lastArea || '未知区域'
  let sourceLabel = '最后位置'
  if (p.coordinateSource === 'prediction') {
    sourceLabel = '预测位置'
  } else if (p.coordinateSource === 'current') {
    sourceLabel = '当前位置'
  } else if (p.coordinateSource === 'history') {
    sourceLabel = '轨迹推算'
  }
  const timeText = p.lastTime ? formatTime(p.lastTime) : '时间未知'
  return `${p.name}｜${role}\n部门：${dept}｜房间：${room}\n班次：${shift}｜电话：${phone}\n${sourceLabel}：${area}\n时间：${timeText}`
}

function buildPeopleCollection() {
  const selectedId = selected.value?.id || null
  const features = people.value
    .map(p => {
      const coord = resolvePersonCoordinate(p)
      if (!coord) return null
      const maskedPhone = maskPhone(p.phone)
      return {
        type: 'Feature',
        properties: {
          id: p.id,
          name: p.name,
          position: p.position,
          dept: p.dept,
          room: p.room,
          shift: p.shift,
          phone: p.phone,
          maskedPhone,
          lastArea: p.lastArea,
          lastTime: p.lastTime,
          avatarUrl: p.avatar,
          coordinateSource: coord.source,
          selected: selectedId && selectedId === p.id ? 1 : 0,
        },
        geometry: { type: 'Point', coordinates: [coord.lon, coord.lat] },
      }
    })
    .filter(Boolean)

  return { type: 'FeatureCollection', features }
}

async function refreshPeopleSource() {
  const map = getMap()
  if (!map || !map.isStyleLoaded()) return
  const source = map.getSource(peopleClusterSourceId)
  if (!source) return
  ensureLabelBackground(map)
  await ensureAvatarIcon(map, '/avatars/default.png')
  const collection = buildPeopleCollection()
  const iconCache = new Map()
  for (const feature of collection.features) {
    const url = feature.properties.avatarUrl
    if (!iconCache.has(url || '')) {
      const ensured = await ensureAvatarIcon(map, url)
      iconCache.set(url || '', ensured)
    }
    feature.properties.icon = iconCache.get(url || '') || 'avatar-default'
    feature.properties.label = buildLabelText(feature.properties)
  }
  source.setData(collection)

  if (!hasFittedInitialView && !pendingFocus && collection.features.length) {
    fitMapToPeople(collection)
  }
}

function fitMapToPeople(collection) {
  const map = getMap()
  if (!map || !map.isStyleLoaded()) return
  const data = collection || buildPeopleCollection()
  const coordinates = data.features
    .map(f => f.geometry?.coordinates)
    .filter(coord => Array.isArray(coord) && coord.length >= 2)
    .map(coord => [normalizeNumber(coord[0]), normalizeNumber(coord[1])])
    .filter(coord => coord[0] != null && coord[1] != null)

  if (!coordinates.length) return

  let [minLon, minLat] = coordinates[0]
  let [maxLon, maxLat] = coordinates[0]
  coordinates.forEach(([lon, lat]) => {
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  })

  if (minLon === maxLon && minLat === maxLat) {
    const delta = 0.0012
    minLon -= delta
    maxLon += delta
    minLat -= delta
    maxLat += delta
  }

  map.fitBounds(
    [
      [minLon, minLat],
      [maxLon, maxLat],
    ],
    {
      padding: { top: 80, bottom: 80, left: 80, right: 240 },
      duration: 800,
      maxZoom: 17,
    }
  )
  hasFittedInitialView = true
}

function registerPeopleInteractions(map) {
  if (!map) return
  const register = (event, layerId, handler) => {
    map.on(event, layerId, handler)
    mapInteractionCleanup.push([event, layerId, handler])
  }

  register('click', 'people-clusters', e => {
    const feature = e.features && e.features[0]
    if (!feature) return
    const source = map.getSource(peopleClusterSourceId)
    if (!source || typeof source.getClusterExpansionZoom !== 'function') return
    const clusterId = feature.properties.cluster_id
    source.getClusterExpansionZoom(clusterId, (err, zoom) => {
      if (err) return
      map.easeTo({ center: feature.geometry.coordinates, zoom })
    })
  })

  const setCursor = value => {
    const canvas = map.getCanvas()
    if (canvas) {
      canvas.style.cursor = value
    }
  }

  register('mouseenter', 'people-clusters', () => setCursor('pointer'))
  register('mouseleave', 'people-clusters', () => setCursor(''))
  register('mouseenter', 'people-avatars', () => setCursor('pointer'))
  register('mouseleave', 'people-avatars', () => setCursor(''))

  register('click', 'people-avatars', e => {
    const feature = e.features && e.features[0]
    if (!feature) return
    const id = Number(feature.properties?.id)
    if (!id) return
    const target = people.value.find(p => p.id === id)
    if (target) {
      selectPerson(target)
    }
  })
}

function focusPersonOnMap(p, options = {}) {
  if (!p) return
  const resolved = resolvePersonCoordinate(p)
  if (!resolved) return
  const map = getMap()
  const clonedOptions = { ...options }
  if (!map || !map.isStyleLoaded()) {
    pendingFocus = { id: p.id, options: clonedOptions }
    hasFittedInitialView = true
    return
  }
  const explicitZoom = normalizeNumber(clonedOptions.zoom)
  const preserveZoom = !!clonedOptions.preserveZoom
  const instant = !!clonedOptions.instant
  const currentZoom = map.getZoom()
  const targetZoom =
    explicitZoom != null ? explicitZoom : preserveZoom ? currentZoom : Math.max(currentZoom, 17)
  map.flyTo({ center: [resolved.lon, resolved.lat], zoom: targetZoom, duration: instant ? 0 : 800 })
  hasFittedInitialView = true
  pendingFocus = null
}

function selectPerson(p) {
  if (!p) return
  selected.value = p
  focusPersonOnMap(p)
}

function updateLayers() {
  const map = getMap()
  if (!map || !map.isStyleLoaded()) return

  const peopleSource = map.getSource('people')
  const trackSource = map.getSource('track')
  const predictSource = map.getSource('predict')
  if (!peopleSource || !trackSource || !predictSource) return

  const p = selected.value
  const highlight = p ? pointFeature(p) : null
  peopleSource.setData(highlight ? { type: 'FeatureCollection', features: [highlight] } : emptyFc)

  const trackFeatureData = p && showTrack.value ? lineFeature(p) : null
  trackSource.setData(trackFeatureData ? { type: 'FeatureCollection', features: [trackFeatureData] } : emptyFc)

  const predictData = p && showPredict.value ? predictionFeature(p) : emptyFc
  predictSource.setData(predictData)
}

watch([showTrack, showPredict], updateLayers)
watch(selected, () => {
  updateLayers()
  refreshPeopleSource()
})
watch(people, () => {
  refreshPeopleSource()
})
watch(showCamera, val => {
  const map = getMap()

  if (!map || !map.isStyleLoaded()) return
  const vis = val ? 'visible' : 'none'
  if (map.getLayer('cam-fill')) map.setLayoutProperty('cam-fill', 'visibility', vis)
  if (map.getLayer('cam-line')) map.setLayoutProperty('cam-line', 'visibility', vis)
})

function pointFeature(p) {
  const coord = resolvePersonCoordinate(p)
  if (!coord) return null
  return {
    type: 'Feature',
    properties: { name: p.name },
    geometry: { type: 'Point', coordinates: [coord.lon, coord.lat] },
  }
}

function lineFeature(p) {
  if (!Array.isArray(p.track)) return null
  const coordinates = p.track
    .map(item => {
      const lon = normalizeNumber(item?.lon ?? item?.lng ?? item?.longitude)
      const lat = normalizeNumber(item?.lat ?? item?.latitude)
      return lon != null && lat != null ? [lon, lat] : null
    })
    .filter(Boolean)
  if (coordinates.length < 2) return null
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates,
    },
  }
}

function predictionFeature(p) {
  const center = resolvePersonCoordinate(p)
  if (!center) return emptyFc
  const R = 0.0015
  const steps = 24
  const coords = []
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2
    coords.push([center.lon + Math.cos(a) * R, center.lat + Math.sin(a) * R])
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
