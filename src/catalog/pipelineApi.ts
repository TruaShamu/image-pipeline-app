/**
 * Client for the local pipelines API.
 *
 * Workflows and prompt presets are YAML files in the project's `pipelines/`
 * directory, meant to be committed to git and shared by a team. They are read
 * at runtime rather than bundled, so files added by a teammate — or by
 * checking out another branch — show up without rebuilding the app.
 */

/** The kinds of content stored in the pipelines directory. */
export type PipelineKind = 'workflows' | 'prompts'

/** A YAML document on disk, identified by its filename stem. */
export interface PipelineFile {
	id: string
	yaml: string
	updatedAt: number
}

async function readError(response: Response): Promise<string> {
	const err = await response.json().catch(() => ({ error: response.statusText }))
	return (err as { error?: string }).error ?? response.statusText
}

export async function listPipelineFiles(kind: PipelineKind): Promise<PipelineFile[]> {
	const response = await fetch(`/api/pipelines/${kind}`)
	if (!response.ok) throw new Error(await readError(response))
	const data = (await response.json()) as { files: PipelineFile[] }
	return data.files ?? []
}

export async function savePipelineFile(
	kind: PipelineKind,
	id: string,
	yaml: string
): Promise<PipelineFile> {
	const response = await fetch(`/api/pipelines/${kind}/${encodeURIComponent(id)}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ yaml }),
	})
	if (!response.ok) throw new Error(await readError(response))
	return (await response.json()) as PipelineFile
}

export async function deletePipelineFile(kind: PipelineKind, id: string): Promise<void> {
	const response = await fetch(`/api/pipelines/${kind}/${encodeURIComponent(id)}`, {
		method: 'DELETE',
	})
	if (!response.ok) throw new Error(await readError(response))
}

/** Derive a filename-safe id from a human name. */
export function slugifyPipelineName(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 100)
	return slug || `untitled-${Date.now()}`
}
