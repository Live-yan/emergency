import { createRouter, createWebHashHistory } from 'vue-router'

import Dashboard from '../pages/Dashboard.vue'
import TraceAnalysis from '../pages/TraceAnalysis.vue'

const routes = [
  { path: '/', name: 'home', component: Dashboard },
  { path: '/trace', name: 'trace', component: TraceAnalysis },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
