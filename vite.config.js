import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  base: '/my-dashboard-app/', // هذا السطر هو الأهم للنشر على GitHub Pages
  plugins: [react()],
})
