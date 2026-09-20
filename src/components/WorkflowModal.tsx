import { ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** Keep in sync with the exit animation duration in index.css. */
const EXIT_DURATION_MS = 120

export interface WorkflowModalProps {
	open: boolean
	onClose: () => void
	title: string
	description?: string
	headerAside?: ReactNode
	children: ReactNode
	size?: 'medium' | 'large'
}

/**
 * Large centred dialog used by the workflow surfaces.
 *
 * The dialog stays mounted for the length of the exit animation so closing flies out instead of
 * disappearing. Escape and backdrop clicks close it, and focus returns to whatever opened it.
 *
 * It renders through a portal so it can also be opened from inside a canvas shape, whose ancestors
 * carry tldraw's camera transform and would otherwise break `position: fixed`.
 */
export function WorkflowModal({
	open,
	onClose,
	title,
	description,
	headerAside,
	children,
	size = 'large',
}: WorkflowModalProps) {
	const dialogRef = useRef<HTMLDivElement>(null)
	const restoreFocusRef = useRef<HTMLElement | null>(null)
	const [mounted, setMounted] = useState(open)
	const [closing, setClosing] = useState(false)

	useEffect(() => {
		if (open) {
			setMounted(true)
			setClosing(false)
			return
		}
		if (!mounted) return
		setClosing(true)
		const timer = window.setTimeout(() => {
			setMounted(false)
			setClosing(false)
		}, EXIT_DURATION_MS)
		return () => window.clearTimeout(timer)
	}, [mounted, open])

	useEffect(() => {
		if (!open || !mounted) return
		restoreFocusRef.current = document.activeElement as HTMLElement | null
		dialogRef.current?.focus()
		return () => restoreFocusRef.current?.focus()
	}, [mounted, open])

	useEffect(() => {
		if (!open) return
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			event.preventDefault()
			event.stopPropagation()
			onClose()
		}
		document.addEventListener('keydown', onKeyDown, true)
		return () => document.removeEventListener('keydown', onKeyDown, true)
	}, [onClose, open])

	if (!mounted) return null

	return createPortal(
		<div
			className={`WorkflowModal tl-theme__light${closing ? ' is-closing' : ''}`}
			/*
			 * React portals propagate events through the React tree rather than the DOM tree, so a
			 * modal opened from a canvas shape would otherwise hand its pointer events to tldraw,
			 * which captures the pointer and swallows the resulting clicks.
			 */
			onPointerDown={(event) => event.stopPropagation()}
			onPointerUp={(event) => event.stopPropagation()}
			onPointerMove={(event) => event.stopPropagation()}
			onClick={(event) => event.stopPropagation()}
			onWheel={(event) => event.stopPropagation()}
		>
			<div className="WorkflowModal-backdrop" onClick={onClose} />
			<div
				className={`WorkflowModal-dialog WorkflowModal-dialog_${size}`}
				role="dialog"
				aria-modal="true"
				aria-label={title}
				tabIndex={-1}
				ref={dialogRef}
			>
				<header className="WorkflowModal-header">
					<div className="WorkflowModal-heading">
						<h2>{title}</h2>
						{description && <p>{description}</p>}
					</div>
					{headerAside && <div className="WorkflowModal-headerAside">{headerAside}</div>}
					<button
						className="WorkflowModal-close"
						onClick={onClose}
						aria-label={`Close ${title}`}
					>
						×
					</button>
				</header>
				<div className="WorkflowModal-content">{children}</div>
			</div>
		</div>,
		document.body
	)
}
