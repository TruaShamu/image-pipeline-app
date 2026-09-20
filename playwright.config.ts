import { defineConfig, devices } from '@playwright/test'

/**
 * The tests drive the real dev server, because the parts worth testing here (canvas image
 * decoding, GIF encoding, tldraw rendering) only exist in a browser and cannot be reached from
 * the SSR probes used elsewhere in this project.
 */
export default defineConfig({
	testDir: './tests',
	// Image work is slow, and a generation round-trip slower still.
	timeout: 60_000,
	expect: { timeout: 15_000 },
	fullyParallel: false,
	workers: 1,
	reporter: [['list']],
	use: {
		baseURL: 'http://localhost:5173',
		trace: 'retain-on-failure',
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'npm run dev',
		url: 'http://localhost:5173',
		// Reuse the server the developer already has running rather than fighting it for the port.
		reuseExistingServer: true,
		timeout: 120_000,
	},
})
