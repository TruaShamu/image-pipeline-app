import { PromptPreset, promptTemplateHash } from '../catalog'
import { PipelineValue } from './types/shared'

/** Name of the preset currently applied to a Liquid Prompt block, if any. */
export function presetName(config: Record<string, PipelineValue>): string | null {
	const preset = config.preset
	if (typeof preset !== 'object' || preset === null || Array.isArray(preset)) return null
	const name = (preset as Record<string, PipelineValue>).name
	return typeof name === 'string' ? name : null
}

/** Provenance recorded when a preset was applied to this block. */
export function presetProvenance(
	config: Record<string, PipelineValue>
): { id: string; hash: string | null } | null {
	const preset = config.preset
	if (typeof preset !== 'object' || preset === null || Array.isArray(preset)) return null
	const record = preset as Record<string, PipelineValue>
	if (typeof record.id !== 'string' || record.id === '') return null
	return { id: record.id, hash: typeof record.hash === 'string' ? record.hash : null }
}

/** How a Liquid Prompt block stands relative to the preset it was copied from. */
export interface PresetStatus {
	preset: PromptPreset
	/** The block's template differs from the one it copied — someone edited it here. */
	edited: boolean
	/** The preset's template differs from the one this block copied — it moved on upstream. */
	upstreamChanged: boolean
}

/**
 * Compare a block against its preset, on both sides.
 *
 * Three templates are involved: the one recorded when the preset was applied, the one the block
 * holds now, and the one the preset holds now. Checking the stored hash against both is what
 * separates "I changed this" from "the preset changed". Comparing only the preset side would offer
 * an Update to a locally edited block and discard those edits without saying so.
 *
 * Returns `null` when there is nothing to report: no preset, a preset that has been deleted, or
 * provenance saved before hashes existed. That last case is why a missing hash means "unknown"
 * rather than "drifted" — old workflows must not nag.
 */
export function presetStatus(
	config: Record<string, PipelineValue>,
	presets: readonly PromptPreset[]
): PresetStatus | null {
	const provenance = presetProvenance(config)
	if (!provenance || provenance.hash === null) return null
	const preset = presets.find((candidate) => candidate.id === provenance.id)
	if (!preset) return null
	const template = typeof config.template === 'string' ? config.template : ''
	return {
		preset,
		edited: promptTemplateHash(template) !== provenance.hash,
		upstreamChanged: promptTemplateHash(preset.template) !== provenance.hash,
	}
}
