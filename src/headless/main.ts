import { ToolValue } from '../tools'
import { NodeEvent, NodeResult } from '../workflow/runGraph'
import { CanvasOnlyStepsError, runWorkflowYaml } from './headlessRun'

/**
 * Browser entry point for headless runs.
 *
 * The page carries no editor and no React tree: it exists only to give the workflow engine the
 * browser image primitives (`createImageBitmap`, a 2D canvas, `fetch` against the local API) that
 * the image tools are written against. Running the real engine in a real browser is what keeps a
 * headless result identical to a canvas result, rather than merely similar.
 */

/** A node summary that survives the trip back to Node, where image bytes would not. */
interface NodeSummary {
	status: NodeResult['status']
	error?: NodeResult['error']
	outputs?: Record<string, string>
}

export interface HeadlessRunSummary {
	ok: boolean
	nodes: Record<string, NodeSummary>
	validationErrors?: { stepId?: string; message: string }[]
	error?: string
}

/** Describe a value by shape and size, because the bytes themselves cannot cross the boundary. */
function describeValue(value: ToolValue): string {
	if (value === null) return 'null'
	if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`
	if (typeof value === 'object' && 'bytes' in value && value.bytes instanceof Uint8Array) {
		const size = `${Math.round(value.bytes.length / 1024)} KB`
		const dims = value.width && value.height ? `, ${value.width}x${value.height}` : ''
		return `${value.mimeType} (${size}${dims})`
	}
	if (typeof value === 'object') return 'object'
	const text = String(value)
	return text.length > 80 ? `${text.slice(0, 77)}...` : text
}

function summarize(outputs: Record<string, ToolValue> | undefined) {
	if (!outputs) return undefined
	const described: Record<string, string> = {}
	for (const [name, value] of Object.entries(outputs)) described[name] = describeValue(value)
	return described
}

declare global {
	interface Window {
		runWorkflow(yaml: string, options?: { to?: string; timeoutMs?: number; refresh?: boolean }): Promise<HeadlessRunSummary>
		/** Installed by the CLI so step transitions stream out while the run is still going. */
		headlessNodeEvent?: (event: { id: string; status: string; progress?: string }) => void
		headlessReady?: boolean
	}
}

window.runWorkflow = async (yaml, options = {}) => {
	const onNode = (event: NodeEvent) => {
		const progress = event.progress ? `${event.progress.done}/${event.progress.total}` : undefined
		// Streaming is best-effort: a run must not fail because the reporter did.
		try {
			window.headlessNodeEvent?.({ id: event.id, status: event.status, progress })
		} catch {
			// ignore
		}
	}

	try {
		const result = await runWorkflowYaml(yaml, { ...options, onNode })
		const nodes: Record<string, NodeSummary> = {}
		for (const [id, node] of Object.entries(result.nodes)) {
			nodes[id] = { status: node.status, error: node.error, outputs: summarize(node.outputs) }
		}
		const failed = Object.values(nodes).some((node) => node.status !== 'succeeded')
		return {
			ok: !failed && !result.validationErrors?.length,
			nodes,
			validationErrors: result.validationErrors?.map((e) => ({
				stepId: e.stepId,
				message: e.message,
			})),
		}
	} catch (error) {
		const message =
			error instanceof CanvasOnlyStepsError || error instanceof Error
				? error.message
				: String(error)
		return { ok: false, nodes: {}, error: message }
	}
}

window.headlessReady = true
