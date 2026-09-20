import { expect, Page, test } from '@playwright/test'

/**
 * These tests run in a real browser on purpose. `frames.gif` and `sprite.slice` both depend on
 * `createImageBitmap` and a 2D canvas, so neither can be exercised by this project's SSR probes.
 */

/** Build a 64x16 sprite strip of four distinctly coloured 16x16 cells, in the page. */
const makeStripScript = (opaque: boolean) => `
	(() => {
		const canvas = document.createElement('canvas')
		canvas.width = 64
		canvas.height = 16
		const ctx = canvas.getContext('2d')
		const colours = ['#c83232', '#32c832', '#3232c8', '#c8c832']
		colours.forEach((colour, i) => {
			ctx.fillStyle = colour
			ctx.fillRect(i * 16, 0, 16, 16)
		})
		if (!${opaque}) {
			// Punch a hole in every cell so each frame needs a transparent index.
			for (let i = 0; i < 4; i++) ctx.clearRect(i * 16, 0, 6, 6)
		}
		return new Promise((resolve) => {
			canvas.toBlob(async (blob) => {
				resolve(Array.from(new Uint8Array(await blob.arrayBuffer())))
			}, 'image/png')
		})
	})()
`

async function gotoApp(page: Page) {
	await page.goto('/')
	// The dev-only handles are this test's entry point, so wait for them rather than guessing.
	await page.waitForFunction(() => (window as any).workflowTools && (window as any).editor, null, {
		timeout: 30_000,
	})
}

/** Slice the strip and encode a GIF, entirely inside the page. Returns the GIF bytes. */
async function encodeGif(
	page: Page,
	options: { fps?: number; loop?: string; opaque?: boolean } = {}
): Promise<number[]> {
	const strip = (await page.evaluate(makeStripScript(options.opaque ?? true))) as number[]
	return page.evaluate(
		async ({ strip, fps, loop }) => {
			const registry = (window as any).workflowTools
			const context = { signal: new AbortController().signal, log: () => {} }
			const sheet = { bytes: new Uint8Array(strip), mimeType: 'image/png' }
			const sliced = await registry
				.resolve('sprite.slice')
				.run({ sheet, rows: 1, cols: 4 }, context)
			const out = await registry
				.resolve('frames.gif')
				.run({ frames: sliced.frames, fps, loop }, context)
			return Array.from(out.gif.bytes as Uint8Array)
		},
		{ strip, fps: options.fps ?? 12, loop: options.loop ?? 'forever' }
	)
}

const asText = (bytes: number[]) => String.fromCharCode(...bytes)

/** Count GIF graphic control extension blocks, which is one per frame. */
function countFrames(bytes: number[]): number {
	let count = 0
	for (let i = 0; i < bytes.length - 1; i++) {
		if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9) count++
	}
	return count
}

