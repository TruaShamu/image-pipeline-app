import { useCallback, useEffect, useState } from 'react'
import { Editor } from 'tldraw'
import { deletePipelineFile, useWorkflowTemplates, workflowTemplateStore } from '../catalog'
import { openGraphOnNewPage } from '../workflow'
import { WorkflowModal } from './WorkflowModal'

export interface WorkflowPanelProps {
	editor: Editor
	open: boolean
	onClose: () => void
}

/**
 * Browse the project's workflows and open each on its own canvas page.
 *
 * Every entry is a YAML file in `pipelines/workflows/`, so the list is just a
 * directory listing. There is no saved/built-in distinction: a workflow that
 * ships with the project and one a teammate wrote last week are the same kind
 * of thing, tracked the same way in git.
 */
export function WorkflowPanel({ editor, open, onClose }: WorkflowPanelProps) {
	const [status, setStatus] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	const templates = useWorkflowTemplates()

	useEffect(() => {
		if (open) void workflowTemplateStore.refresh()
	}, [open])

	const openWorkflow = useCallback(
		async (id: string) => {
			if (busy) return
			setBusy(true)
			try {
				const template = workflowTemplateStore.get(id)
				openGraphOnNewPage(editor, template.name, template.graph)
				onClose()
			} catch (error) {
				setStatus(`Open failed: ${error instanceof Error ? error.message : error}`)
			} finally {
				setBusy(false)
			}
		},
		[busy, editor, onClose]
	)

	const remove = useCallback(async (id: string, name: string) => {
		if (!window.confirm(`Delete pipelines/workflows/${id}.yaml?`)) return
		try {
			await deletePipelineFile('workflows', id)
			await workflowTemplateStore.refresh()
			setStatus(`Deleted ${name}`)
		} catch (error) {
			setStatus(`Delete failed: ${error instanceof Error ? error.message : error}`)
		}
	}, [])

	return (
		<WorkflowModal
			open={open}
			onClose={onClose}
			title="Workflows"
			description="Open a workflow from pipelines/workflows on a new canvas page."
			size="medium"
		>
			<div className="WorkflowPanel-manage">
				{templates.length === 0 ? (
					<div className="WorkflowPanel-empty">No workflows in pipelines/workflows</div>
				) : (
					<div className="WorkflowCatalog-list">
						{templates.map((template) => (
							<div className="WorkflowCatalog-item" key={template.id}>
								<button onClick={() => void openWorkflow(template.id)} disabled={busy}>
									<strong>{template.name}</strong>
									<span>{template.description}</span>
									<small>{`${template.id}.yaml`}</small>
								</button>
								<button
									className="WorkflowCatalog-delete"
									onClick={() => void remove(template.id, template.name)}
									disabled={busy}
									aria-label={`Delete ${template.name}`}
								>
									×
								</button>
							</div>
						))}
					</div>
				)}

				<div className="WorkflowPanel-status" aria-live="polite">
					{status}
				</div>
			</div>
		</WorkflowModal>
	)
}
