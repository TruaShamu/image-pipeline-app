#!/usr/bin/env node
// Run a workflow YAML file from the command line.
//
// The workflow engine is browser-free, but several image tools are written against browser
// primitives (createImageBitmap, a 2D canvas). Rather than keep a second image implementation for
// Node — which would quietly produce different pixels — this drives the real engine in a real
// headless browser, on a page that has no editor. Same code, same bytes, no UI.
//
//   npm run workflow -- collected-animation
//   npm run workflow -- pipelines/workflows/prompt-variations.yaml --out ./out

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const WORKFLOW_DIR = path.join(projectRoot, 'pipelines', 'workflows')

function parseArgs(argv) {
	const args = { file: undefined, to: undefined, out: undefined, timeoutMs: undefined, refresh: false, base: 'http://localhost:5173' }
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		if (arg === '--to') args.to = argv[++i]
		else if (arg === '--out') args.out = argv[++i]
		else if (arg === '--base') args.base = argv[++i]
		else if (arg === '--timeout') args.timeoutMs = Number(argv[++i])
		else if (arg === '--fresh') args.refresh = true
		else if (arg.startsWith('-')) throw new Error(`Unknown option "${arg}"`)
		else if (args.file === undefined) args.file = arg
		else throw new Error(`Unexpected argument "${arg}"`)
	}
	return args
}

/** Accept a path or a bare catalog name, so `npm run workflow -- collected-animation` works. */
function resolveWorkflowPath(file) {
	const candidates = [
		path.resolve(process.cwd(), file),
		path.join(WORKFLOW_DIR, file),
		path.join(WORKFLOW_DIR, `${file}.yaml`),
	]
	const found = candidates.find((candidate) => existsSync(candidate))
	if (!found) {
		throw new Error(`No workflow found for "${file}". Looked in ${WORKFLOW_DIR} and the current directory.`)
	}
	return found
}

async function isServerUp(base) {
	try {
		const response = await fetch(base, { signal: AbortSignal.timeout(1500) })
		return response.ok
	} catch {
		return false
	}
}

/**
 * Reuse the developer's dev server when one is already listening, and otherwise start a private
 * one. Reusing matters for more than speed: two servers would fight for the port.
 */
async function ensureServer(base) {
	if (await isServerUp(base)) return { stop: async () => {} }

	process.stderr.write('Starting dev server...\n')
	const child = spawn('npm', ['run', 'dev'], {
		cwd: projectRoot,
		shell: process.platform === 'win32',
		stdio: 'ignore',
	})

	const deadline = Date.now() + 120_000
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error('The dev server exited before it became ready.')
		if (await isServerUp(base)) {
			return {
				stop: async () => {
					child.kill()
				},
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 500))
	}
	child.kill()
	throw new Error(`The dev server did not become ready at ${base}.`)
}

const STATUS_MARK = {
	succeeded: 'ok',
	failed: 'FAILED',
	blocked: 'blocked',
	cancelled: 'cancelled',
	running: '..',
	pending: '--',
}

async function main() {
	const args = parseArgs(process.argv.slice(2))
	if (!args.file) {
		process.stderr.write('Usage: npm run workflow -- <file|name> [--to step] [--out dir] [--timeout ms] [--fresh]\n')
		process.exitCode = 2
		return
	}

	const workflowPath = resolveWorkflowPath(args.file)
	const yaml = await readFile(workflowPath, 'utf8')
	const outDir = path.resolve(process.cwd(), args.out ?? 'workflow-output')
	await mkdir(outDir, { recursive: true })

	const server = await ensureServer(args.base)
	const browser = await chromium.launch()
	const started = Date.now()
	const saved = []

	try {
		const context = await browser.newContext({ acceptDownloads: true })
		const page = await context.newPage()

		// Download sinks use an anchor click, which Playwright surfaces as a download event. Saving
		// them is what makes a command line run useful rather than merely green.
		const downloads = []
		page.on('download', (download) => {
			const target = path.join(outDir, download.suggestedFilename())
			downloads.push(
				download
					.saveAs(target)
					.then(() => saved.push(target))
					.catch((error) => process.stderr.write(`Could not save a download: ${error.message}\n`))
			)
		})
		page.on('pageerror', (error) => process.stderr.write(`Page error: ${error.message}\n`))

		const seen = new Map()
		await page.exposeFunction('headlessNodeEvent', (event) => {
			// Only print transitions, or a fan-out would flood the terminal with one line per item.
			const key = `${event.status}:${event.progress ?? ''}`
			if (seen.get(event.id) === key) return
			seen.set(event.id, key)
			if (event.status === 'pending') return
			const elapsed = ((Date.now() - started) / 1000).toFixed(0).padStart(3)
			const progress = event.progress ? ` (${event.progress})` : ''
			process.stdout.write(`${elapsed}s  ${(STATUS_MARK[event.status] ?? event.status).padEnd(9)} ${event.id}${progress}\n`)
		})

		await page.goto(`${args.base}/headless.html`)
		await page.waitForFunction(() => window.headlessReady === true)

		process.stdout.write(`Running ${path.relative(projectRoot, workflowPath)}\n`)
		const result = await page.evaluate(
			([yaml, options]) => window.runWorkflow(yaml, options),
			[yaml, { to: args.to, timeoutMs: args.timeoutMs, refresh: args.refresh }]
		)

		// Let the last download land before the browser closes underneath it.
		await Promise.all(downloads)

		if (result.error) {
			process.stderr.write(`\n${result.error}\n`)
			process.exitCode = 1
			return
		}

		for (const error of result.validationErrors ?? []) {
			process.stderr.write(`Invalid workflow: ${error.stepId ? `${error.stepId}: ` : ''}${error.message}\n`)
		}

		process.stdout.write('\n')
		for (const [id, node] of Object.entries(result.nodes)) {
			const outputs = node.outputs
				? Object.entries(node.outputs)
						.map(([name, description]) => `${name}=${description}`)
						.join('  ')
				: ''
			process.stdout.write(`${(STATUS_MARK[node.status] ?? node.status).padEnd(9)} ${id.padEnd(24)} ${outputs}\n`)
			if (node.error) process.stderr.write(`          ${node.error.kind}: ${node.error.message}\n`)
		}

		for (const file of saved) process.stdout.write(`\nSaved ${path.relative(process.cwd(), file)}\n`)

		const seconds = ((Date.now() - started) / 1000).toFixed(1)
		process.stdout.write(`\n${result.ok ? 'Succeeded' : 'Failed'} in ${seconds}s\n`)
		if (!result.ok) process.exitCode = 1
	} finally {
		await browser.close()
		await server.stop()
	}
}

main().catch((error) => {
	process.stderr.write(`${error.message}\n`)
	process.exitCode = 1
})