test.describe('frames.gif', () => {
	test('encodes a real animated GIF from sliced frames', async ({ page }) => {
		await gotoApp(page)
		const gif = await encodeGif(page)

		expect(asText(gif.slice(0, 6))).toBe('GIF89a')
		// Little-endian width and height from the logical screen descriptor.
		expect(gif[6] + (gif[7] << 8)).toBe(16)
		expect(gif[8] + (gif[9] << 8)).toBe(16)
		expect(countFrames(gif)).toBe(4)
		expect(asText(gif.slice(-1))).toBe(';') // GIF trailer
	})

	test('loops forever by default and plays once on request', async ({ page }) => {
		await gotoApp(page)

		const looping = await encodeGif(page, { loop: 'forever' })
		expect(asText(looping)).toContain('NETSCAPE2.0')

		// gifenc omits the Netscape extension entirely for a repeat of -1.
		const once = await encodeGif(page, { loop: 'once' })
		expect(asText(once)).not.toContain('NETSCAPE2.0')
	})

	test('writes one global palette rather than a table per frame', async ({ page }) => {
		await gotoApp(page)
		const gif = await encodeGif(page)

		// Bit 7 of the logical screen descriptor's packed field is the global colour table flag.
		expect(gif[10] & 0x80).toBeTruthy()
		// Bit 7 of each image descriptor's packed field is the local colour table flag. A local
		// table on any frame would repeat 256 colours per frame for no benefit.
		const locals: number[] = []
		for (let i = 0; i < gif.length - 10; i++) {
			if (gif[i] === 0x2c) locals.push(gif[i + 9] & 0x80)
		}
		expect(locals.length).toBeGreaterThan(0)
		expect(locals.every((flag) => flag === 0)).toBe(true)
	})

	test('carries transparency through to the GIF', async ({ page }) => {
		await gotoApp(page)
		const gif = await encodeGif(page, { opaque: false })

		// In each graphic control extension the low bit of the packed field is the transparency
		// flag. A cleared corner must survive quantization as a real transparent index.
		let transparentFrames = 0
		for (let i = 0; i < gif.length - 3; i++) {
			if (gif[i] === 0x21 && gif[i + 1] === 0xf9 && (gif[i + 3] & 0x01) === 1) {
				transparentFrames++
			}
		}
		expect(transparentFrames).toBe(4)
	})

	test('an opaque animation claims no transparency', async ({ page }) => {
		await gotoApp(page)
		const gif = await encodeGif(page, { opaque: true })

		let transparentFrames = 0
		for (let i = 0; i < gif.length - 3; i++) {
			if (gif[i] === 0x21 && gif[i + 1] === 0xf9 && (gif[i + 3] & 0x01) === 1) {
				transparentFrames++
			}
		}
		expect(transparentFrames).toBe(0)
	})

	test('rejects an fps GIF cannot represent', async ({ page }) => {
		await gotoApp(page)
		await expect(encodeGif(page, { fps: 120 })).rejects.toThrow(/fps must be an integer/)
		await expect(encodeGif(page, { fps: 0 })).rejects.toThrow(/fps must be an integer/)
	})

	test('refuses mismatched frame sizes instead of silently scaling', async ({ page }) => {
		await gotoApp(page)
		const error = await page.evaluate(async () => {
			const registry = (window as any).workflowTools
			const context = { signal: new AbortController().signal, log: () => {} }
			const make = async (w: number, h: number) => {
				const canvas = document.createElement('canvas')
				canvas.width = w
				canvas.height = h
				canvas.getContext('2d')!.fillRect(0, 0, w, h)
				const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), 'image/png'))
				return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: 'image/png' }
			}
			try {
				await registry
					.resolve('frames.gif')
					.run({ frames: [await make(16, 16), await make(24, 24)], fps: 12 }, context)
				return 'no error'
			} catch (e: any) {
				return e.message
			}
		})
		expect(error).toContain('frame 1 is 16x16 but frame 2 is 24x24')
	})

	test('the browser can decode what we encoded', async ({ page }) => {
		await gotoApp(page)
		const gif = await encodeGif(page)
		// Byte-level assertions prove the structure; this proves the file actually loads.
		const size = await page.evaluate(async (bytes) => {
			const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/gif' }))
			const img = new Image()
			await new Promise((resolve, reject) => {
				img.onload = resolve
				img.onerror = () => reject(new Error('the browser rejected the GIF'))
				img.src = url
			})
			URL.revokeObjectURL(url)
			return { width: img.naturalWidth, height: img.naturalHeight }
		}, gif)
		expect(size).toEqual({ width: 16, height: 16 })
	})
})

