import { TLUiIconJsx, useEditor, useValue } from 'tldraw'
import { Fragment, useEffect, useMemo, useState } from 'react'
import classNames from 'classnames'
import { PromptPresetModal } from '../../components/PromptPresetModal'
import { SavePresetModal } from '../../components/SavePresetModal'
import { SaveIcon } from '../../components/icons'
import { promptTemplateHash, usePromptPresets } from '../../catalog'
import {
	canvasValueToToolValue,
	toolValueToCanvasValue,
} from '../../execution/canvasValueCodec'
import {
	NODE_CANVAS_REGION_HEIGHT_PX,
	NODE_HEADER_HEIGHT_PX,
	NODE_IMAGE_PREVIEW_HEIGHT_PX,
	NODE_ROW_HEADER_GAP_PX,
	NODE_ROW_HEIGHT_PX,
	NODE_WIDTH_PX,
} from '../../constants'
import { Port, ShapePort } from '../../ports/Port'
import { resolveToolInputs, runToolMapped, ToolValue } from '../../tools'
import { applyPromptPreset } from '../applyPromptPreset'
import { capturePromptPreset } from '../capturePromptPreset'
import { presetName, presetStatus } from '../presetStatus'
import { useModelProblem, useModels } from '../../models/modelCatalog'
import { getNodeInputPortValues } from '../nodePorts'
import { NodeShape } from '../NodeShapeUtil'
import {
	createToolNode,
	getToolIcon,
	ToolNode,
	toolNodeRegistry as registry,
} from '../toolNodeData'
import {
	areAnyInputsOutOfDate,
	ExecutionResult,
	InfoValues,
	InputValues,
	NodeImage,
	NodeImageDownloadButton,
	isMultiInfoValue,
	NodeComponentProps,
	NodeDefinition,
	NodePlaceholder,
	NodePortLabel,
	NodeRow,
	NodeValue,
	PipelineValue,
	STOP_EXECUTION,
	updateNode,
} from './shared'

function displayInfoValue(info: InfoValues[string]): PipelineValue | typeof STOP_EXECUTION {
	if (isMultiInfoValue(info)) {
		return info.value.find((value) => value !== STOP_EXECUTION) ?? null
	}
	return info.value
}

/** Extra UI rows a tool renders beyond its inputs and outputs. */
function extraRowCount(toolId: string): number {
	return toolId === 'prompt.liquid' ? 1 : 0
}

/** Node rows reserved for a `multiline` config field. Keep in sync with index.css. */
const CONFIG_TEXTAREA_ROWS = 3

/**
 * Convert a `<select>` string back to the input's declared type.
 *
 * Option values are always strings, but a numeric input must store a number or it fails literal
 * validation (`isInteger('2')` is false) and reaches tools as the wrong type.
 */
function coerceOptionValue(value: string, type: string): PipelineValue {
	if (type !== 'int' && type !== 'number') return value
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : value
}

/** Rows a single visible input occupies in the node body. */
function inputRowCount(input: { port?: boolean; multiline?: boolean }): number {
	return input.port === false && input.multiline ? CONFIG_TEXTAREA_ROWS : 1
}

/** True when a stored config value already holds image bytes. */
function hasImageBytes(value: PipelineValue | undefined): boolean {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		Array.isArray((value as Record<string, PipelineValue>).bytes)
	)
}

/**
 * The port a block should draw an image preview for, if any.
 *
 * Derived from the manifest rather than listed by tool id, so a new image tool gets a preview
 * without touching this file. A block that produces an image previews its result; a sink that
 * only consumes one (`image.preview`, `image.download`) previews its input.
 */
function imagePreviewPort(
	tool: {
		inputs: readonly { name: string; type: string }[]
		outputs: readonly { name: string; type: string }[]
		canvasRegion?: boolean
	}
): { name: string; source: 'input' | 'output' } | null {
	// A region block's body is a window onto the canvas. Filling it with the captured result
	// would hide the very drawing the next run is meant to read.
	if (tool.canvasRegion) return null
	const isImage = (type: string) => type === 'image' || type === 'image[]'
	const output = tool.outputs.find((candidate) => isImage(candidate.type))
	if (output) return { name: output.name, source: 'output' }
	if (tool.outputs.length > 0) return null
	const input = tool.inputs.find((candidate) => isImage(candidate.type))
	return input ? { name: input.name, source: 'input' } : null
}

