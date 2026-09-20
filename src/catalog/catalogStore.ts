import { useSyncExternalStore } from 'react'
import { listPipelineFiles, PipelineFile, PipelineKind } from './pipelineApi'

/**
 * A live view of one kind of pipeline content.
 *
 * The files live on disk and can change underneath the app — a teammate's
 * commit, a branch switch, a hand-edited YAML file — so the catalog is a
 * refreshable store rather than a build-time constant.
 */
export class CatalogStore<T extends { id: string }> {
	private items: readonly T[] = []
	private listeners = new Set<() => void>()
	private loading: Promise<void> | null = null
	private lastError: string | null = null

	constructor(
		private readonly kind: PipelineKind,
		private readonly parse: (file: PipelineFile) => T
	) {}

	list(): readonly T[] {
		return this.items
	}

	error(): string | null {
		return this.lastError
	}

	find(id: string): T | undefined {
		return this.items.find((item) => item.id === id)
	}

	get(id: string): T {
		const item = this.find(id)
		if (!item) throw new Error(`Unknown ${this.kind} entry "${id}"`)
		return item
	}

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener)
		// The first subscriber triggers the initial read from disk.
		void this.ensureLoaded()
		return () => {
			this.listeners.delete(listener)
		}
	}

	getSnapshot = (): readonly T[] => this.items

	/** Load once. Concurrent callers share the same request. */
	ensureLoaded(): Promise<void> {
		if (this.loading) return this.loading
		this.loading = this.refresh()
		return this.loading
	}

	/** Re-read the directory, discarding anything cached. */
	async refresh(): Promise<void> {
		try {
			const files = await listPipelineFiles(this.kind)
			const parsed: T[] = []
			for (const file of files) {
				try {
					parsed.push(this.parse(file))
				} catch (e) {
					// One malformed file shouldn't hide every other entry.
					console.error(`Skipping ${this.kind}/${file.id}.yaml:`, e)
				}
			}
			this.items = parsed
			this.lastError = null
		} catch (e) {
			this.lastError = e instanceof Error ? e.message : 'Failed to load'
			this.items = []
		}
		this.emit()
	}

	private emit() {
		for (const listener of this.listeners) listener()
	}
}

/** Subscribe a component to a catalog, loading it on first use. */
export function useCatalog<T extends { id: string }>(store: CatalogStore<T>): readonly T[] {
	return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