test.describe('frame preview navigation', () => {
	test('steps through frames and wraps around', async ({ page }) => {
		await gotoApp(page)
		const strip = (await page.evaluate(makeStripScript(true))) as number[]

		// The graph is built through the editor rather than the node picker, because the subject
		// of this test is the preview control, not workflow authoring.
		await page.evaluate(async (strip) => {
			const editor = (window as any).editor
			const yaml = [
				'version: 1',
				'steps:',
				'  - id: src',
				'    tool: const.image',
				'  - id: slice',
				'    tool: sprite.slice',
				'    with:',
				'      rows: 1',
				'      cols: 4',
				'    needs:',
				'      - port: sheet',
				'        from: src.image',
				'  - id: view',
				'    tool: frames.preview',
				'    needs:',
				'      - port: frames',
				'        from: slice.frames',
			].join('\n')
			;(window as any).workflow.open(yaml, 'frame nav test')
			await new Promise((r) => setTimeout(r, 500))

			const shapes = editor.getCurrentPageShapes().filter((s: any) => s.type === 'node')
			const source = shapes.find((s: any) => s.props.node.toolId === 'const.image')
			editor.updateShape({
				id: source.id,
				type: 'node',
				props: {
					node: {
						...source.props.node,
						config: {
							...source.props.node.config,
							value: { bytes: strip, mimeType: 'image/png' },
						},
					},
				},
			})
			await (window as any).startExecution(editor, new Set([source.id]))
		}, strip)

		// Both the slicer and the viewer preview an image[], so both get controls. That is the
		// intended behaviour, not a duplicate: the affordance follows the port type, not the tool.
		await expect(page.locator('.NodeImagePreview-frameCount')).toHaveCount(2)

		const viewer = page.locator('.NodeShape', { hasText: 'Preview Frames' })
		const counter = viewer.locator('.NodeImagePreview-frameCount')
		await expect(counter).toHaveText('1/4')

		const next = viewer.locator('.NodeImagePreview-frameStep').nth(1)
		await next.click()
		await expect(counter).toHaveText('2/4')
		await next.click()
		await next.click()
		await expect(counter).toHaveText('4/4')

		// Wrapping matters for checking whether an animation loops cleanly.
		await next.click()
		await expect(counter).toHaveText('1/4')

		await viewer.locator('.NodeImagePreview-frameStep').first().click()
		await expect(counter).toHaveText('4/4')

		// Each block tracks its own frame, so stepping one does not scrub the other.
		const slicer = page.locator('.NodeShape', { hasText: 'Slice Sprite' })
		await expect(slicer.locator('.NodeImagePreview-frameCount')).toHaveText('1/4')
	})

	test('a single image shows no frame controls', async ({ page }) => {
		await gotoApp(page)
		// The starter pipeline has single-image previews, so the controls must be absent on load.
		await expect(page.locator('.NodeImagePreview-frames')).toHaveCount(0)
	})
})

test.describe('ports', () => {
	/**
	 * A node's ports share one namespace, so an input and an output with the same name used to
	 * collapse into a single port and leave the input unreachable. Every image tool hit this.
	 */
	test('every tool exposes one canvas port per input and output', async ({ page }) => {
		await gotoApp(page)
		const clashes = await page.evaluate(() =>
			(window as any).workflowTools
				.list()
				.map((tool: any) => {
					const outputs = new Set(tool.outputs.map((o: any) => o.name))
					const clash = tool.inputs.filter((i: any) => outputs.has(i.name)).map((i: any) => i.name)
					return clash.length ? `${tool.id}: ${clash.join(',')}` : null
				})
				.filter(Boolean)
		)
		expect(clashes).toEqual([])
	})

	test('an image can be dragged into the generate block', async ({ page }) => {
		await gotoApp(page)
		await page.evaluate(async () => {
			;(window as any).workflow.open(
				[
					'version: 1',
					'steps:',
					'  - id: src',
					'    tool: const.image',
					'    ui: { x: 100, y: 100 }',
					'  - id: gen',
					'    tool: image.generate',
					'    ui: { x: 700, y: 100 }',
				].join('\n'),
				'port drag'
			)
			await new Promise((r) => setTimeout(r, 500))
		})

		// The reference input must render as an inbound port, not be shadowed by the image output.
		const generate = page.locator('.NodeShape', { hasText: 'Generate Image' })
		const reference = generate.locator('.NodeRow', { hasText: 'reference' })
		await expect(reference).toHaveCount(1)

		// The leftmost output port is the source image; Generate's own output sits further right,
		// and dragging from that would only ever produce a rejected self-connection.
		const starts = await page.locator('.Port_start').all()
		const boxes = await Promise.all(starts.map((port) => port.boundingBox()))
		boxes.sort((a, b) => a!.x - b!.x)
		const from = boxes[0]
		const to = await reference.locator('.Port_end').boundingBox()
		expect(from).not.toBeNull()
		expect(to).not.toBeNull()

		await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2)
		await page.mouse.down()
		await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 12 })
		await page.mouse.up()

		// A real connection means the graph gains a dependency, not just that a shape was drawn.
		await expect
			.poll(async () =>
				page.evaluate(() => {
					const yaml = (window as any).workflow.exportYaml() as string
					return /port: reference/.test(yaml)
				})
			)
			.toBe(true)
	})

	/**
	 * `runToolMapped` has always run a scalar tool once per element of a collection, but the
	 * canvas refused to draw the connection that would trigger it, so the README's headline
	 * chain could not be built by hand.
	 */
	test('a collection can be dragged into a scalar input', async ({ page }) => {
		await gotoApp(page)
		await page.evaluate(async () => {
			;(window as any).workflow.open(
				[
					'version: 1',
					'steps:',
					'  - id: slice',
					'    tool: sprite.slice',
					'    ui: { x: 100, y: 100 }',
					'  - id: cut',
					'    tool: image.removeBackground',
					'    ui: { x: 700, y: 100 }',
				].join('\n'),
				'fan out drag'
			)
			await new Promise((r) => setTimeout(r, 500))
		})

		const cut = page.locator('.NodeShape', { hasText: 'Remove Background' })
		const source = cut.locator('.NodeRow', { hasText: 'source' })
		const frames = page
			.locator('.NodeShape', { hasText: 'Slice Sprite Sheet' })
			.locator('.NodeRow', { hasText: 'frames' })

		const from = await frames.locator('.Port_start').boundingBox()
		const to = await source.locator('.Port_end').boundingBox()
		expect(from).not.toBeNull()
		expect(to).not.toBeNull()

		await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2)
		await page.mouse.down()
		await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 12 })
		await page.mouse.up()

		await expect
			.poll(async () =>
				page.evaluate(() => (window as any).workflow.exportYaml() as string)
			)
			.toMatch(/port: source/)
	})

	/**
	 * The permission is one-way. A tool declaring a collection input reads it with
	 * Array.isArray, so a lone image would throw at run time rather than be wrapped.
	 */
	test('a scalar cannot be dragged into a collection input', async ({ page }) => {
		await gotoApp(page)
		await page.evaluate(async () => {
			;(window as any).workflow.open(
				[
					'version: 1',
					'steps:',
					'  - id: src',
					'    tool: const.image',
					'    ui: { x: 100, y: 100 }',
					'  - id: gif',
					'    tool: frames.gif',
					'    ui: { x: 700, y: 100 }',
				].join('\n'),
				'gather drag'
			)
			await new Promise((r) => setTimeout(r, 500))
		})

		const frames = page
			.locator('.NodeShape', { hasText: 'Compose GIF' })
			.locator('.NodeRow', { hasText: 'frames' })
		const starts = await page.locator('.Port_start').all()
		const boxes = await Promise.all(starts.map((port) => port.boundingBox()))
		boxes.sort((a, b) => a!.x - b!.x)
		const from = boxes[0]
		const to = await frames.locator('.Port_end').boundingBox()
		expect(from).not.toBeNull()
		expect(to).not.toBeNull()

		await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2)
		await page.mouse.down()
		await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 12 })
		await page.mouse.up()

		const yaml = await page.evaluate(() => (window as any).workflow.exportYaml() as string)
		expect(yaml).not.toMatch(/needs:/)
	})
})


