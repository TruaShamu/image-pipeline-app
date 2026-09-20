import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { localApiPlugin } from './server/vitePlugin.ts'

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [localApiPlugin(), react()],
})
