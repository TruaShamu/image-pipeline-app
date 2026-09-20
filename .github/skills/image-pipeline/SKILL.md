---
name: image-pipeline
description: Author, edit, and debug workflow YAML and prompt presets in pipelines/, look up what a built-in tool expects, and add new tools to the registry in this image-pipeline-app repo. Use when asked to create or change a pipeline, wire blocks together, find which tool does something, or write a new tool.
---

# Image pipeline authoring

This repo runs typed node graphs that generate images. A workflow is a YAML file;
a tool is a TypeScript object in a registry. Both have narrow contracts that fail
loudly, so the job is to match the contract rather than guess at it.

**Never invent a tool id, port name, or option value.** They are all checked
before a run starts, and a wrong guess produces a validation error instead of a
result. Look them up — see [Looking up a tool](#looking-up-a-tool).

## Where things live

| path | what |
|---|---|
| `pipelines/workflows/*.yaml` | Workflows. Filename is the identity; there is no `id:` field. |
| `pipelines/prompts/*.yaml` | Reusable prompt presets. |
| `src/tools/builtinTools.ts` | Every built-in tool, and the `builtinTools` array. |
| `src/tools/toolTypes.ts` | The `Tool` / `ToolManifest` contract, fully commented. |
| `src/workflow/graphYaml.ts` | The YAML parser. The schema is whatever this accepts. |
| `src/workflow/graphValidation.ts` | Every rule that can reject a graph. |
| `src/constants.tsx` | `PortDataType` — the legal port types. |

## Workflow YAML

```yaml
name: Collected animation          # optional metadata, ignored by the runner
description: Gather frames into a GIF.
tags: [collection, gif]
version: 1                         # required, must be 1
steps:                             # required
  - id: prompt                     # required, unique
    tool: const.text               # required, must exist in the registry
    with:                          # literal values
      value: a closed flower bud
    ui: { x: 80, y: 80 }           # optional canvas position, runner ignores it
  - id: generate
    tool: image.generate
    with:
      model: openai:gpt-image-1.5
      size: 1024x1024
    needs:                         # values from other steps
      - port: prompt               # an input name on THIS step
        from: prompt.text          # "<stepId>.<outputName>"
```

Rules worth knowing before you write, each enforced by `graphValidation.ts`:

- **`from:` is a dotted string, not a mapping.** `from: prompt.text`, never
  `from: { stepId: prompt, output: text }`. The parser splits on the *last* dot,
  so a step id may contain dots but an output name may not.
- **`with` and `needs` are mutually exclusive per input.** Setting both gives
  `Input "x" is set by both with and needs`.
- **One binding per input.** A second gives `Input "x" has more than one binding`.
- **Every `required` input must be satisfied** by `with`, `needs`, or a default.
- **A collection may feed a scalar input; the reverse is refused.** `image[]` into
  an `image` input fans the step out — it runs once per element and its own output
  becomes a collection. `image` into an `image[]` input is a type error.
- **No cycles.**
- **Inputs with `options` only accept a listed value.**

Write `ui:` coordinates only when you want a sensible canvas layout. They are
noise in diffs otherwise.

### Things that bite

- **`frames.collect` needs at least 2 slots.** Its ports are `item1`, `item2`, …
  gated by `with: { count: N }`. `count: 1` still fails with
  `Required input "item2" is missing`. The **slot number sets the frame order**,
  not the order bindings appear in the file.
- **`prompt.liquid` discovers its own ports.** Every `{{ variable }}` in
  `template` becomes a connectable `text` input with that exact name. Change the
  template and the ports change.
- **`canvas.sketch` cannot run headlessly.** It has `canvasRegion: true` and reads
  the tldraw canvas. A workflow containing one is refused by the CLI before
  anything executes. Do not put it in a pipeline meant for CI.
- **Sketch strokes are never saved** to the workflow file, so a reopened sketch
  pipeline finds an empty region.

## Looking up a tool

Read the source; do not rely on memory or on this file for specifics.

```powershell
# Every tool id, in order
Select-String -Path src\tools\builtinTools.ts -Pattern "^\tid: '"

# One tool's full manifest: inputs, outputs, options, defaults
Select-String -Path src\tools\builtinTools.ts -Pattern "id: 'image.generate'" -Context 2,70
```

At the time of writing the registry holds `const.text`, `const.image`,
`canvas.sketch`, `prompt.liquid`, `image.generate`, `image.removeBackground`,
`image.adjust`, `image.blend`, `image.upscale`, `sprite.slice`, `frames.collect`,
`frames.gif`, `image.preview`, `frames.preview`, `image.download`,
`frames.downloadZip`. **Verify against the source** — this list goes stale.

`ToolRegistry.list()` is lossy: it drops `canvasRegion` and `collectionOutputs`.
Use `resolve(id)` when you need the whole manifest.

## Authoring a new tool

A tool is a manifest plus a `run` function, in `src/tools/builtinTools.ts`:

```ts
export const imageTintTool: Tool = {
	id: 'image.tint',                       // unique, dotted, namespace first
	title: 'Tint',                          // shown on the block
	description: 'Apply a colour wash.',
	category: 'process',                    // input | process | output | utility
	icon: 'process',                        // one of 7 fixed icons, see ToolIcon
	inputs: [
		{ name: 'image', type: 'image', required: true },
		{ name: 'colour', type: 'text', required: true, port: false, default: '#ff0000' },
	],
	outputs: [{ name: 'image', type: 'image' }],
	async run(inputs, context) {
		context.log('tinting')
		return { image: /* ImageValue */ }
	},
}
```

Then add it to the `builtinTools` array in the same file. That is the whole
registration — **a new tool needs no UI work.** The block, its ports, and its
config fields are generated from the manifest.

### Contract rules

- **An input and an output may not share a name.** Ports live in one namespace per
  block, so the registry throws at registration. Name the output `image` and the
  input `source`, not both `image`.
- **`port: false` makes a config field** edited on the block. Omit `port` (or set
  it `true`) for a connectable port.
- Useful input flags: `multiline` for prose, `options` for a fixed picker,
  `optionsSource: 'models'` to fill the picker from what the server has
  credentials for, `hidden` to keep a value out of the UI but still read it.
- **Images cross the graph as `ImageValue`** — `{ bytes: Uint8Array, mimeType }`.
  Never pass a DOM image, object URL, or provider URL; those do not survive the
  headless runner.
- **`dynamicInputs` and `collectionOutputs` must be pure.** They are called during
  rendering, port layout, validation, and execution.
- Set **`collectionOutputs`** if a configuration makes an `image` output carry
  many, so the port and the validator agree before anything runs.
- Set **`canvasRegion: true`** only if the tool reads the canvas, and then read it
  through `context.canvas`, which is absent headlessly.
- Throw **`ToolHttpError(message, status)`** for HTTP failures so the status can
  be classified from fact rather than by matching words in the message.
- Honour `context.signal`, and call `context.onProgress` in long loops.

## Prompt presets

```yaml
name: Pixel Art Hero
template: "{{subject}}, pixel art game character, readable silhouette"
image: /pipelines/prompts/images/pixel-art-hero.svg   # optional thumbnail
tags: [pixel, character, sprite]
vars:
  - name: subject
    type: text
    required: true
```

Each `vars` entry should correspond to a `{{ variable }}` in the template.

## Always verify

Authoring is not done until the thing runs. The CLI runs the real engine, so a
pass here means it works on the canvas too:

```powershell
npm run workflow -- collected-animation          # by catalog name
npm run workflow -- pipelines/workflows/x.yaml   # by path
```

`--to <step>` stops early, `--fresh` bypasses the generation cache, `--out <dir>`
redirects downloads. It exits non-zero when a step fails.

Generation is **cached by its parameters**, so an unchanged rerun is free and
returns the same image. That makes iterating on a pipeline cheap, but it means a
rerun does not resample — use `--fresh` when you want a new image.

After changing TypeScript:

```powershell
npx tsc --noEmit
npx playwright test
```

Running a workflow costs real Azure OpenAI calls. Prefer `--to` to stop before a
generate step while you are still fixing the shape of the graph.
