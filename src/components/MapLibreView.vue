<script setup>
import { onMounted, onUnmounted, ref, watch, toRefs } from 'vue'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

// 可传入的属性：中心点与缩放
const props = defineProps({
  center: { type: Array, default: () => [116.3975, 39.9087] }, // 北京天安门
  zoom: { type: Number, default: 13 },
  pmtilesUrl: { type: String, default: '/maps/sample.pmtiles' },
})

const containerRef = ref(null)
let map

async function hasFile(url){
  try {
    const res = await fetch(url, { method: 'HEAD' })
    return res.ok
  } catch (e) { return false }
}

function buildRasterStyle(tiles){
  return {
    version: 8,
    sources: {
      raster: {
        type: 'raster',
        tiles,
        tileSize: 256,
        attribution: '© OpenStreetMap contributors'
      }
    },
    layers: [ { id: 'raster', type: 'raster', source: 'raster' } ]
  }
}

function zoneFeaturesFrom(center){
  const [cx, cy] = center
  const spanX = 0.020 // 经度跨度（大约2km级别，示意）
  const spanY = 0.014 // 纬度跨度
  const x0 = cx - spanX/2, y0 = cy - spanY/2
  const cols = [0.28, 0.42, 0.30]
  const rows = [0.28, 0.32, 0.40]
  const colors = ['#60a5fa','#34d399','#fca5a5','#fde68a','#f59e0b','#a78bfa','#93c5fd','#86efac','#fbcfe8']
  const names = ['生活区','燃气管区','仓储区','办公区','机房区','发电区','生活配套','后勤区','成品区']
  let accX = 0
  const xs = cols.map(r=>{ const v=accX; accX+=r; return v })
  let accY = 0
  const ys = rows.map(r=>{ const v=accY; accY+=r; return v })
  const feats = []
  let k=0
  for(let j=0;j<3;j++){
    for(let i=0;i<3;i++){
      const minx = x0 + xs[i]*spanX
      const miny = y0 + ys[j]*spanY
      const maxx = minx + cols[i]*spanX
      const maxy = miny + rows[j]*spanY
      feats.push({
        type:'Feature',
        properties:{ id:`z${k+1}`, name:names[k], color:colors[k] },
        geometry:{ type:'Polygon', coordinates:[[
          [minx,miny],[maxx,miny],[maxx,maxy],[minx,maxy],[minx,miny]
        ]]}
      })
      k++
    }
  }
  return { type:'FeatureCollection', features:feats }
}

async function init(){
  if (!containerRef.value) return
  // 优先尝试本地 pmtiles；否则回退 OSM 在线瓦片
  let style = buildRasterStyle(['https://tile.openstreetmap.org/{z}/{x}/{y}.png'])
  if (await hasFile(props.pmtilesUrl)){
    // 通过 pmtiles.js 挂载协议（按需动态导入，避免无文件时的额外体积）
    const pmtiles = await import('pmtiles')
    const protocol = new pmtiles.Protocol()
    maplibregl.addProtocol('pmtiles', protocol.tile)
    // 直接以 pmtiles:// 协议引入栅格切片（若为矢量需配完整样式，这里以栅格为示例）
    style = buildRasterStyle([`pmtiles://${props.pmtilesUrl}`])
  }
  map = new maplibregl.Map({
    container: containerRef.value,
    style,
    center: props.center,
    zoom: props.zoom,
    hash: false,
  })
  // 添加基本控件
  map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right')

  map.on('load', () => {
    const fc = zoneFeaturesFrom(props.center)
    map.addSource('factory', { type:'geojson', data: fc })
    map.addLayer({ id:'factory-fill', type:'fill', source:'factory', paint:{
      'fill-color':['get','color'], 'fill-opacity':0.18
    }})
    map.addLayer({ id:'factory-outline', type:'line', source:'factory', paint:{
      'line-color':'#64748b', 'line-width':1
    }})
    map.addLayer({ id:'factory-label', type:'symbol', source:'factory', layout:{
      'text-field':['get','name'], 'text-size':12, 'text-anchor':'center'
    }, paint:{ 'text-color':'#334155', 'text-halo-color':'#ffffff', 'text-halo-width':1 }})
  })
}

onMounted(init)
onUnmounted(() => { if (map) { map.remove(); map = null } })

// 允许父组件在地图初始化后获取 map 实例，以便叠加轨迹等自定义图层
defineExpose({
  getMap: () => map,
})
</script>

<template>
  <div ref="containerRef" class="ml-map"></div>
  <!-- 无样式内容；样式写在 scoped css 中 -->
</template>

<style scoped>
.ml-map { position:absolute; inset:0; }
</style>
