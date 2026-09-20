import { useValue, Editor } from 'tldraw'
import {
	clearExecutionErrors,
	errorHint,
	errorKindLabel,
	executionErrors,
} from '../execution/executionErrors'

/**
 * A report of why the last run stopped.
 *
 * It appears only after a failure and stays until dismissed or until the next run starts. A
 * self-dismissing toast would be wrong here: a generation takes tens of seconds, so the user is
 * often looking elsewhere when it fails, and the message is the whole point of waiting.
 */
export function ExecutionErrorReport({ editor }: { editor: Editor }) {
	const failures = useValue('execution errors', () => executionErrors.get(editor), [editor])

	if (failures.length === 0) return null

	return (
		<div className="ExecutionErrorReport" onPointerDown={(e) => e.stopPropagation()}>
			<div className="ExecutionErrorReport-header">
				<span className="ExecutionErrorReport-title">
					{failures.length === 1 ? 'A block failed' : `${failures.length} blocks failed`}
				</span>
				<button
					className="ExecutionErrorReport-dismiss"
					onClick={() => clearExecutionErrors(editor)}
					title="Dismiss"
				>
					×
				</button>
			</div>
			{failures.map((failure, index) => {
				const hint = errorHint(failure.error)
				return (
					<div className="ExecutionErrorReport-item" key={`${failure.nodeId}-${index}`}>
						<div className="ExecutionErrorReport-itemHeader">
							<span className="ExecutionErrorReport-kind">
								{errorKindLabel(failure.error)}
								{failure.error.httpStatus ? ` (${failure.error.httpStatus})` : ''}
							</span>
							{failure.nodeId && (
								<button
									className="ExecutionErrorReport-locate"
									onClick={() => {
										// Selecting and zooming answers "which block?" faster than a name
										// can, since a canvas often holds several blocks of one kind.
										editor.select(failure.nodeId!)
										editor.zoomToSelection({ animation: { duration: 200 } })
									}}
								>
									{failure.nodeTitle}
								</button>
							)}
						</div>
						<p className="ExecutionErrorReport-message">{failure.error.message}</p>
						{hint && <p className="ExecutionErrorReport-hint">{hint}</p>}
					</div>
				)
			})}
		</div>
	)
}
