import { useCallback, useRef, useState } from 'react'
import { Editor } from 'tldraw'
import { savePipelineFile, slugifyPipelineName, workflowTemplateStore } from '../catalog'
import { exportCurrentPageGraph, openWorkflowYamlOnNewPage, serializeGraph } from '../workflow'
import { DownloadIcon, ImportIcon, SaveIcon, WorkflowsIcon } from './icons'

function downloadTextFile(filename: string, text: string) {
	const blob = new Blob([text], { type: 'text/yaml' })
	const url = URL.createObjectURL(blob)
	const anchor = document.createElement('a')
	anchor.href = url
	anchor.download = filename
	document.body.appendChild(anchor)
	anchor.click()
	anchor.remove()
	URL.revokeObjectURL(url)
}

export interface WorkflowActionsProps {
	editor: Editor
	catalogOpen: boolean
	onOpenCatalog: () => void
}

/**
 * Page-level workflow actions shown in the sidebar: open the catalog, save the current page as a
 * workflow, and download/import YAML. These act on the current canvas page, using its name as the
 * workflow identity, so they live outside the catalog modal.
 */
export function WorkflowActions({ editor, catalogOpen, onOpenCatalog }: WorkflowActionsProps) {
	const [status, setStatus] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	const fileInputRef = useRef<HTMLInputElement>(null)

	const currentYaml = useCallback(() => {
		const name = editor.getCurrentPage().name.trim() || 'Untitled workflow'
		// A description and tags are written by hand and have no on-canvas representation, so
		// carry forward whatever the file already had. Saving is an update, not a replacement.
		const existing = workflowTemplateStore.find(slugifyPipelineName(name))
		return serializeGraph(exportCurrentPageGraph(editor), {
			name,
			description: existing?.description,
			tags: existing?.tags,
		})
	}, [editor])

	const save = useCallback(async () => {
		if (busy) return
		setBusy(true)
		try {
			const name = editor.getCurrentPage().name.trim() || 'Untitled workflow'
			const id = slugifyPipelineName(name)
			// Preserving the existing description and tags requires having read them first.
			await workflowTemplateStore.ensureLoaded()
			await savePipelineFile('workflows', id, currentYaml())
			await workflowTemplateStore.refresh()
			setStatus(`Saved pipelines/workflows/${id}.yaml`)
		} catch (error) {
			setStatus(`Save failed: ${error instanceof Error ? error.message : error}`)
		} finally {
			setBusy(false)
		}
	}, [busy, currentYaml, editor])

	const download = useCallback(async () => {
		try {
			const name = editor.getCurrentPage().name.trim() || 'workflow'
			await workflowTemplateStore.ensureLoaded()
			downloadTextFile(`${slugifyPipelineName(name)}.yaml`, currentYaml())
			setStatus(`Downloaded ${slugifyPipelineName(name)}.yaml`)
		} catch (error) {
			setStatus(`Download failed: ${error instanceof Error ? error.message : error}`)
		}
	}, [currentYaml, editor])

	const importFile = useCallback(
		async (file: File) => {
			try {
				const yaml = await file.text()
				const pageName = file.name.replace(/\.ya?ml$/i, '') || 'Imported workflow'
				openWorkflowYamlOnNewPage(editor, pageName, yaml)
				setStatus(`Imported ${file.name}`)
			} catch (error) {
				setStatus(`Import failed: ${error instanceof Error ? error.message : error}`)
			}
		},
		[editor]
	)

	return (
		<div className="ImagePipelineSidebar-group">
			<div className="ImagePipelineSidebar-category">Workflows</div>
			<button
				className="ImagePipelineSidebar-item"
				aria-haspopup="dialog"
				aria-expanded={catalogOpen}
				onClick={onOpenCatalog}
			>
				<span className="ImagePipelineSidebar-item-icon">
					<WorkflowsIcon />
				</span>
				<span className="ImagePipelineSidebar-item-title">Catalog</span>
			</button>
			<button className="ImagePipelineSidebar-item" onClick={() => void save()} disabled={busy}>
				<span className="ImagePipelineSidebar-item-icon">
					<SaveIcon />
				</span>
				<span className="ImagePipelineSidebar-item-title">Save page</span>
			</button>
			<button className="ImagePipelineSidebar-item" onClick={() => void download()}>
				<span className="ImagePipelineSidebar-item-icon">
					<DownloadIcon />
				</span>
				<span className="ImagePipelineSidebar-item-title">Download YAML</span>
			</button>
			<button
				className="ImagePipelineSidebar-item"
				onClick={() => fileInputRef.current?.click()}
			>
				<span className="ImagePipelineSidebar-item-icon">
					<ImportIcon />
				</span>
				<span className="ImagePipelineSidebar-item-title">Import YAML</span>
			</button>
			<input
				ref={fileInputRef}
				type="file"
				accept=".yaml,.yml,text/yaml"
				style={{ display: 'none' }}
				onChange={(event) => {
					const file = event.target.files?.[0]
					if (file) void importFile(file)
					event.target.value = ''
				}}
			/>
			{status && (
				<div className="ImagePipelineSidebar-status" aria-live="polite">
					{status}
				</div>
			)}
		</div>
	)
}