/**
 * Render a port's value, using a readable label for images.
 *
 * Images arrive here as data URLs, which `NodeValue` would truncate to `data:image/png;base...`.
 * The bytes are shown in the preview instead, so the row just reports what is present.
 */
function ToolPortValue({
	value,
	type,
}: {
	value: PipelineValue | typeof STOP_EXECUTION
	type: string
}) {
	if (type !== 'image' && type !== 'image[]') return <NodeValue value={value} />
	if (value === STOP_EXECUTION || value == null) return <NodePlaceholder />
	if (Array.isArray(value)) return <>{value.length === 1 ? '1 frame' : `${value.length} frames`}</>
	return <>image</>
}

/**
 * Every renderable image in a value, flattened.
 *
 * Flattening rather than taking the head means an `image[]` can be stepped through, and nested
 * arrays (a map over a map) collapse into one strip instead of previewing only their first entry.
 */
function imageFrames(value: PipelineValue | undefined): PipelineValue[] {
	if (value == null) return []
	if (Array.isArray(value)) return value.flatMap((entry) => imageFrames(entry as PipelineValue))
	if (typeof value === 'string') return value.length > 0 ? [value] : []
	return hasImageBytes(value) ? [value] : []
}

/**
 * Draw the images held by a block, with frame navigation when there is more than one.
 *
 * Handles both representations an image takes on the canvas: a data URL string (how executed
 * outputs are stored) and serialized bytes (how a picked file is stored in config).
 */
function ToolImagePreview({ frames, isLoading }: { frames: PipelineValue[]; isLoading: boolean }) {
	const [index, setIndex] = useState(0)
	// A rerun can return fewer frames than the last one, so an index kept from before could point
	// past the end. Clamping on read beats resetting, which would lose the user's place on every
	// rerun of the same length.
	const safeIndex = frames.length === 0 ? 0 : Math.min(index, frames.length - 1)
	const value = frames[safeIndex] ?? null

	// Object URLs avoid base64-encoding the bytes on every render.
	const objectUrl = useMemo(() => {
		if (!hasImageBytes(value ?? undefined)) return null
		const image = value as unknown as { bytes: number[]; mimeType?: string }
		return URL.createObjectURL(
			new Blob([Uint8Array.from(image.bytes)], { type: image.mimeType ?? 'image/png' })
		)
	}, [value])
	useEffect(() => {
		return () => {
			if (objectUrl) URL.revokeObjectURL(objectUrl)
		}
	}, [objectUrl])

	// Wrapping around suits flipping through an animation, where the last frame precedes the first.
	const step = (delta: number) =>
		setIndex((current) => {
			const from = frames.length === 0 ? 0 : Math.min(current, frames.length - 1)
			return (from + delta + frames.length) % frames.length
		})

	const src = objectUrl ?? (typeof value === 'string' ? value : null)
	return (
		<div className={classNames('NodeImagePreview', { NodeImagePreview_loading: isLoading })}>
			{src ? (
				<>
					<NodeImage src={src} alt={frames.length > 1 ? `Frame ${safeIndex + 1}` : 'Preview'} />
					<NodeImageDownloadButton url={src} />
					{frames.length > 1 && (
						<div
							className="NodeImagePreview-frames"
							// The canvas would otherwise read these clicks as a drag on the block.
							onPointerDown={(e) => e.stopPropagation()}
						>
							<button
								className="NodeImagePreview-frameStep"
								onClick={() => step(-1)}
								title="Previous frame"
							>
								‹
							</button>
							<span className="NodeImagePreview-frameCount">
								{safeIndex + 1}/{frames.length}
							</span>
							<button
								className="NodeImagePreview-frameStep"
								onClick={() => step(1)}
								title="Next frame"
							>
								›
							</button>
						</div>
					)}
				</>
			) : (
				<div className="NodeImagePreview-empty">
					<span>No image to preview</span>
				</div>
			)}
		</div>
	)
}

