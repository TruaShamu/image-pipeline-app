# Array fan-out

How an `image[]` flows through tools that only understand a single `image`.

## The rule

Connecting an `image[]` to a scalar `image` input runs that tool **once per element** and collects
the results back into an `image[]`. Nothing opts in. Every tool is array-capable for free, so

```
sprite.slice → image.removeBackground → frames.downloadZip
```

validates and runs with no loop block, even though `image.removeBackground` declares a single
`image`.

A tool that declares `image[]` is asking for the whole set, so it is handed the array untouched.
That is how the chain terminates: `frames.downloadZip` gathers, `image.removeBackground` maps.

Two pieces implement this:

- `src/tools/runToolMapped.ts` — the execution. Maps the tool over elements and collects outputs.
- `graphValidation.ts:getFanOutSteps` — the type propagation. A step that fans out has its scalar
  `image` outputs re-typed as `image[]`, which is what lets fan-out propagate down a chain.

### Broadcasting

Only inputs whose **value** is an array are mapped. Every other input is copied into each element
unchanged, so scalars broadcast:

```
image.blend(frames[], watermark) → blends the one watermark onto all 16 frames
```

This is the NumPy rule, and it is the reason fan-out is worth having rather than being a loop
shortcut. Mapped inputs must agree on length; mismatched lengths are an error.

### Elements run in sequence

Deliberate. Mapping a 16-frame sheet over an image API would otherwise fire 16 concurrent
generations. There is currently no concurrency control beyond "one at a time".

## Why it is built this way

Implicit lifting of a scalar operation over a collection is a well-established pipeline design:
Nextflow channels auto-scatter over processes, Houdini SOPs run per-point, NumPy broadcasts, and
ComfyUI passes batched latents through unbatched nodes. GitHub Actions `strategy.matrix` is the
same idea made explicit. The cost of the implicit version is that the fan-out is invisible unless
the UI says so — see the gaps below.

## Known gaps

None of these are resolved. They are recorded here so the next person does not have to rediscover
them.

### 1. Nested arrays are unrepresentable but reachable

`sprite.slice` declares `sheet: image` and `frames: image[]`. Feed it an `image[]` — two
fanned-out generates, say — and `runToolMapped` maps over the sheets and pushes each `image[]`
result into the collection, producing `image[][]`.

`effectiveOutputType` (`graphValidation.ts:73`) only upgrades `image` → `image[]`. It never
upgrades `image[]` → `image[][]`, so the validator reports `image[]` and passes the graph. The
runner then hands a whole array to a tool expecting one image. Silent corruption, no error.

Two defensible fixes:

- **Refuse.** Error when a fanning step has an array-typed output. Honest and reversible, but a
  dead end for the user: there is no loop or gather block, so there is no way to express the
  intent afterwards.
- **Flatten.** Collect with `push(...)` instead of `push`, so two sheets yield 32 frames. This is
  Nextflow's `.flatten()` and Beam's `FlatMap`, and it makes `effectiveOutputType` correct with no
  validator change at all. It also discards which sheet each frame came from, permanently.

Refusing is preferred for now, because "flatten is what I meant" and "I miswired this" are
byte-identical at the type level. Erroring asks the human once; flattening answers for them
forever. Flatten remains a one-line upgrade if the dead end proves annoying in practice.

**Any guard belongs in `runToolMapped`, not the validator.** See gap 4.

### 2. Fan-out is invisible

`getFanOutSteps` has exactly one consumer: the validator. Nothing in the UI indicates that a node
is about to run 16 times and take four minutes.

Run-time is the cheap half and is nearly free: `runToolMapped` already emits
`context.log('mapped 3/16')`, and `ToolNode.execute` throws it into `console.debug`. Routing that
to node status covers most of the complaint.

Edit-time is harder, and note the real constraint: the **count is runtime data**, so before a run
the indicator can only say "runs per element", not `×16`. Styling the wire as a bundle when it
carries an `image[]` is likely better than a node badge, because it shows *where* the arity
changes and how far it propagates rather than just flagging one node.

### 3. One failed element discards the successes

A throw from `tool.run` aborts the whole loop, so a failure on frame 12 of 16 loses frames 1–11.
For sequential image generation that is minutes of real spend.

- **Collect-and-continue** (push `null` and keep going) is a trap: it pushes null-handling into
  every downstream tool forever.
- **Per-element retry with backoff** is the cheap win. The realistic failure at frame 12 is a 429
  or a transient 5xx, not a deterministic error.
