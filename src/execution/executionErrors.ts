import { Editor, TLShapeId } from 'tldraw'
import { NodeError } from '../workflow'
import { EditorAtom } from '../utils'
import { ExecutionFailure } from './CanvasExecution'

/**
 * The failures from the most recent run.
 *
 * This deliberately outlives the CanvasExecution that produced it. The running graph is cleared
 * the moment a run settles, so anything stored there would vanish exactly when the user wants to
 * read why it stopped.
 */
export const executionErrors = new EditorAtom<readonly ExecutionFailure[]>(
	'execution errors',
	() => []
)

export function setExecutionErrors(editor: Editor, failures: readonly ExecutionFailure[]) {
	executionErrors.set(editor, failures)
}

export function clearExecutionErrors(editor: Editor) {
	executionErrors.set(editor, [])
}

/** The failure for one block, so a node can show its own cause without the report open. */
export function nodeExecutionError(editor: Editor, nodeId: TLShapeId): NodeError | null {
	return executionErrors.get(editor).find((failure) => failure.nodeId === nodeId)?.error ?? null
}

/** A short label for the kind of failure, used as the headline of a report row. */
export function errorKindLabel(error: NodeError): string {
	switch (error.kind) {
		case 'auth':
			return 'Not authorised'
		case 'timeout':
			return 'Timed out'
		case 'network':
			return 'Network error'
		case 'validation':
			return 'Invalid input'
		default:
			return 'Failed'
	}
}

/**
 * The one action most likely to fix this failure, or null when there is nothing specific to say.
 *
 * A generic "something went wrong" is worse than silence; only genuinely actionable advice earns
 * a line here.
 */
export function errorHint(error: NodeError): string | null {
	if (error.kind === 'auth') return 'Run `npm run token` to refresh your Azure credentials.'
	if (error.kind === 'network') return 'Check that the dev server is still running.'
	if (error.httpStatus === 429) return 'The model is rate limited. Wait a moment and run again.'
	return null
}
