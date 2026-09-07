# Getting Started

## Installation

### NPM

```bash
npm install mcbe-ipc
```

```ts
import IPC, { PROTO } from 'mcbe-ipc';
```

### Manual

Download the files for your language from the latest
[release](https://github.com/OmniacDev/MCBE-IPC/releases/latest) and add them to your project:

- **JavaScript** - `ipc.js` and `ipc.d.ts`
- **TypeScript** - `ipc.ts`

## Dependencies

| Package | Version |
|---|---|
| `@minecraft/server` | `1.18.0` |

MCBE-IPC calls into `@minecraft/server`'s `system.sendScriptEvent` and
`system.afterEvents.scriptEventReceive` to move data between packs.

> [!TIP]
> Both sides of a conversation just need to import the module - each pack has its own independent
> JS runtime, and importing `mcbe-ipc` is enough to register its `scriptEventReceive` subscription.
> There's no separate "setup" or "init" call to make.

## Your first message: `send` / `on`

`send`/`on` is fire-and-forget, one-to-many messaging - like an event bus. Any number of packs
can listen on the same channel.

```ts
// pack A
import IPC, { PROTO } from 'mcbe-ipc';

IPC.on('greet', PROTO.String, name => {
  console.log(`Hello, ${name}!`);
});
```

```ts
// pack B
import IPC, { PROTO } from 'mcbe-ipc';

IPC.send('greet', PROTO.String, 'World');
```

Every value you send needs a **serializer** describing its shape - here, `PROTO.String`. See
[Serialization](./serialization.md) for the full catalog of built-in serializers and how to build
your own for objects, arrays, tuples, maps, and more.

## Request/response: `invoke` / `handle`

`invoke`/`handle` is a request-response RPC pattern, similar to `ipcRenderer.invoke` in Electron.
Exactly one `handle` responds to each `invoke` call, and the caller gets a `Promise` back.

```ts
// responder
IPC.handle('multiply', PROTO.Tuple(PROTO.Float64, PROTO.Float64), PROTO.Float64, ([a, b]) => a * b);
```

```ts
// caller
const result = await IPC.invoke('multiply', PROTO.Tuple(PROTO.Float64, PROTO.Float64), [6, 7], PROTO.Float64);
console.log(result); // 42
```

Multiple concurrent `invoke` calls to the same channel resolve independently and correctly, even
if responses arrive out of order - see [Correlation](./wire-protocol.md#correlation) for how that
works.

## Structured data with `PROTO.Object`

Most real messages carry more than one field. Compose serializers with `PROTO.Object`,
`PROTO.Array`, `PROTO.Tuple`, `PROTO.Optional`, `PROTO.Map`, and `PROTO.Set`:

```ts
const PlayerInfo = PROTO.Object({
  name: PROTO.String,
  health: PROTO.Float32,
  position: PROTO.Tuple(PROTO.Float64, PROTO.Float64, PROTO.Float64),
  tags: PROTO.Array(PROTO.String)
});

IPC.send('player-update', PlayerInfo, {
  name: 'Steve',
  health: 18.5,
  position: [10, 64, -3],
  tags: ['op', 'builder']
});
```

TypeScript infers the value type of `PlayerInfo` automatically - no separate `interface` needed,
though you can still supply one explicitly if you prefer (see
[Serialization -> Object](./serialization.md#object)).

## Cleaning up listeners

`on`, `once`, and `handle` all return an unsubscribe function:

```ts
const stop = IPC.on('greet', PROTO.String, name => console.log(name));
// ...later
stop();
```

## Next steps

- [Architecture](./architecture.md) - how `IPC`, `NET`, and `PROTO` relate
- [IPC API Reference](./ipc-api.md) - full signatures and semantics for every function
- [Serialization](./serialization.md) - every built-in serializer, and how to write your own