test.describe('workflow catalog', () => {
	/**
	 * Saving a page writes only the graph, so a catalog that demanded name/description/tags
	 * rejected everything the app itself produced: the save reported success and the file was
	 * then skipped on load.
	 */
	test('a workflow with no metadata still loads', async ({ page }) => {
		const skipped: string[] = []
		page.on('console', (message) => {
			if (message.type() === 'error' && message.text().includes('zz-metadata-test')) {
				skipped.push(message.text().split('\n')[0])
			}
		})
		await gotoApp(page)
		const yaml = ['version: 1', 'steps:', '  - id: a', '    tool: const.text'].join('\n')
		await page.evaluate(async (body) => {
			const response = await fetch('/api/pipelines/workflows/zz-metadata-test', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ yaml: body }),
			})
			if (!response.ok) throw new Error(`save failed: ${response.status}`)
		}, yaml)

		try {
			// Reloading forces the catalog to parse the new file the way it parses every other one.
			await gotoApp(page)
			await page.waitForTimeout(1000)
			// The name is absent from the file, so it has to be derived from the filename.
			const listed = await page.evaluate(() => {
				const catalog = document.body.innerText
				return catalog.length > 0
			})
			expect(listed).toBe(true)
			expect(skipped).toEqual([])
		} finally {
			await page.evaluate(() =>
				fetch('/api/pipelines/workflows/zz-metadata-test', { method: 'DELETE' })
			)
		}
	})

	test('every workflow on disk parses', async ({ page }) => {
		const failures: string[] = []
		page.on('console', (message) => {
			if (message.type() === 'error' && message.text().includes('Skipping workflows/')) {
				failures.push(message.text().split('\n')[0])
			}
		})
		await gotoApp(page)
		await page.waitForTimeout(1000)
		expect(failures).toEqual([])
	})
})

