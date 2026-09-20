# Image pipeline

A local-first visual node-graph editor for AI image pipelines, built on
[tldraw](https://github.com/tldraw/tldraw). Place blocks on an infinite canvas,
wire up typed ports, and run the graph to generate images.

Three properties shape everything else:

- **Workflows are plain YAML in git.** Not app state in a database — files you
  diff, review in a pull request, and share the way you share source.
- **The same graph runs on the canvas or headless from the CLI.** Not a second
  code path that drifts: one engine, one tool registry, identical pixels.
- **Generations are cached by content.** An unchanged rerun is free and returns
  the same image, so a pipeline is reproducible instead of a slot machine.

## Quick start

```
npm install
cp .env.example .env    # set AZURE_OPENAI_ENDPOINT
az login && npm run token
npm run dev             # http://localhost:5173
```

Images are generated with **Azure OpenAI GPT Image** models, so an Azure OpenAI
resource is required. `npm run token` writes a bearer token valid for about an
hour; re-run it when generation starts returning 401s. A service principal
(`AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`) auto-refreshes
and avoids that. See `.env.example` for every option.

The model picker is built from `server/models.ts` and filtered by the
credentials the server actually has, so it can never offer a model it cannot
call. Add a model by adding one entry to `MODELS`.

## Workflows

Workflows and prompt presets live in `pipelines/` as plain YAML, committed to
git and shared by the team. **The filename is the identity** — there is no `id:`
field, so the name in git and the name in the app cannot drift apart.

```yaml
version: 1
steps:
  - id: prompt
    tool: prompt.liquid
    with:
      template: '{{subject}}, pixel art game character'
      variables:
        subject: space courier
  - id: generate
    tool: image.generate
    needs:
      - port: prompt
        from: prompt.text
  - id: preview
    tool: image.preview
    needs:
      - port: image
        from: generate.image
```

The **Workflows** button opens the catalog, which lists every file in
`pipelines/workflows/`. Opening one creates a named tldraw page and materializes
it as canvas blocks. The canvas is the editor — there is no in-app YAML editor.

Built-in tools include `const.text`, `const.image`, `prompt.liquid`,
`image.generate`, `image.removeBackground`, `image.adjust`, `image.blend`,
`image.upscale`, `sprite.slice`, `frames.collect`, `frames.gif`, preview sinks,
and image/ZIP download sinks.

### Collections

A port carries one value or many, and the canvas says which before anything
runs: a **collection port is square**, a scalar port is round, and a block
mapping over a collection shows a `3/16` counter.

Connecting a collection to a scalar input starts a fan-out — the block runs once
per element, so `sprite.slice → image.upscale` needs no loop block. The
permission is one-way: a scalar cannot feed a collection input.

Collections come from **Collect Frames** (`frames.collect`), which gathers
several images into one ordered set, or from `image.generate` with a `count`
above one.

### Sketching

The **Sketch** block is a transparent window onto the canvas. Draw inside it,
run it, and the strokes become an `image` you can feed to any image tool.
Sketches are session-local — strokes live in the tldraw store, not the workflow
file, so a saved sketch pipeline reopens empty.

## Running from the command line

```
npm run workflow -- collected-animation
npm run workflow -- pipelines/workflows/prompt-variations.yaml --out ./out
```

Prints each step as it finishes, saves anything a Download block produces into
`workflow-output/` (`--out` to change), and exits non-zero when a step fails, so
it works in a script or in CI. Also `--to <step>`, `--fresh`, `--timeout <ms>`.
It reuses a running dev server, or starts one.

The engine has no DOM dependency, but several image tools are written against
browser primitives. Rather than keep a second image implementation for Node, the
runner loads `headless.html` — a page with no editor and no UI — in headless
Chromium and calls the same `runGraph` with the same tool registry. One
implementation, one set of pixels.

A Sketch block cannot run without the editor by definition, so a workflow using
one is refused before anything executes, naming the step. Tools declare this
with `canvasRegion` on their manifest.

## Generated images are cached

Generation is cached by its parameters — prompt, model, size, quality, format
and reference image — so rerunning an unchanged pipeline is free and
reproducible, the same way a build cache works.

Because generation has no seed, an unchanged rerun returns the **same** image
rather than a new sample. Asking for a new one is deliberate: **Regenerate** in a
generate block's footer menu, or `--fresh` from the command line. "Play from
here" reuses the cache on purpose. The cache lives in `.cache/images/` and is
disposable.

## Tests

```
npm test            # headless
npm run test:headed # watch it drive the browser
```

Playwright drives the real dev server, reusing one if already running. The tools
worth testing here — sprite slicing, GIF encoding, frame preview — need
`createImageBitmap` and a 2D canvas, so a real browser is the only place they can
run at all.

## Project layout

| path | what |
|---|---|
| `src/nodes` | Canvas block shapes, port layout, per-tool node definitions |
| `src/connection` | Connection shape and bindings between blocks |
| `src/ports` | Port types, rendering, drag interaction, compatibility rules |
| `src/tools` | Tool registry, built-in tool implementations, fan-out |
| `src/workflow` | Graph model, YAML parser, validator, `runGraph` |
| `src/execution` | Projects the canvas into a graph and writes results back |
| `src/headless` | The no-editor page the command line runner drives |
| `server/` | Local API, run in-process by the Vite dev server |
| `pipelines/` | Version-controlled workflows and prompt presets |
| `docs/` | [Design notes](docs/design-notes.md) |

This is a local development tool, not a hosted app. `npm run dev` starts a single
Vite server that also serves the API in-process, because the backend needs the
filesystem.

## Third-party notices

Not affiliated with or endorsed by tldraw. The
[tldraw SDK](https://github.com/tldraw/tldraw/blob/main/LICENSE.md) is a
dependency licensed separately by tldraw Inc. — its default license covers
development but not production use, and requires keeping the on-canvas
watermark. Read it before deploying.
