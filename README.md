# Image pipeline

This starter kit builds a visual node-graph editor for AI image generation pipelines on top of [tldraw](https://github.com/tldraw/tldraw). Users place nodes on an infinite canvas, wire up typed ports, and run the graph to generate images — similar to ComfyUI, but built with React and tldraw.

## Environment setup

This app generates images with **Azure OpenAI GPT Image** models. Copy
`.env.example` to `.env` and set `AZURE_OPENAI_ENDPOINT` to your Azure OpenAI
resource. If that resource has key-based auth disabled, authenticate with an
Entra ID (Azure AD) token:

```
az login
npm run token   # writes AZURE_OPENAI_TOKEN into .env (valid ~1 hour)
```

Re-run `npm run token` whenever generation starts returning 401s. A service
principal (`AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET`)
auto-refreshes and avoids the hourly refresh.

## Models

The model picker is built from `server/models.ts`, filtered by the credentials
this server actually has. Every model is an Azure OpenAI deployment
(`gpt-image-1.5`, `gpt-image-2`, `gpt-image-2.5-flare`, `gpt-image-2.5-sunburst`)
and needs the Azure variables above. Models whose provider is unconfigured are
not offered, so the picker can never list something the server cannot call. Add
a model by adding one entry to `MODELS` — the UI needs no change.

Connecting an image into a Generate block's `image` port switches it from
text-to-image to image-to-image, which the server routes to the Azure
`/images/edits` endpoint. The whole GPT Image family accepts a reference image,
so there is no per-model capability flag.

Without valid credentials, generation requests will fail with an error.

## Local development

Install dependencies with `yarn` or `npm install`.

Run the development server with `yarn dev` or `npm run dev`.

Open `http://localhost:5173/` in your browser to see the app.

### Tests

```
npm test            # headless
npm run test:headed # watch it drive the browser
```

Playwright drives the real dev server, reusing one if it is already running. The tools worth
testing here — sprite slicing, GIF encoding, frame preview — all need `createImageBitmap` and a
2D canvas, so a real browser is the only place they can run at all.

Tests reach the tool registry through the dev-only `window.workflowTools` and `window.workflow`
handles, which lets them exercise a tool directly without first authoring a graph by hand.

## Workflows

The single **Workflows** button opens the workflow catalog, which lists every
file in `pipelines/workflows/`. There is no saved-versus-built-in distinction: a
workflow that ships with the project and one a teammate committed last week are
the same kind of thing. Selecting one creates a named tldraw page and
materializes the workflow as registry-backed canvas blocks. The canvas is the
workflow editor; there is no in-app YAML editor.

```yaml
version: 1
steps:
  - id: prompt
    tool: prompt.liquid
    with:
      template: "{{subject}}, pixel art game character"
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

The catalog can:

- open any workflow in `pipelines/workflows/` on its own canvas page;
- save the current page back to `pipelines/workflows/<name>.yaml`;
- delete a workflow file;
- download or import a canvas workflow YAML file;
- drag executable tools from the main sidebar, which is generated from the
  ToolRegistry and grouped as Input, Process, and Output;
- execute tools and connected downstream blocks directly on the canvas.

Workflows are individual YAML files in `pipelines/workflows/`, read from disk at
runtime. **The filename is the workflow's identity** — there is no `id:` field,
so the name in git and the name in the app can never drift apart.

`name`, `description` and `tags` are optional. A workflow saved from the canvas
has none of them to write, so requiring them would reject the app's own output;
`name` falls back to the filename. Saving preserves any `description` and `tags`
already in the file, since neither has a representation on the canvas and a save
is an update rather than a replacement.

### Prompt presets

Prompt presets live in one modal catalog of image / name / prompt cards, opened
from the **Liquid Prompt** canvas block. Picking a preset fills in its template.
Each `{{ variable }}` in that template becomes an input port, and a Text block is
created and wired into each one, so variables are edited on the canvas like any
other value.

Each preset is a YAML file in `pipelines/prompts/`, with its preview artwork in
`pipelines/prompts/images/`. As with workflows, the filename is the identity.
Artwork is optional — a preset without an `image:` shows a lettered placeholder.

**Presets are copied, not referenced.** Applying one writes the template into the
block, so a workflow keeps running exactly as committed even if the preset is
later edited or deleted. A prompt change therefore always shows up as a diff in
the workflow that changed, never as invisible drift. The `preset` field records
only where the template came from.

The catalog works in both directions. Once a prompt is tuned on the canvas, the
save button on the **Liquid Prompt** block writes it back out to
`pipelines/prompts/` — `{{ variables }}` are derived from the template, and the
Text blocks currently wired into them are captured as defaults. Presets can be
renamed and deleted from the catalog. Renaming changes the display name and the
filename together, so the two never drift apart in the file tree or in a pull
request.

A preset's identity is its filename, which is why presets ship without an `id:`
field. A rename writes the old filename into the file as `id:` before moving it,
so blocks that already copied the preset keep their link to it — no workflow file
is touched, and the pinned value says plainly where it came from.

When a preset's template changes after a block copied it, that block shows an
**Update** action. Nothing happens until it is clicked, and clicking it leaves a
normal diff in the workflow. Blocks saved before this existed have no recorded
fingerprint and are treated as unknown rather than out of date, so old workflows
stay quiet.

Editing the prompt on the canvas is tracked separately from the preset changing
upstream. A block you have edited is marked **edited** and is not nagged to
update; if the preset has *also* moved on, Update still appears but asks for a
second click, because taking the new version replaces what you wrote.

Built-in tools include `const.text`, `const.image`, `prompt.liquid`,
`image.generate`, `image.removeBackground`, `image.adjust`, `image.blend`, `image.upscale`,
`sprite.slice`, `frames.gif`, image/frame preview
sinks, and image/ZIP download sinks.

A tool's input and output names share one namespace on the canvas, because a node draws one port
per name. An input and an output called the same thing would collapse into a single port and
leave the input unreachable, so the registry rejects that at registration time. This is why the
image tools take `source` (or `reference` on `image.generate`) and emit `image`, rather than
using `image` for both.

### Collections

A port carries either one value or many, and the canvas says which before anything runs:

- a **collection port is square**, a scalar port is round;
- a **collection connection is drawn as two parallel rails**, a scalar connection as one line;
- a block mapping over a collection shows a **`3/16` counter** in its header.

Arity was previously encoded only as a slightly different shade of the same purple, which is not
perceivable. Shape carries it instead, so it reads at a glance and does not depend on colour
vision.

The counter matters because a block that maps runs once per element. `runToolMapped` runs a tool
declaring a scalar `image` input once for each image in an `image[]` and collects the outputs
back into an array, so `sprite.slice → image.upscale` needs no loop block. Without the counter, a
block running sixteen times is indistinguishable from a block that has hung.

Connecting a collection to a scalar input is therefore allowed, and is what starts a fan-out.
**The permission is one-way.** A scalar cannot feed a collection input, because a tool declaring
one reads it with `Array.isArray` and a lone value would throw at run time.

A block that maps also *passes the collection on*: `generate ×4 → adjust → gif` works, because
`adjust` runs four times and its `image` output carries all four. A block cannot tell that from
its own configuration — it depends on what is plugged in upstream — so `nodeFansOut` walks the
connections to decide, and the output port is drawn square as a result. It is the same rule
`getFanOutSteps` applies to a parsed workflow, so a graph cannot be drawn one way and validated
another.

Gathering is the inverse, and is what **Collect Frames** (`frames.collect`) does: it takes
several images and emits one `image[]`, so `sketch ×3 → frames.collect → frames.gif` builds an
animation from separately produced images.

Its slots are numbered — `item1`, `item2`, … — grown by a `count` field, rather than being one
port that accepts many connections. A collection's order is the frame order of an animation, so
it is load-bearing; numbered slots make that order visible on the canvas and stable in the file,
whereas the order connections happened to be drawn in would be neither.

Every slot is required, so a gap is reported as `Required input "item2" is missing` rather than
quietly yielding a shorter animation. That check is the ordinary one `validateGraph` applies to
any required input, not special pleading for this tool.

A collection can also arrive without being gathered: `image.generate` with a `count` above one
emits an `image[]`. Its output port becomes square as soon as you change the count, before any
call is made, so `generate ×4 → frames.gif` can be drawn like any other connection.

### Sketching

The **Sketch** block is a transparent window onto the canvas. Draw inside it with the pencil, run
it, and the strokes become an `image` you can feed to any image tool — a reference for
`image.generate`, say.

It works because the block's body claims no pointer events, so strokes land on the canvas
underneath rather than on the block. Running it exports just that rectangle, excluding blocks and
connections so a sketch that overlaps another block does not capture that block's picture of
itself. `ToolNode-region` is drawn full width and first in the body precisely so that the
rectangle you see is the rectangle that gets exported.

**Sketches are session-local.** Strokes live in the tldraw store, not in the workflow file, so a
saved sketch pipeline reopens with an empty region. That is the right trade for an ephemeral
drawing, but it means an empty region is routine rather than rare — so it fails with "Nothing to
sketch" instead of quietly emitting nothing and breaking further down the chain.

A tool declares itself a window with `canvasRegion: true` on its manifest and reads the drawing
through `context.canvas`, which only the canvas runner supplies. A tool that needs a canvas must
therefore say so, rather than assume one: the same graph is meant to run headlessly too.

### Composing a GIF

`frames.gif` turns an `image[]` into one animated GIF, so `sprite.slice → frames.gif →
image.download` produces a finished animation with no external tooling.

- `fps` is capped at 50, because GIF stores frame delay in hundredths of a second and a faster
  rate rounds toward a delay of zero, which viewers replace with a default rate of their own.
- `loop` chooses between looping forever and playing once.
- Transparency is carried through when any frame has it, which pairs with
  `image.generate`'s `background: transparent`.
- Every frame must be the same size. A mismatch is an error naming both sizes rather than a
  silent rescale, since scaling would quietly alter the art.

The palette is computed once across all frames and written as a single global colour table. A
per-frame palette makes flat colours drift slightly between frames, which reads as flicker, and
costs an extra 256-colour table per frame.

`image.download` corrects the file extension to match the bytes, so a GIF is not saved as
`out.png`. The ↓ button on a block's preview does the same, reading the media type of the bytes
it is about to save rather than assuming PNG.

### Generation settings

`image.generate` exposes `size`, `quality`, `background` and `format` next to the model picker.
Each defaults to `auto`, which is sent as an omitted field so the model applies its own default
rather than one chosen here.

`background: transparent` needs `format: png`, since JPEG has no alpha channel. The block rejects
that combination before calling the API rather than quietly returning an opaque image.

The size options are the set every deployment accepts. `gpt-image-1.5` takes a fixed list, while
`gpt-image-2` and `gpt-image-2.5-*` accept any size whose width and height are both divisible by
16; the block offers the overlap so a saved workflow keeps working if you switch models.

`count` asks the model for several images in one call, up to ten. That is not the same as running
the block twice: one call gives genuine variations of the same prompt, and costs one round trip.
Above one the block emits an `image[]` rather than a single image — see **Collections** — so the
whole set flows onward instead of the first being kept and the rest discarded, which is what this
did before.

The shape of the value follows the configured count, not the number of images that came back. The
port type is drawn on the canvas before the call is made, so the value has to match what was
promised even if the model returns fewer.

### When a run fails

A failed run leaves a report in the bottom-right corner naming the block, the kind of failure and
the provider's own message, and outlines the failed block on the canvas. Click the block name in
the report to select and zoom to it. The report stays until you dismiss it or start another run,
because a generation takes long enough that you are rarely still watching when it fails.

Failures are classified by HTTP status rather than by reading the message, so an expired
credential (401) is reported as an auth problem with a `npm run token` hint, while a prompt that
happens to mention a token is not.

### Mapping over frames
Connecting an `image[]` to a tool that expects a single `image` runs that tool once per element
and collects the results back into an `image[]`. So `sprite.slice → image.removeBackground →
frames.downloadZip` works with no loop block: every tool is array-capable for free. Tools that
declare `image[]` receive the whole set instead. Elements run in sequence, so mapping over an
image API does not fire one request per frame at once.

Any block previewing more than one image gets `‹ 2/8 ›` controls over the preview, so
`frames.preview` and any array-producing block can be stepped through frame by frame rather than
showing only the first. The controls wrap around, and the download button saves the frame on
screen. Nested arrays are flattened into one strip.

The current frame is view state, not document state: it is deliberately not stored on the shape,
so browsing frames never shows up in a workflow diff.

## How it works

This starter kit has 3 main concepts:

1. **Tools**: Tools are executable capabilities registered in `ToolRegistry`.
2. **Nodes**: Nodes are canvas representations of tools. Nodes store a `toolId`; older node
   definitions remain loadable so previously persisted documents still open.
3. **Connections**: A connection joins the output of one node to the input of another. Connections are drawn as bezier curves and are color-coded by data type.
4. **Ports**: Ports are typed endpoints on nodes. Each port has a data type and only compatible ports can be connected.

There are lots of useful interactions the user can take involving these concepts:

- Dragging from a port lets the user create a new connection
- Dragging from a port to empty space opens an on-canvas node picker
- Clicking in the middle of a connection lets the user insert a new node
- Connections enforce type compatibility — you can't connect an image port to a model port
- Cycle detection prevents circular dependencies

The app automatically detects groups of connected nodes and draws region overlays around them
with play/stop controls. Each node also has a "play from here" button. Canvas shapes are projected
to the same `WorkflowGraph` used by catalog and headless execution, then run by `runGraph`.
Independent branches execute concurrently. A canvas adapter writes status and outputs back to the
shapes.

`graphYaml.ts` is the only YAML format. Saves, downloads, imports, catalog files, and programmatic
runs all use it.

## File structure

- **`src/App.tsx`:** The main entry-point. Renders the `<Tldraw />` component with custom shape utils, a sidebar, and a registry-backed starter workflow.
- **`src/nodes`:** Everything related to nodes.
  - **`src/nodes/NodeShapeUtil.tsx`:** The node shape util, which defines a custom tldraw shape for our nodes.
  - **`src/nodes/nodeTypes.tsx`:** The registry of all node type definitions.
  - **`src/nodes/nodePorts.tsx`:** Helpers for working with the ports on a node and the values flowing through them.
  - **`src/nodes/types/`:** Each node type definition. Nodes define their ports, default props, body height, execution logic, and React component.
- **`src/connection`:** Everything related to connections.
  - **`src/connection/ConnectionShapeUtil.tsx`:** The connection shape util, which renders bezier curves between ports.
  - **`src/connection/ConnectionBindingUtil.tsx`:** The connection binding util. Each connection has two bindings — one to the start node, and one to the end node.
  - **`src/connection/insertNodeWithinConnection.tsx`:** A helper for inserting a new node in the middle of a connection.
  - **`src/connection/keepConnectionsAtBottom.tsx`:** Side effect listeners that keep connections below nodes in the z-order.
- **`src/ports`:** Everything related to ports.
  - **`src/ports/Port.tsx`:** Defines port types and a React component for rendering them.
  - **`src/ports/PointingPort.tsx`:** An entry in tldraw's interaction state tree which extends the select tool with custom port interaction behavior.
  - **`src/ports/portCompatibility.ts`:** Type compatibility rules for connecting ports.
- **`src/execution`:** Everything related to running workflows.
  - **`src/execution/CanvasExecution.ts`:** Projects canvas blocks into `WorkflowGraph`, invokes
    `runGraph`, and writes results back to shapes.
  - **`src/execution/canvasValueCodec.ts`:** Converts serializable canvas image values to and from
    native byte-backed tool values.
  - **`src/execution/executionState.ts`:** Execution state management — tracking which nodes are running, results, and errors.
- **`src/workflow`:** The canonical graph model, YAML parser, validator, runner, canvas projection,
  and page opening helpers.
- **`src/components`:** UI and on-canvas React components.
  - **`src/components/PipelineToolbar.tsx`:** A replacement for tldraw's default toolbar, rendered vertically on the left with draggable node types.
  - **`src/components/ImagePipelineSidebar.tsx`:** A sidebar for saved templates and settings.
  - **`src/components/OnCanvasNodePicker.tsx`:** A panel that appears on the canvas when dragging a connection to empty space, letting the user choose a compatible node to insert.
  - **`src/components/PipelineRegions.tsx`:** Finds groups of connected nodes, draws bounding boxes around them, and provides play/stop controls.
- **`src/templates`:** Save and restore reusable subgraphs.
- **`pipelines/`:** Version-controlled content, committed to git and shared by the team.
  - **`pipelines/workflows/`:** One YAML file per workflow. The filename is the id.
  - **`pipelines/prompts/`:** One YAML file per prompt preset, plus its `images/`.
- **`server/`:** The local API, run in-process by the Vite dev server.
  - **`server/vitePlugin.ts`:** Mounts the API as Vite middleware and bridges Node requests to `Request`/`Response`.
  - **`server/router.ts`:** Route table.
  - **`server/env.ts`:** Configuration and storage handles, loaded from `.env`.
  - **`server/routes/`:** Handlers for generate, models, image cache, and pipeline files.
  - **`server/storage/`:** Filesystem adapters for pipeline YAML and the image cache.
  - **`server/providers/`:** Provider abstraction for Azure OpenAI API calls.
- **`docs/`:** Design notes.
  - **`docs/array-fan-out.md`:** How an `image[]` maps over tools that expect a single `image`, and the known gaps in that behaviour.

## How it runs

This is a local development tool, not a hosted app. `npm run dev` starts a
single Vite server that also serves the API in-process, because the backend
needs the filesystem: it reads and writes the project's `pipelines/` directory
and caches generated images under `.cache/images/`.

That cache is gitignored and disposable — deleting it only forces regeneration.
Everything meant to be shared is plain YAML under `pipelines/`, so workflows and
prompts are reviewed in pull requests and versioned like any other source file.

### Generated images are cached

Generation is the slow, costly step, so results are cached by their parameters —
prompt, model, size, quality, format and reference image. Rerunning an unchanged
pipeline reuses them and costs nothing, the same way a build cache works. A
cached run is reproducible: the same workflow produces byte-identical output.

Because generation has no seed, that also means an unchanged rerun returns the
**same** image rather than a new sample. Asking for a new one is deliberate:

- On the canvas, use **Regenerate** in a generate block's footer menu. "Play from
  here" reuses the cache on purpose.
- From the command line, pass `--fresh`.

Either way the new image replaces the cached one, so later runs are consistent
with what you last saw. The cache lives in `.cache/images/` and is disposable.

## Running a workflow from the command line

A workflow runs the same way with or without the editor:

```
npm run workflow -- collected-animation
npm run workflow -- pipelines/workflows/prompt-variations.yaml --out ./out
```

It prints each step as it finishes, saves anything a Download block produces
into `workflow-output/` (override with `--out`), and exits non-zero when a step
fails — so it works in a script or in CI. Other options are `--to <step>` to
stop at one step, `--fresh` to bypass the generation cache, and `--timeout <ms>`
for a per-step limit. It reuses a dev server if one is already running, and
otherwise starts one.

### Why it still uses a browser

The engine itself has no DOM dependency, but several image tools are written
against browser primitives (`createImageBitmap`, a 2D canvas). So rather than
keep a second image implementation for Node, the runner loads `headless.html` —
a page with no editor and no UI — in headless Chromium and calls the same
`runGraph` with the same tool registry. One implementation, one set of pixels: a
GIF built from the command line is byte-for-byte the GIF built on the canvas.

### Steps that need the canvas

A Sketch block reads what you drew inside it, so it cannot run without the
editor by definition. The runner refuses such a workflow **before** executing
anything and names the step:

```
This workflow cannot run headlessly because it draws on the canvas: "drawing" (Sketch).
```

Tools declare this with `canvasRegion` on their manifest, so a new canvas-reading
tool is covered the day it is written rather than needing to be added to a list.

## Third-party notices

Not affiliated with or endorsed by tldraw. The
[tldraw SDK](https://github.com/tldraw/tldraw/blob/main/LICENSE.md) is a
dependency licensed separately by tldraw Inc. — its default license covers
development but not production use, and requires keeping the on-canvas
watermark. Read it before deploying.
