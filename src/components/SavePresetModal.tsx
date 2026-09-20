import { useEffect, useMemo, useState } from 'react'
import {
	promptPresetIdConflict,
	promptPresetStore,
	savePipelineFile,
	slugifyPipelineName,
	usePromptPresets,
} from '../catalog'
import { CapturedPrompt, parseTagInput, promptPresetYaml } from '../nodes/capturePromptPreset'
import { WorkflowModal } from './WorkflowModal'

export interface SavePresetModalProps {
	open: boolean
	onClose: () => void
	captured: CapturedPrompt
	/** Name suggested when the dialog opens, usually the applied preset's name. */
	suggestedName?: string
}

/**
 * Save the current Liquid Prompt block to `pipelines/prompts/` as a reusable preset.
 *
 * Presets are copied on use, not referenced, so saving one never changes a workflow that already
 * exists. That makes this a safe, additive action.
 */
export function SavePresetModal({
	open,
	onClose,
	captured,
	suggestedName,
}: SavePresetModalProps) {
	const [name, setName] = useState('')
	const [tags, setTags] = useState('')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const existing = usePromptPresets()

	useEffect(() => {
		if (!open) return
		setName(suggestedName ?? '')
		setTags('')
		setError(null)
	}, [open, suggestedName])

	const id = useMemo(() => (name.trim() ? slugifyPipelineName(name.trim()) : ''), [name])
	const overwrites = useMemo(
		() => (id ? existing.some((preset) => preset.fileId === id) : false),
		[existing, id]
	)
	// A renamed preset keeps its old filename as its identity, which can leave that filename free
	// on disk but still spoken for. Saving into it would give two presets one identity.
	const idConflict = useMemo(
		() => (id ? promptPresetIdConflict(existing, id) : null),
		[existing, id]
	)
	const canSave =
		name.trim().length > 0 && captured.template.trim().length > 0 && !busy && !idConflict

	const save = async () => {
		if (!canSave) return
		setBusy(true)
		setError(null)
		try {
			await savePipelineFile(
				'prompts',
				id,
				promptPresetYaml(name.trim(), captured, parseTagInput(tags))
			)
			await promptPresetStore.refresh()
			onClose()
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause))
		} finally {
			setBusy(false)
		}
	}

	return (
		<WorkflowModal
			open={open}
			onClose={onClose}
			title="Save as preset"
			description="Writes a YAML file into pipelines/prompts/, ready to commit and share."
			size="medium"
			headerAside={
				<button
					className="WorkflowModal-button WorkflowModal-button_primary"
					onClick={() => void save()}
					disabled={!canSave}
				>
					{busy ? 'Saving…' : 'Save preset'}
				</button>
			}
		>
			<div className="WorkflowModal-body SavePresetModal">
				<label className="SavePresetModal-field">
					<span>Name</span>
					<input
						value={name}
						autoFocus
						placeholder="Pixel Art Hero"
						onChange={(event) => setName(event.target.value)}
					/>
				</label>
				<label className="SavePresetModal-field">
					<span>Tags</span>
					<input
						value={tags}
						placeholder="pixel-art, character"
						onChange={(event) => setTags(event.target.value)}
					/>
				</label>

				{id && (
					<p className="SavePresetModal-path">
						pipelines/prompts/{id}.yaml
						{overwrites && (
							<strong className="SavePresetModal-warning"> — overwrites an existing preset</strong>
						)}
					</p>
				)}

				{idConflict && (
					<p className="SavePresetModal-warning">
						“{idConflict.name}” was renamed out of this filename but still answers to it. Pick a
						different name.
					</p>
				)}

				<div className="SavePresetModal-preview">
					<span className="SavePresetModal-previewLabel">Template</span>
					<pre>{captured.template || 'This block has no template yet.'}</pre>
				</div>

				<div className="SavePresetModal-preview">
					<span className="SavePresetModal-previewLabel">
						Variables ({captured.vars.length})
					</span>
					{captured.vars.length === 0 ? (
						<p className="SavePresetModal-hint">
							The template has no {'{{ variables }}'}, so the preset is a fixed prompt.
						</p>
					) : (
						<ul className="SavePresetModal-vars">
							{captured.vars.map((variable) => (
								<li key={variable.name}>
									<code>{variable.name}</code>
									{variable.default === undefined ? (
										<em>no default</em>
									) : (
										<span>{variable.default}</span>
									)}
								</li>
							))}
						</ul>
					)}
				</div>

				{error && <p className="SavePresetModal-warning">Save failed: {error}</p>}
			</div>
		</WorkflowModal>
	)
}
