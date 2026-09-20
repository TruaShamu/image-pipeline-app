import { Tool, ToolManifest } from './toolTypes'

/**
 * In-memory registry for executable workflow tools.
 *
 * The registry deliberately owns executable tools rather than duplicating them in a separate
 * catalog. UI surfaces can call list() for discovery, while the runner calls resolve() to execute.
 */
export class ToolRegistry {
	private readonly tools = new Map<string, Tool>()

	register(tool: Tool): this {
		if (this.tools.has(tool.id)) {
			throw new Error(`A tool with id "${tool.id}" is already registered`)
		}
		// Ports live in one namespace per node, so an input and an output sharing a name would
		// collapse into a single port and silently make the input unreachable on the canvas.
		const outputNames = new Set(tool.outputs.map((output) => output.name))
		const collision = tool.inputs.find((input) => outputNames.has(input.name))
		if (collision) {
			throw new Error(
				`Tool "${tool.id}" has an input and an output both named "${collision.name}". Port names must be unique within a tool.`
			)
		}
		this.tools.set(tool.id, tool)
		return this
	}

	registerMany(tools: readonly Tool[]): this {
		for (const tool of tools) this.register(tool)
		return this
	}

	resolve(id: string): Tool {
		const tool = this.tools.get(id)
		if (!tool) throw new Error(`Unknown workflow tool "${id}"`)
		return tool
	}

	list(): readonly ToolManifest[] {
		return [...this.tools.values()].map(
			({ id, title, description, category, icon, inputs, outputs }) => ({
				id,
				title,
				description,
				category,
				icon,
				inputs,
				outputs,
			})
		)
	}

	has(id: string): boolean {
		return this.tools.has(id)
	}
}
