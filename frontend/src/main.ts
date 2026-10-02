import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { migrateDatingRules } from './api/local-service'
import './styles/global.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)

// 判定口径调整后，先把存量测年送检单按新口径重判一遍（已出报告的沿用既有校正年代，不重算）。
migrateDatingRules()

app.mount('#app')
