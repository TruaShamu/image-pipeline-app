// Refreshes the local Azure OpenAI bearer token used by the worker in dev.
// Runs `az account get-access-token` and writes AZURE_OPENAI_TOKEN into .env.
// Entra ID tokens expire in about an hour, so re-run this when generation
// starts returning 401s.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = join(root, '.env')

function getToken() {
	const isWindows = process.platform === 'win32'
	const cmd = isWindows ? 'az.cmd' : 'az'
	try {
		return execFileSync(
			cmd,
			[
				'account',
				'get-access-token',
				'--resource',
				'https://cognitiveservices.azure.com',
				'--query',
				'accessToken',
				'-o',
				'tsv',
			],
			{ encoding: 'utf8', shell: isWindows }
		).trim()
	} catch (e) {
		console.error('Failed to get token via Azure CLI. Run `az login` first.')
		console.error(e.message)
		process.exit(1)
	}
}

function upsertVar(contents, key, value) {
	const line = `${key}=${value}`
	const re = new RegExp(`^${key}=.*$`, 'm')
	if (re.test(contents)) return contents.replace(re, line)
	return contents ? `${contents.replace(/\n?$/, '\n')}${line}\n` : `${line}\n`
}

const token = getToken()
let contents = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
contents = upsertVar(contents, 'AZURE_OPENAI_TOKEN', token)
writeFileSync(envPath, contents)
console.log('Wrote AZURE_OPENAI_TOKEN to .env (valid ~1 hour).')
