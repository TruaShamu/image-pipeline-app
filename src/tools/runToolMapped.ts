import { resolveToolInputs, Tool, ToolContext, ToolValue } from './toolTypes'

/**
 * Run a tool, mapping it over array inputs it did not ask for.
 *
 * A tool that declares a scalar `image` input but receives an `image[]` is run once per element,
 * and its outputs are collected into arrays. This is what lets `sprite.slice` feed
 * `image.removeBackground` without a dedicated loop block: every tool becomes array-capable
 * without any per-tool code, and chains such as `slice → removeBackground → upscale → zip`
 * compose on their own.
 *
 * Only scalar `image` inputs map. A tool that declares `image[]` is asking for the whole set, and
 * `json` values are legitimately arrays, so neither is touched.
 *
 * Elements run in sequence on purpose: mapping a 16-frame sheet over an image API would otherwise
 * fire 16 concurrent generations.
 */
export async function runToolMapped(
	tool: Tool,
	values: Record<string, ToolValue>,
	context: ToolContext
): Promise<Record<string, ToolValue>> {
	const mapped = resolveToolInputs(tool, values).filter(
		(input) => input.type === 'image' && Array.isArray(values[input.name])
	)
	if (mapped.length === 0) return tool.run(values, context)

	const lengths = new Set(mapped.map((input) => (values[input.name] as ToolValue[]).length))
	if (lengths.size > 1) {
		throw new Error(
			`Cannot map "${tool.id}" over inputs of different lengths (${[...lengths].join(', ')})`
		)
	}
	const count = [...lengths][0]

	const collected: Record<string, ToolValue> = {}
	for (const output of tool.outputs) collected[output.name] = []
	if (count === 0) return collected

	for (let index = 0; index < count; index++) {
		if (context.signal.aborted) throw new Error('Cancelled')
		const element: Record<string, ToolValue> = { ...values }
		for (const input of mapped) {
			element[input.name] = (values[input.name] as ToolValue[])[index]
		}
		const outputs = await tool.run(element, context)
		for (const output of tool.outputs) {
			const value = outputs[output.name] ?? null
			// A tool that itself returns a set — `image.generate` asked for several images — would
			// otherwise nest one array inside another, and there is no nested collection type to
			// carry that. Flattening keeps the result something the rest of the graph can read.
			// Only image outputs flatten: a `json` output is allowed to be an array in its own right.
			const isImageOutput = output.type === 'image' || output.type === 'image[]'
			if (isImageOutput && Array.isArray(value)) {
				;(collected[output.name] as ToolValue[]).push(...value)
			} else {
				;(collected[output.name] as ToolValue[]).push(value)
			}
		}
		context.log(`mapped ${index + 1}/${count}`)
		context.onProgress?.(index + 1, count)
	}
	return collected
}
