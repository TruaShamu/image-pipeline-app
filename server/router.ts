import { AutoRouter, error, IRequest } from 'itty-router'
import { Env } from './env.ts'
import { errorMessage, errorStatus } from './httpError.ts'
import { handleGenerate } from './routes/generate.ts'
import { handleImageDownload, handleImageUpload } from './routes/images.ts'
import { handleModelList } from './routes/models.ts'
import {
	handlePipelineAsset,
	handlePipelineDelete,
	handlePipelineList,
	handlePipelineSave,
} from './routes/pipelines.ts'

/**
 * The local API server.
 *
 * This runs in-process inside the Vite dev server rather than on a hosted
 * platform: the app is a local tool, so it needs filesystem access to read and
 * write the project's `pipelines/` directory.
 */
export const router = AutoRouter<IRequest, [env: Env]>({
	catch: (e) => {
		console.error(e)
		// Pass the upstream status through. Collapsing everything to 500 hides the difference
		// between "this server is broken" and "your credentials expired", and only one of those
		// tells the reader what to do next.
		return error(errorStatus(e), errorMessage(e))
	},
})
	// Image generation endpoint — accepts prompt, model, and parameters
	.post('/api/generate', handleGenerate)

	// Models this server has credentials for — drives the model picker
	.get('/api/models', handleModelList)

	// Generated images, cached on disk
	.post('/api/images/:imageId', handleImageUpload)
	.get('/api/images/:imageId', handleImageDownload)

	// Version-controlled workflow and prompt YAML
	.get('/api/pipelines/:kind', handlePipelineList)
	.put('/api/pipelines/:kind/:id', handlePipelineSave)
	.delete('/api/pipelines/:kind/:id', handlePipelineDelete)

	// Sample images committed alongside the prompt presets
	.get('/pipelines/*', handlePipelineAsset)

	.all('/api/*', () => new Response('Not found', { status: 404 }))