export class ToolNodeDefinition extends NodeDefinition<ToolNode> {	static type = 'tool'
	static validator = ToolNode
	title = 'Tool'
	heading = undefined
	icon = getToolIcon('process')
	category = 'utility'

	getTitle(node: ToolNode): string {
		return registry.has(node.toolId) ? registry.resolve(node.toolId).title : node.toolId
	}

	getIcon(node: ToolNode): TLUiIconJsx {
		return registry.has(node.toolId) ? getToolIcon(registry.resolve(node.toolId).icon) : this.icon
	}

	getDefault(): ToolNode {
		return createToolNode('const.text')
	}

	getBodyHeightPx(_shape: NodeShape, node: ToolNode): number {
		if (!registry.has(node.toolId)) return NODE_ROW_HEIGHT_PX
		const tool = registry.resolve(node.toolId)
		const inputs = resolveToolInputs(tool, node.config as Record<string, ToolValue>)
		const visibleInputs = inputs.filter((input) => !input.hidden)
		const inputRows = visibleInputs.reduce((total, input) => total + inputRowCount(input), 0)
		const rows = inputRows + tool.outputs.length + extraRowCount(node.toolId)
		const previewHeight = imagePreviewPort(tool) ? NODE_IMAGE_PREVIEW_HEIGHT_PX : 0
		const regionHeight = tool.canvasRegion ? NODE_CANVAS_REGION_HEIGHT_PX : 0
		return Math.max(1, rows) * NODE_ROW_HEIGHT_PX + previewHeight + regionHeight
	}

	getPorts(_shape: NodeShape, node: ToolNode): Record<string, ShapePort> {
		if (!registry.has(node.toolId)) return {}
		const tool = registry.resolve(node.toolId)
		const inputPorts = resolveToolInputs(tool, node.config as Record<string, ToolValue>).filter(
			(input) => input.port !== false
		)
		const ports: Record<string, ShapePort> = {}
		inputPorts.forEach((input, index) => {
			ports[input.name] = {
				id: input.name,
				x: 0,
				y: NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX + NODE_ROW_HEIGHT_PX * (index + 0.5),
				terminal: 'end',
				dataType: input.type,
			}
		})
		tool.outputs.forEach((output, index) => {
			ports[output.name] = {
				id: output.name,
				x: NODE_WIDTH_PX,
				y:
					NODE_HEADER_HEIGHT_PX +
					NODE_ROW_HEADER_GAP_PX +
					NODE_ROW_HEIGHT_PX * (inputPorts.length + index + 0.5),
				terminal: 'start',
				dataType: output.type,
			}
		})
		return ports
	}

	async execute(shape: NodeShape, node: ToolNode, inputs: InputValues): Promise<ExecutionResult> {
		const tool = registry.resolve(node.toolId)
		const config = node.config as Record<string, PipelineValue>
		const values: Record<string, ToolValue> = {}
		for (const input of resolveToolInputs(tool, config as Record<string, ToolValue>)) {
			const raw = inputs[input.name] ?? config[input.name] ?? input.default
			if (raw === undefined || raw === null) {
				if (input.required) throw new Error(`${input.name} is required`)
				continue
			}
			// An array arriving at a scalar image input is decoded as a list, then mapped below.
			const type = input.type === 'image' && Array.isArray(raw) ? 'image[]' : input.type
			values[input.name] = await canvasValueToToolValue(raw as ToolValue, type)
		}
		const outputs = await runToolMapped(tool, values, {
			signal: new AbortController().signal,
			log: (message) => console.debug(`[${node.toolId}] ${message}`),
		})
		const canvasOutputs = Object.fromEntries(
			await Promise.all(
				Object.entries(outputs).map(async ([key, value]) => [
					key,
					await toolValueToCanvasValue(value),
				])
			)
		) as ExecutionResult
		updateNode<ToolNode>(
			this.editor,
			shape,
			(current) => ({
				...current,
				lastOutputs: canvasOutputs as unknown as ToolNode['lastOutputs'],
			}),
			false
		)
		return canvasOutputs
	}

