import { isMap, parse, parseDocument } from 'yaml'
import { parseLiquidVariables, ToolValue } from '../tools'
import { CatalogStore, useCatalog } from './catalogStore'
import { slugifyPipelineName } from './pipelineApi'

export interface PromptVariable {
	name: string
	type: 'text' | 'int' | 'json'
	required: boolean
	default?: ToolValue
}

export interface PromptPreset {
	/**
	 * Stable identity, referenced by the provenance a block records when it copies this preset.
	 *
	 * Implicitly the filename until a rename moves the file, at which point the old filename is
	 * written into the YAML as `id:` so existing links keep resolving.
	 */
	id: string
	/** The file this preset lives in, without the extension. Reads and writes address this. */
	fileId: string
	name: string
	template: string
	vars: readonly PromptVariable[]
	tags: readonly string[]
	sampleImage?: string
	/** The file exactly as it is on disk, so edits can preserve hand-written formatting. */
	sourceYaml: string
}

/** Filter presets by name, template body, or tag. */
export function searchPromptPresets(
	presets: readonly PromptPreset[],
	query: string
): readonly PromptPreset[] {
	const normalized = query.trim().toLowerCase()
	if (!normalized) return presets
	return presets.filter(
		(preset) =>
			preset.name.toLowerCase().includes(normalized) ||
			preset.template.toLowerCase().includes(normalized) ||
			preset.tags.some((tag) => tag.toLowerCase().includes(normalized))
	)
}

function isPromptVariable(value: unknown): value is PromptVariable {
	if (!value || typeof value !== 'object') return false
	const variable = value as Record<string, unknown>
	return (
		typeof variable.name === 'string' &&
		(variable.type === 'text' || variable.type === 'int' || variable.type === 'json') &&
		typeof variable.required === 'boolean'
	)
}

function parsePromptPreset(fileId: string, yaml: string): PromptPreset {
	const value = parse(yaml) as Record<string, unknown>
	if (
		!value ||
		typeof value.name !== 'string' ||
		typeof value.template !== 'string' ||
		!Array.isArray(value.vars) ||
		!value.vars.every(isPromptVariable) ||
		!Array.isArray(value.tags) ||
		!value.tags.every((tag) => typeof tag === 'string') ||
		(value.id !== undefined && (typeof value.id !== 'string' || value.id === ''))
	) {
		throw new Error(`Invalid prompt preset: ${fileId}.yaml`)
	}
	// The template is the source of truth for which variables exist; `vars` only adds type and
	// default metadata for them. Declaring one the template never uses means the two have drifted.
	const discovered = new Set(parseLiquidVariables(value.template))
	const undeclared = value.vars
		.map((variable) => variable.name)
		.filter((name) => !discovered.has(name))
	if (undeclared.length > 0) {
		throw new Error(
			`Prompt preset "${fileId}.yaml" declares ${undeclared.map((name) => `"${name}"`).join(', ')}, which the template does not use`
		)
	}
	return {
		// Identity is the filename until a rename pins it, so presets that have never moved carry no
		// `id:` line at all — the common file stays clean, and the field appears only when it earns
		// its place.
		id: typeof value.id === 'string' ? value.id : fileId,
		fileId,
		name: value.name,
		template: value.template,
		vars: value.vars,
		tags: value.tags,
		sampleImage: typeof value.image === 'string' ? value.image : undefined,
		sourceYaml: yaml,
	}
}

/** Prompt presets read from `pipelines/prompts/*.yaml`. */
export const promptPresetStore = new CatalogStore<PromptPreset>('prompts', (file) =>
	parsePromptPreset(file.id, file.yaml)
)

/** Subscribe a component to the prompt preset catalog. */
export function usePromptPresets(): readonly PromptPreset[] {
	return useCatalog(promptPresetStore)
}

/**
 * Thumbnail for a preset card, or `null` when the preset ships without one.
 *
 * Presets are hand-authored YAML, so a missing image is an everyday authoring state rather than a
 * fault — callers render a placeholder instead.
 */
export function promptPresetThumbnail(preset: PromptPreset): string | null {
	return preset.sampleImage ?? null
}

/**
 * Stable fingerprint of a prompt template.
 *
 * Applying a preset copies its template into the block, so the copy cannot tell on its own whether
 * the original has moved on since. Recording this alongside the copy lets the app detect that, and
 * offer an explicit re-apply, without ever changing a block behind the user's back.
 *
 * FNV-1a: synchronous, because this runs while rendering a node, which rules out `crypto.subtle`.
 * It guards against accidental drift, not tampering.
 */
export function promptTemplateHash(template: string): string {
	let hash = 0x811c9dc5
	for (let index = 0; index < template.length; index++) {
		hash ^= template.charCodeAt(index)
		hash = Math.imul(hash, 0x01000193) >>> 0
	}
	return hash.toString(36)
}

