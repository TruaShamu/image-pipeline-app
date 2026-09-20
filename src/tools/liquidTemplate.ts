/**
 * Liquid template helpers shared by the `prompt.liquid` tool and the canvas blocks that render it.
 *
 * Templates use `{{ variable }}` output tags only — no `{% %}` control flow. That restriction is
 * what makes every variable statically extractable, so each one can become a port on the canvas.
 * Filters such as `{{ x | upcase }}` are fine; only the leading identifier is treated as a variable.
 */

/** Matches the leading identifier of every `{{ … }}` output tag. */
const OUTPUT_TAG = /\{\{-?\s*([A-Za-z_][A-Za-z0-9_]*)/g

/** Unique variable names referenced by a template, in first-seen order. */
export function parseLiquidVariables(template: string): string[] {
	const seen = new Set<string>()
	let match: RegExpExecArray | null
	OUTPUT_TAG.lastIndex = 0
	while ((match = OUTPUT_TAG.exec(template)) !== null) {
		seen.add(match[1])
	}
	return Array.from(seen)
}
