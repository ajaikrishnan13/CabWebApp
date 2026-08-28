import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          supabase: ['@supabase/supabase-js'],
          react: ['react', 'react-dom']
        }
      }
    }
  },
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: ['delusion-coat-excitable.ngrok-free.dev'],
  },
})
