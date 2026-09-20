import { useSyncExternalStore } from 'react'

/** A model the server has credentials for. Mirrors `server/models.ts`. */
export interface ModelInfo {
	id: string
	label: string
	provider: string
}

/** A model the server knows but cannot currently call, and why. */
export interface UnavailableModel {
	id: string
	provider: string
	reason: string | null
}

const EMPTY: readonly ModelInfo[] = []

/**
 * The model picker's source of truth.
 *
 * The list comes from the server rather than a hardcoded menu in the tool
 * manifest, because only the server knows which providers are configured. A
 * model that cannot be called is never offered.
 */
class ModelCatalog {
	private models: readonly ModelInfo[] = EMPTY
	private problem: string | null = null
	private listeners = new Set<() => void>()
	private loading: Promise<void> | null = null

	list(): readonly ModelInfo[] {
		return this.models
	}

	/**
	 * Why the list is empty or short, when the server said.
	 *
	 * An empty picker on its own is a dead end — it looks like the app is broken. The server knows
	 * the actual cause, which is usually an expired token and one command away from fixed.
	 */
	unavailableReason(): string | null {
		return this.problem
	}

	getProblemSnapshot = (): string | null => this.problem

	find(id: string): ModelInfo | undefined {
		return this.models.find((model) => model.id === id)
	}

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener)
		void this.ensureLoaded()
		return () => {
			this.listeners.delete(listener)
		}
	}

	getSnapshot = (): readonly ModelInfo[] => this.models

	ensureLoaded(): Promise<void> {
		if (this.loading) return this.loading
		this.loading = this.refresh()
		return this.loading
	}

	async refresh(): Promise<void> {
		try {
			const response = await fetch('/api/models')
			if (!response.ok) throw new Error(`Model list failed (${response.status})`)
			const body = (await response.json()) as {
				models?: ModelInfo[]
				unavailable?: UnavailableModel[]
			}
			this.models = body.models ?? EMPTY
			this.problem = body.unavailable?.find((model) => model.reason)?.reason ?? null
		} catch (e) {
			console.error('Could not load the model list:', e)
			this.models = EMPTY
			this.problem = e instanceof Error ? e.message : 'Could not reach the server.'
		}
		for (const listener of this.listeners) listener()
	}
}

export const modelCatalog = new ModelCatalog()

/** Subscribe a component to the available models, loading them on first use. */
export function useModels(): readonly ModelInfo[] {
	return useSyncExternalStore(
		modelCatalog.subscribe,
		modelCatalog.getSnapshot,
		modelCatalog.getSnapshot
	)
}

/** Subscribe a component to why the model list is empty, when the server said. */
export function useModelProblem(): string | null {
	return useSyncExternalStore(
		modelCatalog.subscribe,
		modelCatalog.getProblemSnapshot,
		modelCatalog.getProblemSnapshot
	)
}
