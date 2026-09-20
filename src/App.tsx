import { useCallback, useState } from 'react'
import { Editor, TLComponents, Tldraw, TldrawOptions } from 'tldraw'
import { promptPresetStore, workflowTemplateStore } from './catalog'
import { ImagePipelineSidebar, WorkflowPanelId } from './components/ImagePipelineSidebar.tsx'
import { ExecutionErrorReport } from './components/ExecutionErrorReport.tsx'
import { OnCanvasNodePicker } from './components/OnCanvasNodePicker.tsx'
import { PipelineRegions } from './components/PipelineRegions.tsx'
import { overrides, PipelineToolbar } from './components/PipelineToolbar.tsx'
import { WorkflowPanel } from './components/WorkflowPanel.tsx'
import { ConnectionBindingUtil } from './connection/ConnectionBindingUtil'
import { ConnectionCenterHandleOverlayUtil } from './connection/ConnectionCenterHandleOverlayUtil'
import { ConnectionShapeUtil } from './connection/ConnectionShapeUtil'
import { keepConnectionsAtBottom } from './connection/keepConnectionsAtBottom'
import { disableTransparency } from './disableTransparency.tsx'
import { startExecution, stopExecution } from './execution/executionState'
import { NodeShapeUtil } from './nodes/NodeShapeUtil'
import { PointingPort } from './ports/PointingPort'
import {
	exportCurrentPageGraph,
	importGraphOnCurrentPage,
	openGraphOnNewPage,
	parseGraph,
	runGraph,
	serializeGraph,
} from './workflow'
import { createBuiltinToolRegistry } from './tools'

const shapeUtils = [NodeShapeUtil, ConnectionShapeUtil]
const bindingUtils = [ConnectionBindingUtil]
const overlayUtils = [ConnectionCenterHandleOverlayUtil]

const components: TLComponents = {
	InFrontOfTheCanvas: () => (
		<>
			<OnCanvasNodePicker />
			<PipelineRegions />
		</>
	),
	Toolbar: PipelineToolbar,
}

const options: Partial<TldrawOptions> = {
	actionShortcutsLocation: 'menu',
	maxPages: 40,
}

function App() {
	const [editor, setEditor] = useState<Editor | null>(null)
	const [activePanel, setActivePanel] = useState<WorkflowPanelId | null>(null)
	const closePanel = useCallback(() => setActivePanel(null), [])

	return (
		<div className="image-pipeline-layout" style={{ position: 'fixed', inset: 0 }}>
			<div className="image-pipeline-sidebar">
				{editor ? (
					<ImagePipelineSidebar
						editor={editor}
						activePanel={activePanel}
						onOpenPanel={setActivePanel}
					/>
				) : (
					<div />
				)}
			</div>
			<div className="image-pipeline-canvas">
				<Tldraw
					persistenceKey="image-pipeline-v2"
					options={options}
					overrides={overrides}
					shapeUtils={shapeUtils}
					bindingUtils={bindingUtils}
					overlayUtils={overlayUtils}
					components={components}
					onMount={(editor) => {
						;(window as any).editor = editor
						if (import.meta.env.DEV) {
							;(window as any).startExecution = startExecution
							;(window as any).stopExecution = stopExecution
							// Programmatic workflow API for console/automation use.
							const registry = createBuiltinToolRegistry()
							;(window as any).workflow = {
								run: (yaml: string, options?: Parameters<typeof runGraph>[2]) =>
									runGraph(parseGraph(yaml), registry, options),
								exportYaml: () => serializeGraph(exportCurrentPageGraph(editor)),
								open: (yaml: string, name = 'Imported workflow') =>
									openGraphOnNewPage(editor, name, parseGraph(yaml)),
							}
							;(window as any).workflowTools = registry
							;(window as any).workflowPromptPresets = promptPresetStore
						}

						setEditor(editor)

						// Create a default pipeline if the canvas is empty
						if (!editor.getCurrentPageShapes().some((s) => s.type === 'node')) {
							void createDefaultPipeline(editor)
						}

						editor.user.updateUserPreferences({ isSnapMode: true })

						editor.getStateDescendant('select')!.addChild(PointingPort)

						keepConnectionsAtBottom(editor)

						disableTransparency(editor, ['connection'])
					}}
				/>
			</div>
			{editor && (
				<WorkflowPanel editor={editor} open={activePanel === 'workflow'} onClose={closePanel} />
			)}
			{editor && <ExecutionErrorReport editor={editor} />}
		</div>
	)
}

/** Create the starter workflow on a new empty document. */
async function createDefaultPipeline(editor: Editor) {
	await workflowTemplateStore.ensureLoaded()
	const starter = workflowTemplateStore.find('game-asset-preview')
	// An empty pipelines directory is a legitimate state, not an error.
	if (!starter) return
	importGraphOnCurrentPage(editor, starter.graph)
}

export default App
