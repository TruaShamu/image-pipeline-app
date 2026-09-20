import { PortDataType } from '../constants'

/**
 * Portable image data exchanged by workflow tools.
 *
 * Tools must not pass DOM image objects, object URLs, or provider-specific URLs through the
 * graph. Keeping bytes as the value makes the same graph usable by the browser runner and a
 * future headless runner.
 */
export interface ImageValue {
	bytes: Uint8Array
	mimeType: string
	width?: number
	height?: number
}

export type ToolValue = ImageValue | string | number | boolean | null | ToolValue[] | {
	[key: string]: ToolValue
}

/** A labeled choice for a picker-style (`<select>`) input. */
export interface ToolInputOption {
	value: string
	label: string
}

export interface ToolInputDefinition {
	name: string
	type: PortDataType
	required: boolean
	default?: ToolValue
	/** Render as a `<select>` picker instead of a free-text field. */
	options?: readonly ToolInputOption[]
	/**
	 * Populate the picker from a runtime source instead of a fixed `options` list.
	 *
	 * Used where only the server knows the valid choices — the model picker is built from the
	 * providers the server actually has credentials for, so an uncallable model is never offered.
	 */
	optionsSource?: 'models'
	/** Render as a multi-line textarea. For prose-sized values like prompt templates. */
	multiline?: boolean
	/** Whether this input is exposed as a connectable port. */
	port?: boolean
	/** Hide from generated UI; the value is still read from configuration at run time. */
	hidden?: boolean
}

export interface ToolOutputDefinition {
	name: string
	type: PortDataType
}

export interface CanvasCapability {
	/**
	 * Render the drawn shapes sitting inside this block's own region to a PNG.
	 *
	 * Returns null when the region is empty, which the caller must report rather than pass on:
	 * a sketch's strokes live in the tldraw store and are never written to the workflow file, so
	 * a reopened sketch pipeline finds an empty region every time.
	 */
	captureRegion: () => Promise<ImageValue | null>
}

export interface ToolContext {
	signal: AbortSignal
	log: (message: string) => void
	/**
	 * Report progress through a fan-out.
	 *
	 * A tool that maps over a collection runs many times for one block, which is otherwise
	 * invisible: the block simply sits in "running" for much longer than the user expects.
	 */
	onProgress?: (done: number, total: number) => void
	/**
	 * Read from the canvas the block is drawn on.
	 *
	 * Only supplied by the canvas runner, so a tool that needs it must say so rather than assume
	 * it: the same graph is meant to run headlessly, where there is no canvas to read.
	 */
	canvas?: CanvasCapability
	/**
	 * Generate fresh results instead of reusing cached ones.
	 *
	 * Set only by a deliberate "Regenerate" action or the CLI's `--fresh`. An ordinary run reuses
	 * cached generations so that rerunning an unchanged pipeline is free and reproducible.
	 */
	refresh?: boolean
}

/**
 * A tool failure that came back from an HTTP call.
 *
 * Carrying the status means a failure can be classified from fact rather than by pattern-matching
 * the message text, which misreads any prompt that happens to contain a word like "token".
 */
export class ToolHttpError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message)
		this.name = 'ToolHttpError'
	}
}

export function toolErrorStatus(error: unknown): number | undefined {
	return error instanceof ToolHttpError ? error.status : undefined
}

export type ToolCategory = 'input' | 'process' | 'output' | 'utility'
export type ToolIcon = 'text' | 'image' | 'prompt' | 'generate' | 'process' | 'preview' | 'download'

export interface ToolManifest {
	id: string
	title: string
	description: string
	category: ToolCategory
	icon: ToolIcon
	inputs: readonly ToolInputDefinition[]
	outputs: readonly ToolOutputDefinition[]
	/**
	 * Derive additional inputs from a block's current configuration.
	 *
	 * Lets a tool discover its own ports instead of declaring them up front — `prompt.liquid` uses
	 * this to turn each `{{ variable }}` in its template into a connectable text input. Must be
	 * pure, since it is called during rendering, port layout, validation, and execution.
	 */
	dynamicInputs?: (config: Record<string, ToolValue>) => readonly ToolInputDefinition[]
	/**
	 * Draw this block as a transparent window onto the canvas rather than as a panel of rows.
	 *
	 * Declared on the manifest so the canvas stays free of tool-id special cases: anything that
	 * reads a region of the canvas needs a hole to read through, and needs its body left clear of
	 * the result preview that would otherwise cover it.
	 */
	canvasRegion?: boolean
	/**
	 * Which of this tool's `image` outputs carry a collection for a given configuration.
	 *
	 * `image.generate` asked for several images produces an `image[]`, and the canvas and the
	 * validator both have to know that before anything runs — a port is drawn, and a connection
	 * accepted or refused, long before there is a value to inspect. Must be pure, for the same
	 * reason `dynamicInputs` must be.
	 */
	collectionOutputs?: (config: Record<string, ToolValue>) => readonly string[]
}

/**
 * The type an output actually carries, which is not always the type it declares.
 *
 * An `image` output becomes an `image[]` two ways: the step fans out, so the runner maps it over
 * elements and collects the results, or the tool's configuration says this run produces several
 * images. Ports, validation, and connection rules must all agree, so they all come here.
 */
export function effectiveOutputType(
	tool: ToolManifest,
	output: ToolOutputDefinition,
	config: Record<string, ToolValue> | undefined,
	fansOut: boolean
): string {
	if (output.type !== 'image') return output.type
	if (fansOut) return 'image[]'
	return tool.collectionOutputs?.(config ?? {}).includes(output.name) ? 'image[]' : 'image'
}

/**
 * The full input list for a tool given its configuration: declared inputs first, then any
 * discovered ones. Declared inputs win on name collisions.
 *
 * Every consumer that reasons about inputs (ports, node UI, graph validation, the runner) must go
 * through this so discovered ports behave exactly like declared ones.
 */
export function resolveToolInputs(
	tool: ToolManifest,
	config: Record<string, ToolValue> | undefined
): readonly ToolInputDefinition[] {
	if (!tool.dynamicInputs) return tool.inputs
	const declared = new Set(tool.inputs.map((input) => input.name))
	const discovered = tool
		.dynamicInputs(config ?? {})
		.filter((input) => !declared.has(input.name))
	return discovered.length === 0 ? tool.inputs : [...tool.inputs, ...discovered]
}

export interface Tool<Input extends Record<string, ToolValue> = Record<string, ToolValue>>
	extends ToolManifest {
	run: (
		inputs: Input,
		context: ToolContext
	) => Promise<Record<string, ToolValue>>
}

export function isImageValue(value: ToolValue): value is ImageValue {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		'bytes' in value &&
		value.bytes instanceof Uint8Array &&
		'mimeType' in value &&
		typeof value.mimeType === 'string'
	)
}

export function isToolValue(value: unknown): value is ToolValue {
	if (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean' ||
		value instanceof Uint8Array
	) {
		return true
	}
	if (Array.isArray(value)) return value.every(isToolValue)
	if (typeof value !== 'object') return false
	return Object.values(value).every(isToolValue)
}
