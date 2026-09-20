import fs from 'node:fs/promises'
import path from 'node:path'

/** The kinds of content stored in the pipelines directory. */
export const PIPELINE_KINDS = ['workflows', 'prompts'] as const
export type PipelineKind = (typeof PIPELINE_KINDS)[number]

export function isPipelineKind(value: string): value is PipelineKind {
	return (PIPELINE_KINDS as readonly string[]).includes(value)
}

/** A YAML document on disk, identified by its filename stem. */
export interface PipelineFile {
	/** Filename without the `.yaml` extension. */
	id: string
	yaml: string
	updatedAt: number
}

/**
 * Only allow filename-safe ids. This both keeps the files pleasant to read in
 * a diff and prevents path traversal out of the pipelines directory.
 */
export function isValidPipelineId(id: string): boolean {
	return /^[A-Za-z0-9_-]{1,100}$/.test(id)
}

/** Derive a filename-safe id from a human name. */
export function slugify(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 100)
	return slug || `untitled-${Date.now()}`
}

/**
 * Reads and writes version-controlled pipeline content as plain YAML files.
 *
 * Everything here is intended to be committed, reviewed, and shared through
 * git, so the on-disk layout is the source of truth. There is no index file or
 * hidden metadata: a directory listing is the catalog.
 */
export class PipelineStore {
	constructor(private readonly root: string) {}

	private dir(kind: PipelineKind): string {
		return path.join(this.root, kind)
	}

	private file(kind: PipelineKind, id: string): string {
		return path.join(this.dir(kind), `${id}.yaml`)
	}

	async list(kind: PipelineKind): Promise<PipelineFile[]> {
		let entries: string[]
		try {
			entries = await fs.readdir(this.dir(kind))
		} catch {
			return []
		}
		const files = await Promise.all(
			entries
				.filter((entry) => entry.endsWith('.yaml'))
				.map(async (entry) => {
					const id = entry.slice(0, -'.yaml'.length)
					const full = path.join(this.dir(kind), entry)
					const [yaml, stat] = await Promise.all([fs.readFile(full, 'utf8'), fs.stat(full)])
					return { id, yaml, updatedAt: stat.mtimeMs }
				})
		)
		return files.sort((a, b) => a.id.localeCompare(b.id))
	}

	async get(kind: PipelineKind, id: string): Promise<PipelineFile | null> {
		if (!isValidPipelineId(id)) return null
		try {
			const full = this.file(kind, id)
			const [yaml, stat] = await Promise.all([fs.readFile(full, 'utf8'), fs.stat(full)])
			return { id, yaml, updatedAt: stat.mtimeMs }
		} catch {
			return null
		}
	}

	async save(kind: PipelineKind, id: string, yaml: string): Promise<PipelineFile> {
		if (!isValidPipelineId(id)) throw new Error(`Invalid id "${id}"`)
		await fs.mkdir(this.dir(kind), { recursive: true })
		// Trailing newline keeps the file POSIX-clean and avoids a "\ No newline
		// at end of file" marker in every diff.
		const body = yaml.endsWith('\n') ? yaml : `${yaml}\n`
		await fs.writeFile(this.file(kind, id), body, 'utf8')
		const stat = await fs.stat(this.file(kind, id))
		return { id, yaml: body, updatedAt: stat.mtimeMs }
	}

	async delete(kind: PipelineKind, id: string): Promise<boolean> {
		if (!isValidPipelineId(id)) return false
		try {
			await fs.unlink(this.file(kind, id))
			return true
		} catch {
			return false
		}
	}

	/** Resolve a request path to a file inside the pipelines directory, or null. */
	resolveAsset(relativePath: string): string | null {
		const normalized = path.normalize(relativePath).replace(/^([/\\])+/, '')
		const full = path.join(this.root, normalized)
		const rel = path.relative(this.root, full)
		if (rel.startsWith('..') || path.isAbsolute(rel)) return null
		return full
	}
}