	getOutputInfo(shape: NodeShape, node: ToolNode, inputs: InfoValues): InfoValues {
		if (!registry.has(node.toolId)) return {}
		const outputs = node.lastOutputs as Record<string, PipelineValue>
		return Object.fromEntries(
			registry.resolve(node.toolId).outputs.map((output) => [
				output.name,
				{
					value: outputs[output.name] ?? null,
					isOutOfDate: shape.props.isOutOfDate || areAnyInputsOutOfDate(inputs),
					dataType: output.type,
				},
			])
		)
	}

	Component = ToolNodeComponent
}

function ToolNodeComponent({ shape, node }: NodeComponentProps<ToolNode>) {
	const editor = useEditor()
	const [presetsOpen, setPresetsOpen] = useState(false)
	const [savePresetOpen, setSavePresetOpen] = useState(false)
	const [confirmUpdate, setConfirmUpdate] = useState(false)
	const [fileNames, setFileNames] = useState<Record<string, string>>({})
	const inputs = useValue('tool inputs', () => getNodeInputPortValues(editor, shape.id), [
		editor,
		shape.id,
	])
	const models = useModels()
	const modelProblem = useModelProblem()
	const presets = usePromptPresets()
	const tool = registry.has(node.toolId) ? registry.resolve(node.toolId) : null
	if (!tool) return <NodeRow>Unknown tool: {node.toolId}</NodeRow>
	const config = node.config as Record<string, PipelineValue>
	const outputs = node.lastOutputs as Record<string, PipelineValue>
	const toolInputs = resolveToolInputs(tool, config as Record<string, ToolValue>)
	const drifted = tool.id === 'prompt.liquid' ? presetStatus(config, presets) : null

	const patchConfig = (patch: Record<string, PipelineValue>) =>
		updateNode<ToolNode>(
			editor,
			shape,
			(current) => ({
				...current,
				config: {
					...(current.config as Record<string, PipelineValue>),
					...patch,
				} as unknown as ToolNode['config'],
			}),
			false
		)

	const setConfig = (name: string, value: PipelineValue) => patchConfig({ [name]: value })

	/**
	 * The choices for a picker input, grouped by vendor. Runtime-sourced lists win over declared
	 * ones.
	 *
	 * Model labels arrive as `Vendor · Model`. Splitting on that separator turns one flat list of
	 * ten into a few short groups, and drops a vendor prefix that the narrow control was
	 * ellipsizing away anyway. Labels without the separator stay ungrouped.
	 *
	 * The current value is always included, so a model that is no longer offered — an unconfigured
	 * provider, a workflow authored elsewhere — stays visible instead of silently switching.
	 */
	const optionGroupsFor = (input: (typeof toolInputs)[number]) => {
		const VENDOR_SEPARATOR = ' · '
		const declared =
			input.optionsSource === 'models'
				? models.map((model) => ({ value: model.id, label: model.label }))
				: (input.options ?? [])
		const current = String(config[input.name] ?? input.default ?? '')
		const options =
			!current || declared.some((option) => option.value === current)
				? declared
				: [...declared, { value: current, label: `${current} (unavailable)` }]

		// A Map keeps the vendors in the order the server listed them.
		const groups = new Map<string, { value: string; label: string }[]>()
		for (const option of options) {
			const at = option.label.indexOf(VENDOR_SEPARATOR)
			const vendor = at === -1 ? '' : option.label.slice(0, at)
			const label = at === -1 ? option.label : option.label.slice(at + VENDOR_SEPARATOR.length)
			const existing = groups.get(vendor)
			if (existing) existing.push({ value: option.value, label })
			else groups.set(vendor, [{ value: option.value, label }])
		}
		return [...groups].map(([vendor, entries]) => ({ vendor, options: entries }))
	}

	const preview = imagePreviewPort(tool)
	const previewInfo = preview && preview.source === 'input' ? inputs[preview.name] : null
	const previewRaw = !preview
		? null
		: preview.source === 'output'
			? outputs[preview.name]
			: previewInfo
				? displayInfoValue(previewInfo)
				: (config[preview.name] ?? null)
	const previewFrames = imageFrames(
		previewRaw === STOP_EXECUTION ? null : (previewRaw as PipelineValue | undefined)
	)

	return (
		<>
			{tool.canvasRegion && (
				<div
					className="ToolNode-region"
					style={{ height: NODE_CANVAS_REGION_HEIGHT_PX }}
					title="Draw inside this area, then run the block"
				/>
			)}
			{toolInputs
				.filter((input) => input.port !== false)
				.map((input) => (
					<NodeRow key={input.name}>
						<Port shapeId={shape.id} portId={input.name} />
						<NodePortLabel dataType={input.type}>{input.name}</NodePortLabel>
						<span className="NodeRow-connected-value">
							{inputs[input.name] ? (
								<ToolPortValue value={displayInfoValue(inputs[input.name])} type={input.type} />
							) : (
								'not connected'
							)}
						</span>
					</NodeRow>
				))}
			{tool.outputs.map((output) => (
				<NodeRow key={output.name}>
					<NodePortLabel dataType={output.type}>{output.name}</NodePortLabel>
					<span className="NodeRow-connected-value">
						{outputs[output.name] == null ? (
							<NodePlaceholder />
						) : (
							<ToolPortValue value={outputs[output.name]} type={output.type} />
						)}
					</span>
					<Port shapeId={shape.id} portId={output.name} />
				</NodeRow>
			))}
			{preview && (
				<ToolImagePreview frames={previewFrames} isLoading={shape.props.isOutOfDate} />
			)}
			{toolInputs
				.filter((input) => input.port === false && !input.hidden)
				.map((input) => (
					<NodeRow
						className={`ToolNode-configRow${input.multiline ? ' ToolNode-configRow_multiline' : ''}`}
						key={input.name}
					>
						<label className="ToolNode-configLabel">{input.name}</label>
						{input.options || input.optionsSource ? (
							<select
								value={String(config[input.name] ?? input.default ?? '')}
								title={
									// An empty picker looks like a broken app. The server knows the real
									// cause, so say it here rather than leaving a blank dropdown.
									input.optionsSource === 'models' && models.length === 0 && modelProblem
										? modelProblem
										: String(config[input.name] ?? input.default ?? '')
								}
								onPointerDown={(event) => event.stopPropagation()}
								onChange={(event) =>
									setConfig(input.name, coerceOptionValue(event.target.value, input.type))
								}
							>
								{input.optionsSource === 'models' && models.length === 0 && modelProblem && (
									<option value="" disabled>
										{modelProblem}
									</option>
								)}
								{optionGroupsFor(input).map((group) => {
									const options = group.options.map((option) => (
										<option key={option.value} value={option.value}>
											{option.label}
										</option>
									))
									return group.vendor === '' ? (
										<Fragment key="ungrouped">{options}</Fragment>
									) : (
										<optgroup key={group.vendor} label={group.vendor}>
											{options}
										</optgroup>
									)
								})}
							</select>
						) : input.type === 'image' ? (
							<label
								className="ToolNode-filePicker"
								onPointerDown={(event) => event.stopPropagation()}
							>
								<span>
									{fileNames[input.name] ??
										(hasImageBytes(config[input.name]) ? 'Image selected' : 'Choose image')}
								</span>
								<input
									type="file"
									accept="image/*"
									onPointerDown={(event) => event.stopPropagation()}
									onChange={(event) => {
										const file = event.target.files?.[0]
										if (!file) return
										const reader = new FileReader()
										reader.onload = () => {
											if (!(reader.result instanceof ArrayBuffer)) return
											setFileNames((current) => ({ ...current, [input.name]: file.name }))
											setConfig(input.name, {
												bytes: Array.from(new Uint8Array(reader.result)),
												mimeType: file.type || 'application/octet-stream',
											})
										}
										reader.readAsArrayBuffer(file)
									}}
								/>
							</label>
						) : input.type === 'json' ? (
							<textarea
								value={JSON.stringify(config[input.name] ?? {}, null, 2)}
								onPointerDown={(event) => event.stopPropagation()}
								onChange={(event) => {
									try {
										setConfig(input.name, JSON.parse(event.target.value) as PipelineValue)
									} catch {
										// Keep the previous valid JSON value while the user is typing.
									}
								}}
							/>
						) : input.multiline ? (
							<textarea
								className="ToolNode-textarea"
								value={String(config[input.name] ?? input.default ?? '')}
								onPointerDown={(event) => event.stopPropagation()}
								onFocus={() => editor.setSelectedShapes([shape.id])}
								onChange={(event) => setConfig(input.name, event.target.value)}
							/>
						) : (
							<input
								type={input.type === 'int' || input.type === 'number' ? 'number' : 'text'}
								value={String(config[input.name] ?? '')}
								onPointerDown={(event) => event.stopPropagation()}
								onChange={(event) =>
									setConfig(
										input.name,
										input.type === 'int' || input.type === 'number'
											? Number(event.target.value)
											: event.target.value
									)
								}
							/>
						)}
					</NodeRow>
				))}
			{tool.id === 'prompt.liquid' && (
				<>
					<NodeRow className="ToolNode-configRow">
						<label className="ToolNode-configLabel">preset</label>
						<button
							className="ToolNode-presetButton"
							onPointerDown={(event) => event.stopPropagation()}
							onClick={() => setPresetsOpen(true)}
						>
							{presetName(config) ?? 'Browse presets'}
						</button>
						{drifted?.upstreamChanged && (
							<button
								className={`ToolNode-presetDriftButton${drifted.edited ? ' is-destructive' : ''}`}
								title={
									drifted.edited
										? `"${drifted.preset.name}" has changed, and this block was edited after it was copied. Updating replaces those edits.`
										: `"${drifted.preset.name}" has changed since this block used it. Click to take the new version.`
								}
								aria-label={`Update to the current version of ${drifted.preset.name}`}
								onPointerDown={(event) => event.stopPropagation()}
								onClick={() => {
									// An edited block loses work here, so make that a deliberate second click
									// rather than something that happens on the way past.
									if (drifted.edited && !confirmUpdate) {
										setConfirmUpdate(true)
										return
									}
									setConfirmUpdate(false)
									applyPromptPreset(editor, shape, drifted.preset.template, {}, {
										id: drifted.preset.id,
										name: drifted.preset.name,
										hash: promptTemplateHash(drifted.preset.template),
									} as PipelineValue)
								}}
							>
								{drifted.edited && confirmUpdate ? 'Replace edits?' : 'Update'}
							</button>
						)}
						{drifted?.edited && !drifted.upstreamChanged && (
							<span
								className="ToolNode-presetEdited"
								title={`This prompt was edited after it was copied from "${drifted.preset.name}".`}
							>
								edited
							</span>
						)}
						<button
							className="ToolNode-presetSaveButton"
							title="Save this prompt as a preset"
							aria-label="Save this prompt as a preset"
							onPointerDown={(event) => event.stopPropagation()}
							onClick={() => setSavePresetOpen(true)}
						>
							<SaveIcon />
						</button>
					</NodeRow>
					<PromptPresetModal
						open={presetsOpen}
						onClose={() => setPresetsOpen(false)}
						onApply={({ preset, template, variables }) =>
							// Provenance only — the template itself is copied into config. Storing the
							// preset's `vars` here too would be a second copy that goes stale on its own,
							// and nothing reads it: the ports come from the template. The hash is what
							// lets the block notice later that the preset has moved on.
							applyPromptPreset(editor, shape, template, variables, {
								id: preset.id,
								name: preset.name,
								hash: promptTemplateHash(preset.template),
							} as PipelineValue)
						}
					/>
					{savePresetOpen && (
						<SavePresetModal
							open={savePresetOpen}
							onClose={() => setSavePresetOpen(false)}
							captured={capturePromptPreset(editor, shape)}
							suggestedName={presetName(config) ?? undefined}
						/>
					)}
				</>
			)}
		</>
	)
}
