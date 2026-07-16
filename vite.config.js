import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.VITE_APP_VERSION || process.env.npm_package_version || '0.0.0'),
    'import.meta.env.VITE_GIT_COMMIT': JSON.stringify(process.env.VITE_GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || 'local'),
    'import.meta.env.VITE_BUILD_DATE': JSON.stringify(process.env.VITE_BUILD_DATE || new Date().toISOString()),
  },
})
