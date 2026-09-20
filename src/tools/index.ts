export { ToolRegistry } from './ToolRegistry'
import { ToolRegistry } from './ToolRegistry'
import { builtinTools } from './builtinTools'

export { builtinTools } from './builtinTools'

export function createBuiltinToolRegistry(): ToolRegistry {
	return new ToolRegistry().registerMany(builtinTools)
}
export { parseLiquidVariables } from './liquidTemplate'
export { runToolMapped } from './runToolMapped'
export {
	isImageValue,
	isToolValue,
	resolveToolInputs,
	ToolHttpError,
	toolErrorStatus,
	type ImageValue,
	type Tool,
	type ToolContext,
	type ToolInputDefinition,
	type ToolCategory,
	type ToolIcon,
	type ToolManifest,
	type ToolOutputDefinition,
	type ToolValue,
	type CanvasCapability,
} from './toolTypes'
export { extensionForMimeType, withMatchingExtension } from './imageFilenames'
