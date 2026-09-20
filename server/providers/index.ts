import { HttpError } from '../httpError.ts'
import { openai } from './openai.ts'
import type { ImageProvider } from './types.ts'

export type { GenerateParams, GenerateResult, ImageProvider } from './types.ts'

/**
 * Azure OpenAI is the only provider. The `provider:model` string is still
 * parsed by `/api/generate`, so this keeps the lookup honest rather than
 * silently treating an unknown prefix as Azure.
 */
export function getProvider(name: string): ImageProvider {
	if (name !== 'openai') {
		// A bad model string is the caller's mistake, not this server failing.
		throw new HttpError(
			400,
			`Unknown provider "${name}". Azure OpenAI is the only supported provider.`
		)
	}
	return openai
}
