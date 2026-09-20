import { effectiveOutputType, resolveToolInputs, ToolRegistry, ToolValue } from '../tools'
import { modelCatalog } from '../models/modelCatalog'
import { GraphBinding, GraphStep, WorkflowGraph } from './graphTypes'

export interface GraphValidationError {
	stepId?: string
	port?: string
	message: string
}

export interface GraphValidationResult {
	valid: boolean
	errors: readonly GraphValidationError[]
}

function hasOwn(value: object, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(value, key)
}

function isInteger(value: ToolValue): value is number {
	return typeof value === 'number' && Number.isInteger(value)
}

function matchesLiteralType(value: ToolValue, type: string): boolean {
	switch (type) {
		case 'text':
		case 'model':
			return typeof value === 'string'
		case 'int':
			return isInteger(value)
		case 'number':
			return typeof value === 'number'
		case 'json':
			return typeof value === 'object' && value !== null && !Array.isArray(value)
		case 'any':
			return true
		case 'sink':
			return false
		default:
			// Image values are intentionally validated by the executing tool. The generic graph
			// validator does not inspect binary payloads.
			return type === 'image' || type === 'image[]'
	}
}

function getStepMap(graph: WorkflowGraph): Map<string, GraphStep> {
	return new Map(graph.steps.map((step) => [step.id, step]))
}

/**
 * Decide which steps fan out, i.e. run once per element.
 *
 * A step fans out when an `image[]` reaches one of its scalar `image` inputs — either directly
 * from a tool like `sprite.slice`, or from an upstream step that is itself fanning out. Its own
 * `image` outputs then carry an `image[]`, which is what makes `slice → removeBackground → zip`
 * validate without a loop block. See `runToolMapped`, which performs the matching execution.
 */
function getFanOutSteps(
	stepMap: Map<string, GraphStep>,
	registry: ToolRegistry
): ReadonlySet<string> {
	const fanOut = new Set<string>()
	const settled = new Set<string>()
	const visiting = new Set<string>()

	const outputTypeOf = (stepId: string, outputName: string): string | null => {
		const step = stepMap.get(stepId)
		if (!step || !registry.has(step.tool)) return null
		const tool = registry.resolve(step.tool)
		const output = tool.outputs.find((candidate) => candidate.name === outputName)
		if (!output) return null
		return effectiveOutputType(tool, output, step.with, fansOut(stepId))
	}

	function fansOut(stepId: string): boolean {
		if (settled.has(stepId)) return fanOut.has(stepId)
		// A cycle is reported elsewhere; treat it as non-fanning rather than recursing forever.
		if (visiting.has(stepId)) return false
		visiting.add(stepId)

		const step = stepMap.get(stepId)
		let result = false
		if (step && registry.has(step.tool)) {
			const inputs = resolveToolInputs(registry.resolve(step.tool), step.with)
			for (const binding of step.needs ?? []) {
				const input = inputs.find((candidate) => candidate.name === binding.port)
				if (!input || input.type !== 'image') continue
				if (outputTypeOf(binding.from.stepId, binding.from.output) === 'image[]') {
					result = true
					break
				}
			}
		}

		visiting.delete(stepId)
		settled.add(stepId)
		if (result) fanOut.add(stepId)
		return result
	}

	for (const stepId of stepMap.keys()) fansOut(stepId)
	return fanOut
}

function validateBinding(
	binding: GraphBinding,
	step: GraphStep,
	stepMap: Map<string, GraphStep>,
	registry: ToolRegistry,
	fanOutSteps: ReadonlySet<string>,
	errors: GraphValidationError[]
) {
	const input = resolveToolInputs(registry.resolve(step.tool), step.with).find(
		(candidate) => candidate.name === binding.port
	)
	const sourceStep = stepMap.get(binding.from.stepId)
	if (!input) {
		errors.push({ stepId: step.id, port: binding.port, message: `Unknown input "${binding.port}"` })
		return
	}
	if (!sourceStep) {
		errors.push({
			stepId: step.id,
			port: binding.port,
			message: `Unknown source step "${binding.from.stepId}"`,
		})
		return
	}
	const output = registry.resolve(sourceStep.tool).outputs.find(
		(candidate) => candidate.name === binding.from.output
	)
	if (!output) {
		errors.push({
			stepId: step.id,
			port: binding.port,
			message: `Unknown output "${binding.from.output}" on "${binding.from.stepId}"`,
		})
		return
	}
	const sourceType = effectiveOutputType(
		registry.resolve(sourceStep.tool),
		output,
		sourceStep.with,
		fanOutSteps.has(binding.from.stepId)
	)
	// An `image[]` landing on a scalar `image` input is not an error: the runner maps the tool
	// over the elements.
	const mappable = sourceType === 'image[]' && input.type === 'image'
	if (sourceType !== input.type && sourceType !== 'any' && input.type !== 'any' && !mappable) {
		errors.push({
			stepId: step.id,
			port: binding.port,
			message: `Type mismatch: ${sourceType} cannot connect to ${input.type}`,
		})
	}
}

