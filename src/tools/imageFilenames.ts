/**
 * Filename extensions for image bytes.
 *
 * A graph can now produce a GIF or a JPEG as easily as a PNG, so any code that names a file has
 * to read the media type rather than assume one. Saving GIF bytes as `.png` produces a file the
 * operating system opens with the wrong application and shows as a still image.
 */
const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
	'image/png': 'png',
	'image/gif': 'gif',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
}

/** The extension for a media type, or undefined when the type is unrecognised. */
export function extensionForMimeType(mimeType: string): string | undefined {
	return EXTENSION_BY_MIME_TYPE[mimeType.split(';')[0].trim().toLowerCase()]
}

/** Correct a filename's extension to match the bytes, leaving an already-correct name alone. */
export function withMatchingExtension(filename: string, mimeType: string): string {
	const wanted = extensionForMimeType(mimeType)
	// An unrecognised type is no reason to mangle a name the user chose deliberately.
	if (!wanted) return filename
	const current = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase()
	if (current === wanted) return filename
	// `.jpeg` and `.jpg` are the same thing; rewriting one to the other would be meddling.
	if (wanted === 'jpg' && current === 'jpeg') return filename
	const stem = filename.includes('.') ? filename.slice(0, filename.lastIndexOf('.')) : filename
	return `${stem}.${wanted}`
}