/**
 * Rewrite a preset file with a new display name, and optionally pin its identity.
 *
 * Presets are hand-authored and committed, so this edits the existing document rather than
 * re-serializing the parsed value: comments, key order, and block style all survive, and the git
 * diff shows only the lines that actually changed.
 */
export function renamePromptPresetYaml(
	sourceYaml: string,
	name: string,
	options: { pinId?: string } = {}
): string {
	const document = parseDocument(sourceYaml)
	document.set('name', name)
	if (options.pinId !== undefined && !document.has('id')) {
		const contents = document.contents
		// Lead with it. An identity belongs at the top of the file, where a reader looks first.
		// The cast is the one place a freshly built node meets a parsed document's node type.
		if (isMap(contents)) {
			const pair = document.createPair('id', options.pinId) as (typeof contents.items)[number]
			contents.items.unshift(pair)
		} else {
			document.set('id', options.pinId)
		}
	}
	// Re-serializing would otherwise pad flow collections and re-wrap long templates, turning a
	// small rename into a noisy diff.
	const yaml = document.toString({ lineWidth: 0, flowCollectionPadding: false })
	// The serializer always emits LF. Checked-out files on Windows are usually CRLF, and rewriting
	// every line ending would bury the real change under a whole-file diff.
	return sourceYaml.includes('\r\n') ? yaml.replace(/\r?\n/g, '\r\n') : yaml
}

/** The file writes and the delete that together carry out a rename. */
export interface PromptPresetRename {
	/** File to write. Differs from the preset's current file when the name changed. */
	fileId: string
	yaml: string
	/** File to remove after the new one lands, or `null` when the rename stayed in place. */
	removeFileId: string | null
}

/**
 * Work out how to rename a preset so its file, its display name, and its identity all stay honest.
 *
 * The filename follows the display name, because the filename is what the team reads in the file
 * tree and in pull requests — letting the two drift apart makes every future reader open the file
 * to learn what it holds.
 *
 * Moving the file would normally orphan the blocks that recorded this preset, since identity was
 * the filename. So a move pins the old filename into the document as `id:` first. Existing
 * provenance keeps resolving, no workflow is touched, and the pinned value explains itself.
 *
 * Throws when the rename would collide with a preset that already exists.
 */
export function planPromptPresetRename(
	preset: PromptPreset,
	name: string,
	presets: readonly PromptPreset[]
): PromptPresetRename {
	const trimmed = name.trim()
	if (!trimmed) throw new Error('A preset needs a name')
	const fileId = slugifyPipelineName(trimmed) || preset.fileId
	if (fileId === preset.fileId) {
		return { fileId, yaml: renamePromptPresetYaml(preset.sourceYaml, trimmed), removeFileId: null }
	}
	if (presets.some((candidate) => candidate.fileId === fileId)) {
		throw new Error(`pipelines/prompts/${fileId}.yaml already exists`)
	}
	const pinId = preset.id === preset.fileId ? preset.fileId : undefined
	if (pinId !== undefined && presets.some((candidate) => candidate !== preset && candidate.id === pinId)) {
		throw new Error(`Another preset already uses the id "${pinId}"`)
	}
	return {
		fileId,
		yaml: renamePromptPresetYaml(preset.sourceYaml, trimmed, { pinId }),
		removeFileId: preset.fileId,
	}
}

/**
 * A preset whose identity a new file at `fileId` would collide with.
 *
 * Only possible once a rename has freed up a filename while keeping it as an identity, so this is
 * rare — but two presets answering to one id would make the drift signal pick the wrong file.
 */
export function promptPresetIdConflict(
	presets: readonly PromptPreset[],
	fileId: string
): PromptPreset | null {
	return presets.find((preset) => preset.id === fileId && preset.fileId !== fileId) ?? null
}

export function validatePromptVariables(
	preset: PromptPreset,
	values: Record<string, ToolValue>
): readonly string[] {
	const errors: string[] = []
	for (const variable of preset.vars) {
		const value = values[variable.name] ?? variable.default
		if (variable.required && (value === undefined || value === '')) {
			errors.push(`${variable.name} is required`)
			continue
		}
		if (value === undefined) continue
		if (variable.type === 'text' && typeof value !== 'string') {
			errors.push(`${variable.name} must be text`)
		}
		if (variable.type === 'int' && (typeof value !== 'number' || !Number.isInteger(value))) {
			errors.push(`${variable.name} must be an integer`)
		}
		if (
			variable.type === 'json' &&
			(typeof value !== 'object' || value === null || Array.isArray(value))
		) {
			errors.push(`${variable.name} must be a JSON object`)
		}
	}
	return errors
}
