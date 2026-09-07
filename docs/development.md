# Development

Notes for working on MCBE-IPC itself, as opposed to consuming it as a dependency.

## Repository layout

```
src/ipc.ts           the entire library (single file, ~1000 lines)
tests/ipc.test.ts     unit tests (Vitest)
tests/ipc.bench.ts     benchmarks (Vitest bench mode)
tests/mocks/          a minimal @minecraft/server mock, so tests run outside Minecraft
dist/                 build output (generated, not committed)
```

There's no monorepo, no bundler config, and no separate package per layer - `PROTO`, `NET`, and
`IPC` are namespaces inside the one file described in [Architecture](./architecture.md), not
separate packages.

## Scripts

| Command | Runs |
|---|---|
| `npm run build` | `tsc -p tsconfig.build.json` - compiles `src/ipc.ts` to `dist/ipc.js` + `dist/ipc.d.ts` |
| `npm test` | `vitest` against `tests/ipc.test.ts` |
| `npm run bench` | `vitest bench` against `tests/ipc.bench.ts` |
| `npm run format` | `prettier --write src` |
| `npm run prepublishOnly` | runs `build` automatically before `npm publish` |

### TypeScript configuration

Config is split in two: `tsconfig.json` is the base (used by editors/IDEs and by `tsc` when
type-checking) and covers both `src` and `tests`; `tsconfig.build.json` extends it, narrows
`include` to `src` only, and sets `outDir`/`rootDir` for the actual `npm run build` compile.

The base config targets `ES2020` for both `target` and `module` (matching the QuickJS engine
Minecraft Bedrock scripts run on), with `lib: ["ES2021", "DOM"]` pulled in for
`Uint8Array`/`DataView`/etc. `strict` and `noImplicitAny` are both on, `moduleResolution` is
`bundler`, and `declaration: true` produces the `.d.ts` alongside the compiled output.

### Code style

Prettier (`.prettierrc.json`) enforces single quotes, semicolons, no trailing commas, avoided
arrow-function parens, and CRLF line endings, at a 120-character print width. Run `npm run format`
before committing source changes.

## Testing without Minecraft

`@minecraft/server` only exists inside a running Minecraft Bedrock instance, so the test suite
substitutes a small mock at `tests/mocks/@minecraft/server/` that stands in for the pieces
MCBE-IPC actually uses: `system.sendScriptEvent`, `system.afterEvents.scriptEventReceive`, and
`system.runJob`.

One difference worth knowing if you're debugging a test: the mock's `runJob`
([`tests/mocks/@minecraft/server/system.ts`](../tests/mocks/@minecraft/server/system.ts)) drains
a generator to completion in a single synchronous loop:

```ts
runJob: vi.fn((generator: Generator<void, void, void>) => {
  let result = generator.next();
  while (!result.done) {
    result = generator.next();
  }
})
```

The real Minecraft engine instead resumes a job's generator a little at a time, spread across
multiple ticks. This keeps tests fast and deterministic, but it means the test suite can't catch
timing issues that only show up when a job is actually interleaved with other game ticks.

`tests/ipc.test.ts` doubles as a large set of runnable usage examples - see it referenced
throughout [FAQ & Troubleshooting](./faq-troubleshooting.md) and elsewhere in these docs.
`tests/ipc.bench.ts` benchmarks `send`/`invoke` round trips and the `PROTO.MIPS`/`NET`
encode-decode paths, including the [`PROTO.Cached`](./advanced-serializers.md#cached) hit-vs-miss
cost.

## Next

- [Architecture](./architecture.md)
- [Glossary](./glossary.md)