- **Resume-from-cache** is the real fix, and the infrastructure already exists in `.cache/images/`
  plus the image cache route. Key on `hash(tool.id + normalized inputs)` so a re-run skips
  completed elements. This also pays off whenever a downstream node is tweaked. One wrinkle:
  caching is sound for deterministic tools, but `image.generate` is non-deterministic unless
  seeded. `/api/generate` accepts a `seed` that the client never sends; sending one makes the
  cache sound and makes runs reproducible.

### 4. The canvas is the unvalidated path

`ToolNode.execute` (`src/nodes/types/ToolNode.tsx`) calls `runToolMapped` directly and never calls
`validateGraph`. Validation only guards the YAML graph runner. Any fix that lives solely in
`graphValidation.ts` leaves the primary UX exposed.

The same method passes `signal: new AbortController().signal`, a signal that can never fire, so
the `context.signal.aborted` check inside the map loop is dead on this path: **a 16-frame map
cannot be cancelled from the canvas.** This should be fixed before retry or resume land, since
both lengthen the time a map is in flight.

### 5. There is no animation output

`sprite.slice` is correct — it emits PNG frames. But nothing downstream ever produces an
animation:

- **Preview** shows one frame. `firstImage` (`ToolNode.tsx:131`) unwraps `image[]` by recursing
  into `value[0]`, so `frames.preview` renders a static first frame. The port row reports
  `"16 frames"` as text.
- **Export** is a ZIP of stills, via `frames.downloadZip` and `fflate`.
- **`frames.preview.run()` is a no-op** — it checks `Array.isArray` and returns `{}`. All the
  behaviour is in the canvas component.
- There is **no GIF encoder in the project**. The only `gif` token in the repo is the `.gif` entry
  in the MIME map at `server/routes/pipelines.ts:62`, which serves files rather than encoding
  them.

So the `animated-sprite-sheet` workflow produces a sprite sheet, real frames, and a ZIP — but
never anything animated.

Note that `firstImage` recursing through arrays also means it silently papers over gap 1: given an
`image[][]` it renders `frames[0][0]` rather than failing.

## Proposed: `frames.encodeGif`

Closing gap 5 should be a **transform, not a sink**: `image[]` in, a single `image` out carrying
`mimeType: 'image/gif'`.

That shape is worth the detour because `toolValueToCanvasValue`
(`src/execution/canvasValueCodec.ts:120`) builds its data URL from `value.mimeType` rather than
hardcoding PNG. A GIF `ImageValue` therefore becomes `data:image/gif;base64,…`, and browsers
animate that natively in an `<img>`. So:

```
sprite.slice → frames.encodeGif → image.preview
```

gives an **animated canvas preview with no new rendering code**, and
`frames.encodeGif → image.download` gives export, reusing tools that already exist. A dedicated
`frames.downloadGif` sink would need both, and compose with neither.

Suggested inputs: `frames: image[]`, `fps` or `delayMs`, `loop`. It belongs client-side alongside
`sprite.slice` and `image.blend`, which already use canvas APIs.

### The transparency problem

This is the real design constraint, and it hits the exact pipeline this project ships.

GIF transparency is **1-bit** — a pixel is fully transparent or fully opaque. But
`image.removeBackground` produces an **8-bit alpha channel** with antialiased edges. The intended
chain `slice → removeBackground → encodeGif` is therefore the worst case for GIF: soft edges
collapse into hard jagged ones, usually with a halo of whatever colour the matte was.

Options, none free:

- **Matte against a background colour** and encode opaque. Predictable, and correct when the GIF
  will sit on a known background. Add a `background` input.
- **Threshold alpha** at some cutoff. Keeps transparency, produces the jagged edge.
- **Encode APNG or animated WebP instead**, which support full alpha. Better output, and both
  animate natively in an `<img>` too, so the transform shape above still holds. WebP is the
  better modern target; GIF wins only on universal paste-anywhere compatibility.

GIF's 256-colour palette is a secondary concern. It is mostly fine for pixel-art sprites — the
actual use case — and bands badly on photographic or painterly output from GPT Image.

## Suggested order

| # | Change | Why |
| --- | --- | --- |
| 1 | Real abort signal | Three lines; gates everything below; uncancellable spend is the worst of these |
| 2 | Guard in `runToolMapped` | Closes the silent corruption on both entry paths |
| 3 | `log` → node status | Free; `mapped 3/16` already exists |
| 4 | Per-element retry | Small, addresses the common failure |
| 5 | `frames.encodeGif` | Finishes the sprite workflow; animated preview falls out of it |
| 6 | Validator error + wire styling | Edit-time feedback, larger surface |
| 7 | Resume-from-cache (+ seeds) | Biggest win, biggest job |
