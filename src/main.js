import { createApp } from 'vue'
import './style.css'
import MainApp from './MainApp.vue'
import router from './router'

const app = createApp(MainApp)
app.use(router)
app.mount('#app')
