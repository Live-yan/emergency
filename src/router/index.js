import { createRouter, createWebHashHistory } from 'vue-router'

import Dashboard from '../pages/Dashboard.vue'
import TraceView from '../pages/TraceView.vue'

const routes = [
  { path: '/', name: 'home', component: Dashboard },
  { path: '/trace/:id?', name: 'trace', component: TraceView, props: true },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