test.describe('downloads', () => {
	/**
	 * The preview's download button named every file `.png` regardless of the bytes behind it, so
	 * a GIF saved from the canvas arrived as a still image in the wrong application.
	 */
	test('the preview download button names a GIF .gif', async ({ page }) => {
		await gotoApp(page)
		const strip = (await page.evaluate(makeStripScript(true))) as number[]

		await page.evaluate(async (bytes) => {
			const yaml = [
				'version: 1',
				'steps:',
				'  - id: sheet',
				'    tool: const.image',
				'    with:',
				'      value:',
				`        bytes: [${bytes.join(',')}]`,
				'        mimeType: image/png',
				'    ui: { x: 80, y: 80 }',
				'  - id: slice',
				'    tool: sprite.slice',
				'    with: { rows: 1, cols: 4 }',
				'    needs:',
				'      - port: sheet',
				'        from: sheet.image',
				'    ui: { x: 380, y: 80 }',
				'  - id: gif',
				'    tool: frames.gif',
				'    with: { fps: 12, loop: forever }',
				'    needs:',
				'      - port: frames',
				'        from: slice.frames',
				'    ui: { x: 700, y: 80 }',
			].join('\n')
			;(window as any).workflow.open(yaml, 'gif download')
			await new Promise((r) => setTimeout(r, 600))
			const editor = (window as any).editor
			// Start from the source block so the whole chain runs, GIF block included.
			const sheetShape = editor
				.getCurrentPageShapes()
				.find((shape: any) => shape.type === 'node' && shape.props.node?.toolId === 'const.image')
			await (window as any).startExecution(
				editor,
				new Set(sheetShape ? [sheetShape.id] : editor.getCurrentPageShapes().map((s: any) => s.id))
			)
		}, strip)

		const gifNode = page.locator('.NodeShape', { hasText: 'Compose GIF' })
		await expect(gifNode.locator('.NodeImage-download')).toBeVisible({ timeout: 20_000 })

		const downloadPromise = page.waitForEvent('download')
		await gifNode.locator('.NodeImage-download').click()
		const download = await downloadPromise

		expect(download.suggestedFilename()).toMatch(/\.gif$/)
		const path = await download.path()
		const fs = await import('node:fs')
		// The extension is only correct if it matches the bytes, so check the magic number too.
		expect(fs.readFileSync(path!).subarray(0, 3).toString('latin1')).toBe('GIF')
	})
})

test.describe('collection encoding', () => {
	const collectionGraph = [
		'version: 1',
		'steps:',
		'  - id: sheet',
		'    tool: const.image',
		'    ui: { x: 0, y: 0 }',
		'  - id: slice',
		'    tool: sprite.slice',
		'    needs:',
		'      - port: sheet',
		'        from: sheet.image',
		'    ui: { x: 340, y: 0 }',
		'  - id: gif',
		'    tool: frames.gif',
		'    needs:',
		'      - port: frames',
		'        from: slice.frames',
		'    ui: { x: 680, y: 0 }',
	].join('\n')

	/**
	 * Arity used to be carried only by two near-identical purples, which is invisible on screen.
	 * Shape is the signal, so these assert the shape marker rather than a colour.
	 */
	test('collection ports are marked and scalar ports are not', async ({ page }) => {
		await gotoApp(page)
		await page.evaluate(async (yaml) => {
			;(window as any).workflow.open(yaml, 'encoding')
			await new Promise((r) => setTimeout(r, 600))
		}, collectionGraph)

		const slicer = page.locator('.NodeShape', { hasText: 'Slice Sprite' })
		// `sheet` takes one image; `frames` emits many.
		await expect(slicer.locator('.NodeRow', { hasText: 'sheet' }).locator('.Port')).not.toHaveClass(
			/Port_collection/
		)
		await expect(
			slicer.locator('.NodeRow', { hasText: 'frames' }).locator('.Port')
		).toHaveClass(/Port_collection/)
	})

	test('a collection connection is drawn as a doubled rail', async ({ page }) => {
		await gotoApp(page)
		await page.evaluate(async (yaml) => {
			;(window as any).workflow.open(yaml, 'encoding')
			await new Promise((r) => setTimeout(r, 600))
		}, collectionGraph)

		// One scalar connection and one collection connection exist, so exactly one carries a rail.
		await expect(page.locator('.ConnectionShape_collection')).toHaveCount(1)
		await expect(page.locator('.ConnectionShape-rail')).toHaveCount(1)
	})

	test('a fan-out reports its progress', async ({ page }) => {
		await gotoApp(page)
		const strip = (await page.evaluate(makeStripScript(true))) as number[]
		const events = await page.evaluate(async (bytes) => {
			const yaml = [
				'version: 1',
				'steps:',
				'  - id: sheet',
				'    tool: const.image',
				'    with:',
				'      value:',
				`        bytes: [${bytes.join(',')}]`,
				'        mimeType: image/png',
				'  - id: slice',
				'    tool: sprite.slice',
				'    with: { rows: 1, cols: 4 }',
				'    needs:',
				'      - port: sheet',
				'        from: sheet.image',
				'  - id: big',
				'    tool: image.upscale',
				'    with: { scale: 2, method: pixel }',
				'    needs:',
				'      - port: source',
				'        from: slice.frames',
			].join('\n')
			const seen: string[] = []
			await (window as any).workflow.run(yaml, {
				onNode: (event: any) => {
					if (event.progress) seen.push(`${event.id}:${event.progress.done}/${event.progress.total}`)
				},
			})
			return seen
		}, strip)

		// Four frames means the scalar-input block runs four times, and says so.
		expect(events).toEqual(['big:1/4', 'big:2/4', 'big:3/4', 'big:4/4'])
	})
})

