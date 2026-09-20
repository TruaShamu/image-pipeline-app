import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { localApiPlugin } from './server/vitePlugin.ts'

const entry = (file: string) => fileURLToPath(new URL(file, import.meta.url))

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [localApiPlugin(), react()],
	build: {
		rollupOptions: {
			// The headless runner is a second page, built alongside the editor so a change that
			// breaks it fails the build rather than the next command line run.
			input: { main: entry('index.html'), headless: entry('headless.html') },
		},
	},
})
