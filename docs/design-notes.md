# Design notes

Why things work the way they do. The [README](../README.md) covers what the app
does; this covers the reasoning behind the parts that are not obvious.

## Workflows and file identity

Workflows are individual YAML files in `pipelines/workflows/`, read from disk at
runtime. **The filename is the workflow's identity** — there is no `id:` field,
so the name in git and the name in the app can never drift apart.

`name`, `description` and `tags` are optional. A workflow saved from the canvas
has none of them to write, so requiring them would reject the app's own output;
`name` falls back to the filename. Saving preserves any `description` and `tags`
already in the file, since neither has a representation on the canvas and a save
is an update rather than a replacement.

There is no saved-versus-built-in distinction: a workflow that ships with the
project and one a teammate committed last week are the same kind of thing.
`graphYaml.ts` is the only YAML format — saves, downloads, imports, catalog
files and programmatic runs all use it.

## Prompt presets

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
Text blocks currently wired into them are captured as defaults.

A rename writes the old filename into the file as `id:` before moving it, so
blocks that already copied the preset keep their link to it — no workflow file is
touched, and the pinned value says plainly where it came from.

When a preset's template changes after a block copied it, that block shows an
**Update** action. Nothing happens until it is clicked, and clicking it leaves a
normal diff in the workflow. Blocks saved before this existed have no recorded
fingerprint and are treated as unknown rather than out of date, so old workflows
stay quiet.

Editing the prompt on the canvas is tracked separately from the preset changing
upstream. A block you have edited is marked **edited** and is not nagged to
update; if the preset has *also* moved on, Update still appears but asks for a
second click, because taking the new version replaces what you wrote.

## Collections and fan-out

A port carries either one value or many, and the canvas says which before
anything runs:

- a **collection port is square**, a scalar port is round;
- a **collection connection is drawn as two parallel rails**, a scalar
  connection as one line;
- a block mapping over a collection shows a **`3/16` counter** in its header.

Arity was previously encoded only as a slightly different shade of the same
purple, which is not perceivable. Shape carries it instead, so it reads at a
glance and does not depend on colour vision.

The counter matters because a block that maps runs once per element.
`runToolMapped` runs a tool declaring a scalar `image` input once for each image
in an `image[]` and collects the outputs back into an array, so `sprite.slice →
image.upscale` needs no loop block. Without the counter, a block running sixteen
times is indistinguishable from a block that has hung. Elements run in sequence,
so mapping over an image API does not fire one request per frame at once.

Connecting a collection to a scalar input is therefore allowed, and is what
starts a fan-out. **The permission is one-way.** A scalar cannot feed a
collection input, because a tool declaring one reads it with `Array.isArray` and
a lone value would throw at run time.

A block that maps also *passes the collection on*: `generate ×4 → adjust → gif`
works, because `adjust` runs four times and its `image` output carries all four.
A block cannot tell that from its own configuration — it depends on what is
plugged in upstream — so `nodeFansOut` walks the connections to decide, and the
output port is drawn square as a result. It is the same rule `getFanOutSteps`
applies to a parsed workflow, so a graph cannot be drawn one way and validated
another.

Gathering is the inverse, and is what **Collect Frames** (`frames.collect`) does:
it takes several images and emits one `image[]`, so `sketch ×3 → frames.collect →
frames.gif` builds an animation from separately produced images.

Its slots are numbered — `item1`, `item2`, … — grown by a `count` field, rather
than being one port that accepts many connections. A collection's order is the
frame order of an animation, so it is load-bearing; numbered slots make that
order visible on the canvas and stable in the file, whereas the order connections
happened to be drawn in would be neither.

Every slot is required, so a gap is reported as `Required input "item2" is
missing` rather than quietly yielding a shorter animation. That check is the
ordinary one `validateGraph` applies to any required input, not special pleading
for this tool.

A collection can also arrive without being gathered: `image.generate` with a
`count` above one emits an `image[]`. Its output port becomes square as soon as
you change the count, before any call is made.

Any block previewing more than one image gets `‹ 2/8 ›` controls over the
preview. The controls wrap around, and the download button saves the frame on
screen. Nested arrays are flattened into one strip. The current frame is view
state, not document state: it is deliberately not stored on the shape, so
browsing frames never shows up in a workflow diff.

