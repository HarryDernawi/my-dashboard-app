import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
<<<<<<< HEAD
  base: './', // <--- تم التغيير هنا!
=======
  base: '/my-dashboard-app/', // هذا السطر هو الأهم للنشر على GitHub Pages
>>>>>>> 4cb9888017a580c2f1b8a32e32622fb9f20e7fff
  plugins: [react()],
})
