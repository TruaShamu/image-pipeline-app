import { ReactNode } from 'react'

/**
 * Single source of truth for all inline icons.
 *
 * Every icon renders through the shared {@link Svg} wrapper so they share one size (16×16),
 * viewBox, and `currentColor` behaviour. Both the bespoke node definitions and the generic
 * tool path (see `getToolIcon`) resolve their glyphs from here — there is no second icon system.
 */
function Svg({ children }: { children: ReactNode }) {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
			{children}
		</svg>
	)
}

export function AddIcon() {
	return (
		<Svg>
			<path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		</Svg>
	)
}

export function SubtractIcon() {
	return (
		<Svg>
			<path d="M3 8H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		</Svg>
	)
}

export function PlayIcon() {
	return (
		<Svg>
			<path d="M5 3L13 8L5 13V3Z" fill="currentColor" />
		</Svg>
	)
}

export function StopIcon() {
	return (
		<Svg>
			<rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" />
		</Svg>
	)
}

export function AdjustIcon() {
	return (
		<Svg>
			<path d="M2 4H6M10 4H14" stroke="currentColor" strokeWidth="1.33" strokeLinecap="round" />
			<circle cx="8" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.33" />
			<path d="M2 8H4M8 8H14" stroke="currentColor" strokeWidth="1.33" strokeLinecap="round" />
			<circle cx="6" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.33" />
			<path d="M2 12H9M13 12H14" stroke="currentColor" strokeWidth="1.33" strokeLinecap="round" />
			<circle cx="11" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.33" />
		</Svg>
	)
}

export function BlendIcon() {
	return (
		<Svg>
			<circle cx="6.5" cy="7" r="4" stroke="currentColor" strokeWidth="1.33" />
			<circle cx="9.5" cy="9" r="4" stroke="currentColor" strokeWidth="1.33" />
		</Svg>
	)
}

export function CaptureIcon() {
	return (
		<Svg>
			<path
				d="M2 5.5V3.5C2 2.67 2.67 2 3.5 2H5.5M10.5 2H12.5C13.33 2 14 2.67 14 3.5V5.5M14 10.5V12.5C14 13.33 13.33 14 12.5 14H10.5M5.5 14H3.5C2.67 14 2 13.33 2 12.5V10.5"
				stroke="currentColor"
				strokeWidth="1.33"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</Svg>
	)
}

export function ControlNetIcon() {
	return (
		<Svg>
			<rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
			<path
				d="M5 11L7 7L9 9L11 5"
				stroke="currentColor"
				strokeWidth="1.2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<circle cx="5" cy="11" r="1" fill="currentColor" />
			<circle cx="11" cy="5" r="1" fill="currentColor" />
		</Svg>
	)
}

export function GenerateIcon() {
	return (
		<Svg>
			<path
				d="M8 2V4M8 12V14M2 8H4M12 8H14M4.22 4.22L5.64 5.64M10.36 10.36L11.78 11.78M11.78 4.22L10.36 5.64M5.64 10.36L4.22 11.78"
				stroke="currentColor"
				strokeWidth="1.33"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.33" />
		</Svg>
	)
}

export function GenerateTextIcon() {
	return (
		<Svg>
			<path
				d="M3 4H10M3 8H8M3 12H6"
				stroke="currentColor"
				strokeWidth="1.33"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="M12.5 7L13.1 8.4L14.5 9L13.1 9.6L12.5 11L11.9 9.6L10.5 9L11.9 8.4L12.5 7Z"
				fill="currentColor"
			/>
		</Svg>
	)
}

export function IteratorIcon() {
	return (
		<Svg>
			<path d="M4 4h8M4 8h8M4 12h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
			<path
				d="M12 2l2 2-2 2M12 6l2 2-2 2M12 10l2 2-2 2"
				stroke="currentColor"
				strokeWidth="1"
				strokeLinecap="round"
				strokeLinejoin="round"
				opacity="0.5"
			/>
		</Svg>
	)
}

export function LoadImageIcon() {
	return (
		<Svg>
			<rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.33" />
			<circle cx="5.5" cy="6.5" r="1.25" stroke="currentColor" strokeWidth="1.1" />
			<path
				d="M2 11L5.5 8L8 10L10.5 7.5L14 11"
				stroke="currentColor"
				strokeWidth="1.33"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</Svg>
	)
}

export function ModelIcon() {
	return (
		<Svg>
			<path
				d="M8 2L13 5V11L8 14L3 11V5L8 2Z"
				stroke="currentColor"
				strokeWidth="1.33"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="M8 8L13 5M8 8L3 5M8 8V14"
				stroke="currentColor"
				strokeWidth="1.33"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</Svg>
	)
}

export function NumberIcon() {
	return (
		<Svg>
			<path
				d="M5 2L4 14M12 2L11 14M2 5.5H14M2 10.5H14"
				stroke="currentColor"
				strokeWidth="1.33"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</Svg>
	)
}

