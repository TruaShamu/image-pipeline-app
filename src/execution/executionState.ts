import { Editor, TLShapeId } from 'tldraw'
import { EditorAtom } from '../utils'
import { CanvasExecution, ExecutionFailure } from './CanvasExecution'
import { clearExecutionErrors, setExecutionErrors } from './executionErrors'

export interface ExecutionState {
	runningGraph: CanvasExecution | null
}

export const executionState = new EditorAtom<ExecutionState>('execution state', () => ({
	runningGraph: null,
}))

export async function startExecution(
	editor: Editor,
	startingNodeIds: Set<TLShapeId>
): Promise<CanvasExecution> {
	const graph = new CanvasExecution(editor, startingNodeIds)
	executionState.update(editor, (state) => {
		state.runningGraph?.stop()
		return {
			...state,
			runningGraph: graph,
		}
	})
	// Last run's failures are stale the instant a new run starts.
	clearExecutionErrors(editor)
	try {
		await graph.execute()
		setExecutionErrors(editor, graph.getFailures())
	} catch (cause) {
		// execute() throws only when the run could not proceed at all, which is a whole-run
		// problem rather than one block's. Report it alongside any node failures already seen.
		setExecutionErrors(editor, [...graph.getFailures(), runFailure(cause)])
	} finally {
		executionState.update(editor, (state) => {
			if (state.runningGraph !== graph) return state
			return { ...state, runningGraph: null }
		})
	}
	return graph
}

/** A whole-run failure, shaped like a node failure so the report renders one kind of thing. */
function runFailure(cause: unknown): ExecutionFailure {
	return {
		nodeId: null,
		nodeTitle: 'Workflow',
		error: {
			kind: 'validation',
			message: cause instanceof Error ? cause.message : String(cause),
		},
	}
}

export function stopExecution(editor: Editor) {
	executionState.update(editor, (state) => {
		if (!state.runningGraph) return state
		state.runningGraph.stop()
		return { ...state, runningGraph: null }
	})
}