See also [`array-fan-out.md`](array-fan-out.md).

## Sketching

The **Sketch** block is a transparent window onto the canvas. It works because
the block's body claims no pointer events, so strokes land on the canvas
underneath rather than on the block. Running it exports just that rectangle,
excluding blocks and connections so a sketch that overlaps another block does not
capture that block's picture of itself. `ToolNode-region` is drawn full width and
first in the body precisely so that the rectangle you see is the rectangle that
gets exported.

**Sketches are session-local.** Strokes live in the tldraw store, not in the
workflow file, so a saved sketch pipeline reopens with an empty region. That is
the right trade for an ephemeral drawing, but it means an empty region is routine
rather than rare — so it fails with "Nothing to sketch" instead of quietly
emitting nothing and breaking further down the chain.

A tool declares itself a window with `canvasRegion: true` on its manifest and
reads the drawing through `context.canvas`, which only the canvas runner
supplies. A tool that needs a canvas must therefore say so, rather than assume
one: the same graph is meant to run headlessly too.

## Composing a GIF

- `fps` is capped at 50, because GIF stores frame delay in hundredths of a second
  and a faster rate rounds toward a delay of zero, which viewers replace with a
  default rate of their own.
- Transparency is carried through when any frame has it, which pairs with
  `image.generate`'s `background: transparent`.
- Every frame must be the same size. A mismatch is an error naming both sizes
  rather than a silent rescale, since scaling would quietly alter the art.

The palette is computed once across all frames and written as a single global
colour table. A per-frame palette makes flat colours drift slightly between
frames, which reads as flicker, and costs an extra 256-colour table per frame.

`image.download` corrects the file extension to match the bytes, so a GIF is not
saved as `out.png`. The ↓ button on a block's preview does the same, reading the
media type of the bytes it is about to save rather than assuming PNG.

## Generation settings

Each of `size`, `quality`, `background` and `format` defaults to `auto`, which is
sent as an omitted field so the model applies its own default rather than one
chosen here.

`background: transparent` needs `format: png`, since JPEG has no alpha channel.
The block rejects that combination before calling the API rather than quietly
returning an opaque image.

The size options are the set every deployment accepts. `gpt-image-1.5` takes a
fixed list, while `gpt-image-2` and `gpt-image-2.5-*` accept any size whose width
and height are both divisible by 16; the block offers the overlap so a saved
workflow keeps working if you switch models.

`count` asks the model for several images in one call, up to ten. That is not the
same as running the block twice: one call gives genuine variations of the same
prompt, and costs one round trip. The shape of the value follows the configured
count, not the number of images that came back — the port type is drawn on the
canvas before the call is made, so the value has to match what was promised even
if the model returns fewer.

## When a run fails

A failed run leaves a report in the bottom-right corner naming the block, the
kind of failure and the provider's own message, and outlines the failed block on
the canvas. Click the block name in the report to select and zoom to it. The
report stays until you dismiss it or start another run, because a generation
takes long enough that you are rarely still watching when it fails.

Failures are classified by HTTP status rather than by reading the message, so an
expired credential (401) is reported as an auth problem with a `npm run token`
hint, while a prompt that happens to mention a token is not.

## Canvas concepts

- **Tools** are executable capabilities registered in `ToolRegistry`.
- **Nodes** are canvas representations of tools. Nodes store a `toolId`; older
  node definitions remain loadable so previously persisted documents still open.
- **Connections** join the output of one node to the input of another, drawn as
  bezier curves and colour-coded by data type.
- **Ports** are typed endpoints on nodes. Only compatible ports can connect.

Dragging from a port creates a connection; dragging to empty space opens an
on-canvas node picker; clicking the middle of a connection inserts a node. Type
compatibility is enforced, and cycle detection prevents circular dependencies.

The app detects groups of connected nodes and draws region overlays around them
with play/stop controls. Canvas shapes are projected to the same `WorkflowGraph`
used by catalog and headless execution, then run by `runGraph`. Independent
branches execute concurrently.

A tool's input and output names share one namespace on the canvas, because a node
draws one port per name. An input and an output called the same thing would
collapse into a single port and leave the input unreachable, so the registry
rejects that at registration time. This is why the image tools take `source` (or
`reference` on `image.generate`) and emit `image`, rather than using `image` for
both.
