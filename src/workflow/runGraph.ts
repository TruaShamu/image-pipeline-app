import { resolveToolInputs, runToolMapped, Tool, ToolRegistry, ToolValue, toolErrorStatus } from '../tools'
import { GraphStep, WorkflowGraph } from './graphTypes'
import { GraphValidationError, validateGraph } from './graphValidation'

export type NodeStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'cancelled'

export interface NodeError {
	kind: 'auth' | 'timeout' | 'network' | 'tool' | 'validation'
	message: string
	httpStatus?: number
}

export interface NodeResult {
	status: NodeStatus
	outputs?: Record<string, ToolValue>
	error?: NodeError
}

export interface NodeEvent {
	id: string
	status: NodeStatus
	outputs?: Record<string, ToolValue>
	error?: NodeError
	/** How far a fan-out has progressed, when this step is mapping over a collection. */
	progress?: { done: number; total: number }
}

export interface RunGraphOptions {
	to?: string
	/** Exact steps to execute. Dependencies outside this set must be supplied through initialResults. */
	executionStepIds?: ReadonlySet<string>
	/** Previously retained outputs that satisfy dependencies outside the active execution set. */
	initialResults?: Readonly<Record<string, NodeResult>>
	signal?: AbortSignal
	onNode?: (event: NodeEvent) => void
	timeoutMs?: number
	/** Bypass the generation cache, producing new images for unchanged parameters. */
	refresh?: boolean
}

export interface RunGraphResult {
	nodes: Record<string, NodeResult>
	validationErrors?: readonly GraphValidationError[]
}

function ancestorClosure(graph: WorkflowGraph, registry: ToolRegistry, target?: string): Set<string> {
	const byId = new Map(graph.steps.map((step) => [step.id, step]))
	const ids = new Set<string>()
	const visit = (id: string) => {
		if (ids.has(id)) return
		ids.add(id)
		for (const binding of byId.get(id)?.needs ?? []) visit(binding.from.stepId)
	}
	if (target) {
		visit(target)
		return ids
	}

	const referencedInputs = new Set(
		graph.steps.flatMap((step) => (step.needs ?? []).map((binding) => binding.from.stepId))
	)
	const terminalIds = graph.steps
		.filter((step) => {
			const tool = registry.has(step.tool) ? registry.resolve(step.tool) : null
			return tool?.outputs.length === 0 || !referencedInputs.has(step.id)
		})
		.map((step) => step.id)
	for (const id of terminalIds) visit(id)
	return ids
}

function getExecutionOrder(graph: WorkflowGraph, ids: ReadonlySet<string>): GraphStep[] {
	const byId = new Map(graph.steps.map((step) => [step.id, step]))
	const visited = new Set<string>()
	const result: GraphStep[] = []
	const visit = (id: string) => {
		if (visited.has(id) || !ids.has(id)) return
		visited.add(id)
		for (const binding of byId.get(id)?.needs ?? []) visit(binding.from.stepId)
		const step = byId.get(id)
		if (step) result.push(step)
	}
	for (const id of ids) visit(id)
	return result
}

function classifyError(error: unknown): NodeError {
	const message = error instanceof Error ? error.message : String(error)
	const httpStatus = toolErrorStatus(error)
	// A real status beats guessing from the text, which misfires on any prompt containing a word
	// like "token" or "connection".
	if (httpStatus !== undefined) {
		if (httpStatus === 401 || httpStatus === 403) return { kind: 'auth', message, httpStatus }
		if (httpStatus === 408 || httpStatus === 504) return { kind: 'timeout', message, httpStatus }
		if (httpStatus === 400 || httpStatus === 422)
			return { kind: 'validation', message, httpStatus }
		return { kind: 'tool', message, httpStatus }
	}
	if (/401|403|auth|token|credential/i.test(message)) return { kind: 'auth', message }
	if (/fetch|network|connection|cors/i.test(message)) return { kind: 'network', message }
	return { kind: 'tool', message }
}

function createStepSignal(parent: AbortSignal | undefined, timeoutMs: number) {
	const controller = new AbortController()
	let timedOut = false
	const timeout = setTimeout(() => {
		timedOut = true
		controller.abort()
	}, timeoutMs)
	const abortParent = () => controller.abort()
	parent?.addEventListener('abort', abortParent, { once: true })
	return {
		signal: controller.signal,
		timedOut: () => timedOut,
		dispose: () => {
			clearTimeout(timeout)
			parent?.removeEventListener('abort', abortParent)
		},
	}
}