export function PreviewIcon() {
	return (
		<Svg>
			<path
				d="M2 8C2 8 4.5 3 8 3C11.5 3 14 8 14 8C14 8 11.5 13 8 13C4.5 13 2 8 2 8Z"
				stroke="currentColor"
				strokeWidth="1.33"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.33" />
		</Svg>
	)
}

export function PromptConcatIcon() {
	return (
		<Svg>
			<rect x="1" y="2" width="5" height="3" rx="0.5" fill="currentColor" opacity="0.5" />
			<rect x="1" y="6.5" width="5" height="3" rx="0.5" fill="currentColor" opacity="0.5" />
			<rect x="1" y="11" width="5" height="3" rx="0.5" fill="currentColor" opacity="0.5" />
			<path d="M7.5 3.5L9 8L7.5 12.5" stroke="currentColor" strokeWidth="1.2" />
			<rect x="10" y="5.5" width="5" height="5" rx="0.5" fill="currentColor" />
		</Svg>
	)
}

export function PromptIcon() {
	return (
		<Svg>
			<path
				d="M3 4H13M3 8H10M3 12H7"
				stroke="currentColor"
				strokeWidth="1.33"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</Svg>
	)
}

export function RouterIcon() {
	return (
		<Svg>
			<circle cx="4" cy="8" r="2" fill="currentColor" />
			<circle cx="12" cy="3" r="1.5" fill="currentColor" />
			<circle cx="12" cy="8" r="1.5" fill="currentColor" />
			<circle cx="12" cy="13" r="1.5" fill="currentColor" />
			<path d="M6 8L10.5 3M6 8L10.5 8M6 8L10.5 13" stroke="currentColor" strokeWidth="1.2" />
		</Svg>
	)
}

export function TemplateIcon() {
	return (
		<Svg>
			<rect
				x="2"
				y="2"
				width="12"
				height="12"
				rx="2"
				stroke="currentColor"
				strokeWidth="1.2"
				strokeDasharray="2 2"
			/>
			<rect x="4.5" y="4.5" width="3" height="3" rx="0.5" fill="currentColor" opacity="0.6" />
			<rect x="8.5" y="4.5" width="3" height="3" rx="0.5" fill="currentColor" opacity="0.6" />
			<rect x="6.5" y="8.5" width="3" height="3" rx="0.5" fill="currentColor" opacity="0.6" />
		</Svg>
	)
}

export function UpscaleIcon() {
	return (
		<Svg>
			<rect x="1" y="5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" />
			<rect x="6" y="1" width="9" height="9" rx="1" stroke="currentColor" strokeWidth="1.2" />
			<path
				d="M9 7L11.5 4.5M11.5 4.5H9M11.5 4.5V7"
				stroke="currentColor"
				strokeWidth="1.2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</Svg>
	)
}

export function TextIcon() {
	return (
		<Svg>
			<path
				d="M3 3H13M3 6.5H10M3 10H13M3 13.5H8"
				stroke="currentColor"
				strokeWidth="1.33"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</Svg>
	)
}

export function ImageIcon() {
	return (
		<Svg>
			<rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.33" />
			<circle cx="5.5" cy="6.5" r="1.25" fill="currentColor" />
			<path
				d="M2.5 11.5L6 8L8.5 10.5L11 8L13.5 10.5"
				stroke="currentColor"
				strokeWidth="1.33"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</Svg>
	)
}

export function DownloadIcon() {
	return (
		<Svg>
			<path
				d="M8 2V10M8 10L11 7M8 10L5 7M3 13H13"
				stroke="currentColor"
				strokeWidth="1.33"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</Svg>
	)
}

export function ImportIcon() {
	return (
		<Svg>
			<path
				d="M8 11V3M8 3L11 6M8 3L5 6M3 13H13"
				stroke="currentColor"
				strokeWidth="1.33"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</Svg>
	)
}

export function SaveIcon() {
	return (
		<Svg>
			<path
				d="M3.5 2.5H10.5L13.5 5.5V12A1.5 1.5 0 0 1 12 13.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 3.5 2.5Z"
				stroke="currentColor"
				strokeWidth="1.33"
				strokeLinejoin="round"
			/>
			<path
				d="M5 2.5V6H10V2.5"
				stroke="currentColor"
				strokeWidth="1.33"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<rect x="5" y="8.5" width="6" height="3.5" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
		</Svg>
	)
}

export function WorkflowsIcon() {
	return (
		<Svg>
			<circle cx="4" cy="4" r="2" stroke="currentColor" strokeWidth="1.33" />
			<circle cx="4" cy="12" r="2" stroke="currentColor" strokeWidth="1.33" />
			<circle cx="12" cy="8" r="2" stroke="currentColor" strokeWidth="1.33" />
			<path
				d="M6 4H8A2 2 0 0 1 10 6M6 12H8A2 2 0 0 0 10 10"
				stroke="currentColor"
				strokeWidth="1.33"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</Svg>
	)
}