export function validateGraph(
	graph: WorkflowGraph,
	registry: ToolRegistry,
	{ executionStepIds }: { executionStepIds?: ReadonlySet<string> } = {}
): GraphValidationResult {
	const errors: GraphValidationError[] = []
	const stepMap = getStepMap(graph)
	const fanOutSteps = getFanOutSteps(stepMap, registry)
	const duplicateIds = new Set<string>()

	for (const step of graph.steps) {
		if (duplicateIds.has(step.id)) {
			errors.push({ stepId: step.id, message: `Duplicate step id "${step.id}"` })
		}
		duplicateIds.add(step.id)

		if (!registry.has(step.tool)) {
			errors.push({ stepId: step.id, message: `Unknown tool "${step.tool}"` })
			continue
		}

		const tool = registry.resolve(step.tool)
		const values = step.with ?? {}
		const bindings = step.needs ?? []
		const boundPorts = new Set<string>()

		for (const binding of bindings) {
			if (boundPorts.has(binding.port)) {
				errors.push({
					stepId: step.id,
					port: binding.port,
					message: `Input "${binding.port}" has more than one binding`,
				})
			}
			boundPorts.add(binding.port)
			validateBinding(binding, step, stepMap, registry, fanOutSteps, errors)
		}

		for (const input of resolveToolInputs(tool, values)) {
			const hasLiteral = hasOwn(values, input.name)
			const hasBinding = boundPorts.has(input.name)
			if (hasLiteral && hasBinding) {
				errors.push({
					stepId: step.id,
					port: input.name,
					message: `Input "${input.name}" is set by both with and needs`,
				})
			}
			if (
				executionStepIds?.has(step.id) &&
				input.required &&
				!hasLiteral &&
				!hasBinding &&
				input.default === undefined
			) {
				errors.push({
					stepId: step.id,
					port: input.name,
					message: `Required input "${input.name}" is missing`,
				})
			}
			if (hasLiteral && !matchesLiteralType(values[input.name], input.type)) {
				errors.push({
					stepId: step.id,
					port: input.name,
					message: `Literal for "${input.name}" is not a valid ${input.type}`,
				})
			}
			if (hasLiteral) {
				// Runtime-sourced choices are only checked once the list has loaded; an empty
				// registry means "not known yet", not "nothing is allowed".
				const allowed =
					input.optionsSource === 'models'
						? modelCatalog.list().map((model) => model.id)
						: input.options?.map((option) => option.value)
				if (
					allowed &&
					allowed.length > 0 &&
					// Option values are strings; a numeric input holds a number.
					!allowed.map(String).includes(String(values[input.name]))
				) {
					errors.push({
						stepId: step.id,
						port: input.name,
						message: `Literal for "${input.name}" is not an allowed option`,
					})
				}
			}
		}
	}

	const visitState = new Map<string, 'visiting' | 'visited'>()
	const visit = (stepId: string) => {
		const state = visitState.get(stepId)
		if (state === 'visiting') {
			errors.push({ stepId, message: 'Graph contains a cycle' })
			return
		}
		if (state === 'visited') return
		visitState.set(stepId, 'visiting')
		for (const binding of stepMap.get(stepId)?.needs ?? []) visit(binding.from.stepId)
		visitState.set(stepId, 'visited')
	}
	for (const step of graph.steps) visit(step.id)

	return { valid: errors.length === 0, errors }
}
