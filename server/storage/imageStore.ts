import fs from 'node:fs/promises'
import path from 'node:path'

export interface StoredImage {
	data: Buffer
	contentType: string
}

/**
 * Generated images, stored on disk.
 *
 * These are large binaries that should never enter version control, so they
 * live in a gitignored cache directory rather than alongside the committed
 * pipeline YAML. The cache is disposable: deleting it only forces regeneration.
 */
export interface ImageStore {
	has(id: string): Promise<boolean>
	get(id: string): Promise<StoredImage | null>
	put(id: string, data: Buffer, contentType: string): Promise<void>
}

/** Reject anything that could escape the cache directory. */
function isValidId(id: string): boolean {
	return /^[A-Za-z0-9_.-]{1,200}$/.test(id) && !id.includes('..')
}

const CONTENT_TYPE_SUFFIX = '.type'

export function createImageStore(dir: string): ImageStore {
	const filePath = (id: string) => path.join(dir, id)

	async function readContentType(id: string): Promise<string> {
		try {
			return await fs.readFile(filePath(id + CONTENT_TYPE_SUFFIX), 'utf8')
		} catch {
			return 'image/png'
		}
	}

	return {
		async has(id) {
			if (!isValidId(id)) return false
			try {
				await fs.access(filePath(id))
				return true
			} catch {
				return false
			}
		},

		async get(id) {
			if (!isValidId(id)) return null
			try {
				const data = await fs.readFile(filePath(id))
				return { data, contentType: await readContentType(id) }
			} catch {
				return null
			}
		},

		async put(id, data, contentType) {
			if (!isValidId(id)) throw new Error(`Invalid image id "${id}"`)
			await fs.mkdir(dir, { recursive: true })
			await fs.writeFile(filePath(id), data)
			await fs.writeFile(filePath(id + CONTENT_TYPE_SUFFIX), contentType, 'utf8')
		},
	}
}
