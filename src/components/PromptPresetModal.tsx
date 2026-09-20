import { useEffect, useMemo, useState } from 'react'
import {
	deletePipelineFile,
	planPromptPresetRename,
	promptPresetStore,
	promptPresetThumbnail,
	PromptPreset,
	savePipelineFile,
	searchPromptPresets,
	usePromptPresets,
} from '../catalog'
import { ToolValue } from '../tools'
import { WorkflowModal } from './WorkflowModal'

export interface PromptPresetSelection {
	preset: PromptPreset
	/** The preset's raw Liquid template. */
	template: string
	/** Values for the preset's declared variables. */
	variables: Record<string, ToolValue>
}

export interface PromptPresetModalProps {
	open: boolean
	onClose: () => void
	onApply: (selection: PromptPresetSelection) => void
	/** Label for the confirm button, e.g. "Use preset" or "Add preset step". */
	applyLabel?: string
}

/**
 * Browsable catalog of prompt presets shown as image / name / prompt cards.
 *
 * Picking a preset only chooses the template. Its `{{ variables }}` become input ports on the
 * block, and `applyPromptPreset` wires a Text block into each one — so variables are edited on the
 * canvas like any other value rather than in a form here.
 */
export function PromptPresetModal({
	open,
	onClose,
	onApply,
	applyLabel = 'Use preset',
}: PromptPresetModalProps) {
	const [query, setQuery] = useState('')
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [renamingId, setRenamingId] = useState<string | null>(null)
	const [renameValue, setRenameValue] = useState('')
	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
	const [busyId, setBusyId] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (open) return
		setQuery('')
		setSelectedId(null)
		setRenamingId(null)
		setConfirmDeleteId(null)
		setError(null)
	}, [open])

	const allPresets = usePromptPresets()
	const presets = useMemo(() => searchPromptPresets(allPresets, query), [allPresets, query])
	const selected = selectedId ? (presets.find((p) => p.id === selectedId) ?? null) : null

	/**
	 * Rename moves the file too, so the filename and the display name never drift apart.
	 *
	 * `planPromptPresetRename` pins the preset's identity into the document before the move, so
	 * blocks that already applied this preset keep their link to it. The new file is written before
	 * the old one is removed: a failure in between leaves a duplicate, which is recoverable, rather
	 * than no file at all.
	 */
	const commitRename = async (preset: PromptPreset) => {
		const name = renameValue.trim()
		if (!name || name === preset.name) {
			setRenamingId(null)
			return
		}
		setBusyId(preset.id)
		setError(null)
		try {
			const plan = planPromptPresetRename(preset, name, allPresets)
			await savePipelineFile('prompts', plan.fileId, plan.yaml)
			if (plan.removeFileId) await deletePipelineFile('prompts', plan.removeFileId)
			await promptPresetStore.refresh()
			setRenamingId(null)
		} catch (cause) {
			setError(`Rename failed: ${cause instanceof Error ? cause.message : cause}`)
		} finally {
			setBusyId(null)
		}
	}

	const remove = async (preset: PromptPreset) => {
		setBusyId(preset.id)
		setError(null)
		try {
			await deletePipelineFile('prompts', preset.fileId)
			await promptPresetStore.refresh()
			setConfirmDeleteId(null)
			if (selectedId === preset.id) setSelectedId(null)
		} catch (cause) {
			setError(`Delete failed: ${cause instanceof Error ? cause.message : cause}`)
		} finally {
			setBusyId(null)
		}
	}

	const apply = () => {
		if (!selected) return
		// Seed each generated Text block with the preset's declared default, if it has one.
		const variables = Object.fromEntries(
			selected.vars.flatMap((variable) =>
				variable.default === undefined ? [] : [[variable.name, variable.default]]
			)
		)
		onApply({ preset: selected, template: selected.template, variables })
		onClose()
	}

	return (
		<WorkflowModal
			open={open}
			onClose={onClose}
			title="Prompt presets"
			description="Each {{ variable }} becomes a Text block wired into the prompt on the canvas."
			headerAside={
				<button
					className="WorkflowModal-button WorkflowModal-button_primary"
					onClick={apply}
					disabled={!selected}
				>
					{applyLabel}
				</button>
			}
		>
			<div className="WorkflowModal-body">
				<input
					className="PromptPresetModal-search"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Search presets by name or tag"
					aria-label="Search prompt presets"
				/>
				<div className="PromptPresetModal-grid">
					{presets.length === 0 && <div className="WorkflowPanel-empty">No matching presets</div>}
					{presets.map((preset) => (
						<div
							key={preset.id}
							className={`PromptPresetModal-cardWrap${selectedId === preset.id ? ' is-selected' : ''}`}
						>
							<button
								className={`PromptPresetModal-card${selectedId === preset.id ? ' is-selected' : ''}`}
								onClick={() => setSelectedId(preset.id)}
								onDoubleClick={apply}
								aria-pressed={selectedId === preset.id}
							>
								{promptPresetThumbnail(preset) === null ? (
									<span className="PromptPresetModal-thumbFallback" aria-hidden="true">
										{preset.name.slice(0, 1).toUpperCase()}
									</span>
								) : (
									<img src={promptPresetThumbnail(preset)!} alt="" />
								)}
								{renamingId === preset.id ? (
									<span className="PromptPresetModal-renameSlot" />
								) : (
									<strong>{preset.name}</strong>
								)}
								<span className="PromptPresetModal-prompt">{preset.template}</span>
								<small>{preset.tags.join(' · ')}</small>
							</button>

							{renamingId === preset.id ? (
								<div className="PromptPresetModal-rename">
									<input
										value={renameValue}
										autoFocus
										aria-label={`New name for ${preset.name}`}
										onChange={(event) => setRenameValue(event.target.value)}
										onKeyDown={(event) => {
											if (event.key === 'Enter') void commitRename(preset)
											if (event.key === 'Escape') setRenamingId(null)
										}}
									/>
									<button
										className="PromptPresetModal-cardAction"
										disabled={busyId === preset.id || !renameValue.trim()}
										onClick={() => void commitRename(preset)}
									>
										Save
									</button>
									<button
										className="PromptPresetModal-cardAction"
										onClick={() => setRenamingId(null)}
									>
										Cancel
									</button>
								</div>
							) : (
								<div className="PromptPresetModal-cardActions">
									<button
										className="PromptPresetModal-cardAction"
										onClick={() => {
											setConfirmDeleteId(null)
											setRenamingId(preset.id)
											setRenameValue(preset.name)
										}}
									>
										Rename
									</button>
									{confirmDeleteId === preset.id ? (
										<>
											<button
												className="PromptPresetModal-cardAction is-danger"
												disabled={busyId === preset.id}
												onClick={() => void remove(preset)}
											>
												{busyId === preset.id ? 'Deleting…' : 'Confirm'}
											</button>
											<button
												className="PromptPresetModal-cardAction"
												onClick={() => setConfirmDeleteId(null)}
											>
												Cancel
											</button>
										</>
									) : (
										<button
											className="PromptPresetModal-cardAction"
											onClick={() => setConfirmDeleteId(preset.id)}
										>
											Delete
										</button>
									)}
								</div>
							)}
						</div>
					))}
				</div>
				{error && <p className="PromptPresetModal-error">{error}</p>}
			</div>
		</WorkflowModal>
	)
}