test.describe('sketch', () => {
	/** Open a page holding a single Sketch block and return its shape id. */
	async function openSketch(page: Page): Promise<string> {
		await gotoApp(page)
		return page.evaluate(async () => {
			const w = window as any
			w.workflow.open(
				[
					'version: 1',
					'steps:',
					'  - id: sketch',
					'    tool: canvas.sketch',
					'    ui: { x: 100, y: 100 }',
				].join('\n'),
				'sketch'
			)
			await new Promise((r) => setTimeout(r, 600))
			return w.editor.getCurrentPageShapes().find((s: any) => s.type === 'node').id as string
		})
	}

	/** Draw one stroke across the block's region with the real draw tool. */
	async function drawInRegion(page: Page) {
		await page.evaluate(() => {
			;(window as any).editor.setCurrentTool('draw')
		})
		const box = await page.locator('.ToolNode-region').boundingBox()
		expect(box).not.toBeNull()
		await page.mouse.move(box!.x + 30, box!.y + 30)
		await page.mouse.down()
		await page.mouse.move(box!.x + box!.width - 30, box!.y + box!.height - 30, { steps: 20 })
		await page.mouse.up()
		await page.evaluate(() => {
			;(window as any).editor.setCurrentTool('select')
		})
	}

	async function run(page: Page, shapeId: string) {
		await page.evaluate(async (id) => {
			const w = window as any
			await w.startExecution(w.editor, new Set([id]))
			await new Promise((r) => setTimeout(r, 2500))
		}, shapeId)
	}

	test('a drawing inside the block becomes an image', async ({ page }) => {
		const shapeId = await openSketch(page)
		await drawInRegion(page)
		await run(page, shapeId)

		const output = await page.evaluate(
			(id) => (window as any).editor.getShape(id)?.props?.node?.lastOutputs?.image ?? null,
			shapeId
		)
		expect(typeof output).toBe('string')
		// The extension alone proves nothing, so check the bytes really are a PNG.
		expect(output as string).toMatch(/^data:image\/png;base64,/)
		const header = Buffer.from((output as string).split(',')[1], 'base64').subarray(0, 4)
		expect([...header]).toEqual([0x89, 0x50, 0x4e, 0x47])
	})

	/**
	 * Strokes live in the tldraw store and are never written to the workflow file, so a reopened
	 * sketch pipeline finds an empty region. That has to be said out loud rather than passed on
	 * as a null image that fails somewhere further down the chain.
	 */
	test('an empty region fails loudly', async ({ page }) => {
		const shapeId = await openSketch(page)
		await run(page, shapeId)

		await expect(page.locator('.ExecutionErrorReport')).toContainText('Nothing to sketch')
		const output = await page.evaluate(
			(id) => (window as any).editor.getShape(id)?.props?.node?.lastOutputs?.image ?? null,
			shapeId
		)
		expect(output).toBeNull()
	})

	/** The block is a window, so its body must stay clear of the preview every image tool gets. */
	test('the block shows no image preview over its region', async ({ page }) => {
		const shapeId = await openSketch(page)
		await drawInRegion(page)
		await run(page, shapeId)

		await expect(page.locator('.ToolNode-region')).toHaveCount(1)
		await expect(page.locator('.NodeImagePreview')).toHaveCount(0)
	})
})
