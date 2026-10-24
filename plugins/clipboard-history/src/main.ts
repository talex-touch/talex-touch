import { createApp } from 'vue'
import App from './App.vue'
import { initializeClipboardTheme } from './utils/theme'
import './main.css'

initializeClipboardTheme()

const app = createApp(App)
app.mount('#app')
