import path from 'node:path'
import { createImageStore, ImageStore } from './storage/imageStore.ts'

/**
 * Server configuration and storage handles.
 *
 * This replaces the Cloudflare `Env` binding. Credentials come from the
 * process environment (loaded from `.env`), and storage is the local
 * filesystem rather than an R2 bucket.
 */
export interface Env {
	AZURE_OPENAI_ENDPOINT?: string
	AZURE_OPENAI_API_VERSION?: string
	AZURE_OPENAI_TOKEN?: string
	AZURE_OPENAI_API_KEY?: string
	AZURE_TENANT_ID?: string
	AZURE_CLIENT_ID?: string
	AZURE_CLIENT_SECRET?: string
	/** Generated images, cached on disk. Not intended to be committed. */
	images: ImageStore
	/** Directory holding committed workflow and prompt YAML. */
	pipelinesDir: string
}

/** Directory holding user-authored, version-controlled pipeline content. */
export const PIPELINES_DIRNAME = 'pipelines'
/** Directory holding generated images. Gitignored; safe to delete. */
export const CACHE_DIRNAME = path.join('.cache', 'images')

/**
 * Non-secret provider configuration.
 *
 * The API version is a checked-in default because it names a public API
 * contract rather than a resource. The endpoint is deliberately not defaulted:
 * it identifies a specific Azure resource, so it belongs in `.env`.
 */
const DEFAULT_AZURE_OPENAI_API_VERSION = '2025-04-01-preview'

export function createEnv(root: string, vars: Record<string, string | undefined>): Env {
	return {
		AZURE_OPENAI_ENDPOINT: vars.AZURE_OPENAI_ENDPOINT,
		AZURE_OPENAI_API_VERSION: vars.AZURE_OPENAI_API_VERSION || DEFAULT_AZURE_OPENAI_API_VERSION,
		AZURE_OPENAI_TOKEN: vars.AZURE_OPENAI_TOKEN,
		AZURE_OPENAI_API_KEY: vars.AZURE_OPENAI_API_KEY,
		AZURE_TENANT_ID: vars.AZURE_TENANT_ID,
		AZURE_CLIENT_ID: vars.AZURE_CLIENT_ID,
		AZURE_CLIENT_SECRET: vars.AZURE_CLIENT_SECRET,
		images: createImageStore(path.join(root, CACHE_DIRNAME)),
		pipelinesDir: path.join(root, vars.PIPELINES_DIR ?? PIPELINES_DIRNAME),
	}
}