function buildInputs(
	step: GraphStep,
	tool: Tool,
	results: Record<string, NodeResult>,
	graph: WorkflowGraph
): Record<string, ToolValue> {
	const values: Record<string, ToolValue> = { ...(step.with ?? {}) }
	const byId = new Map(graph.steps.map((candidate) => [candidate.id, candidate]))
	for (const binding of step.needs ?? []) {
		const source = byId.get(binding.from.stepId)
		const output = results[binding.from.stepId]?.outputs?.[binding.from.output]
		if (!source || output === undefined) {
			throw new Error(`Missing output ${binding.from.stepId}.${binding.from.output}`)
		}
		values[binding.port] = output
	}
	for (const input of resolveToolInputs(tool, values)) {
		if (values[input.name] === undefined && input.default !== undefined) {
			values[input.name] = input.default
		}
	}
	return values
}

export async function runGraph(
	graph: WorkflowGraph,
	registry: ToolRegistry,
	options: RunGraphOptions = {}
): Promise<RunGraphResult> {
	if (options.to && !graph.steps.some((step) => step.id === options.to)) {
		return {
			nodes: {},
			validationErrors: [{ stepId: options.to, message: `Unknown target step "${options.to}"` }],
		}
	}
	const knownIds = new Set(graph.steps.map((step) => step.id))
	const unknownExecutionId = options.executionStepIds
		? [...options.executionStepIds].find((id) => !knownIds.has(id))
		: undefined
	if (unknownExecutionId) {
		return {
			nodes: {},
			validationErrors: [
				{ stepId: unknownExecutionId, message: `Unknown execution step "${unknownExecutionId}"` },
			],
		}
	}
	const executionIds = options.executionStepIds ?? ancestorClosure(graph, registry, options.to)
	const validation = validateGraph(graph, registry, { executionStepIds: executionIds })
	if (!validation.valid) return { nodes: {}, validationErrors: validation.errors }

	const results: Record<string, NodeResult> = { ...(options.initialResults ?? {}) }
	const order = getExecutionOrder(graph, executionIds)
	const timeoutMs = options.timeoutMs ?? 120_000

	for (const step of order) options.onNode?.({ id: step.id, status: 'pending' })

	const executions = new Map<string, Promise<void>>()
	for (const step of order) {
		const execute = async () => {
			await Promise.all(
				(step.needs ?? [])
					.filter((binding) => executionIds.has(binding.from.stepId))
					.map((binding) => executions.get(binding.from.stepId))
					.filter((promise): promise is Promise<void> => promise !== undefined)
			)

			if (options.signal?.aborted) {
				const result: NodeResult = { status: 'cancelled' }
				results[step.id] = result
				options.onNode?.({ id: step.id, ...result })
				return
			}

			const blockedBy = (step.needs ?? []).find(
				(binding) => results[binding.from.stepId]?.status !== 'succeeded'
			)
			if (blockedBy) {
				const result: NodeResult = {
					status: 'blocked',
					error: { kind: 'validation', message: `Blocked by ${blockedBy.from.stepId}` },
				}
				results[step.id] = result
				options.onNode?.({ id: step.id, ...result })
				return
			}

			const tool = registry.resolve(step.tool)
			options.onNode?.({ id: step.id, status: 'running' })
			const stepSignal = createStepSignal(options.signal, timeoutMs)
			try {
				const outputs = await runToolMapped(tool, buildInputs(step, tool, results, graph), {
					signal: stepSignal.signal,
					log: (message) => console.debug(`[${step.id}] ${message}`),
					onProgress: (done, total) =>
						options.onNode?.({ id: step.id, status: 'running', progress: { done, total } }),
					refresh: options.refresh,
				})
				const result: NodeResult = { status: 'succeeded', outputs }
				results[step.id] = result
				options.onNode?.({ id: step.id, ...result })
			} catch (error) {
				const result: NodeResult = options.signal?.aborted
					? { status: 'cancelled' }
					: stepSignal.timedOut()
						? {
								status: 'failed',
								error: { kind: 'timeout', message: `Tool timed out after ${timeoutMs} ms` },
							}
						: { status: 'failed', error: classifyError(error) }
				results[step.id] = result
				options.onNode?.({ id: step.id, ...result })
			} finally {
				stepSignal.dispose()
			}
		}
		const promise = execute()
		executions.set(step.id, promise)
	}

	await Promise.all(executions.values())
	return { nodes: results }
}
