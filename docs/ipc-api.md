# `IPC` API Reference

`IPC` is the default export of the library and the recommended entry point for most use cases.

```ts
import IPC from 'mcbe-ipc';
// or
import { IPC } from 'mcbe-ipc';
```

Defined in [`src/ipc.ts`](../src/ipc.ts).

---

## `IPC.send`

```ts
function send<S>(channel: string, serializer: PROTO.Serializer<S>, value: NoInfer<S>): void
```

Broadcasts `value` on `channel` to every current listener registered with [`IPC.on`](#ipcon) or
[`IPC.once`](#ipconce) - fire-and-forget, no response expected. Internally emits on the
`ipc:{channel}:send` endpoint.

```ts
IPC.send('chat', PROTO.String, 'hello from pack A');
```

- `channel` - arbitrary channel name; only needs to match between sender and listener(s).
- `serializer` - anything implementing `PROTO.Serializer<S>` (every value in [`PROTO`](./serialization.md) qualifies).
- `value` - the payload. `NoInfer<S>` means `S` is inferred from `serializer`, not from `value`,
  so passing a value that doesn't match the serializer's type is a compile error.

## `IPC.on`

```ts
function on<D>(
  channel: string,
  deserializer: PROTO.Deserializer<D>,
  listener: (value: NoInfer<D>) => void
): () => void
```

Subscribes `listener` to every message sent on `channel` via [`IPC.send`](#ipcsend), indefinitely.
Returns an **unsubscribe function**.

```ts
const stop = IPC.on('chat', PROTO.String, message => console.log(message));
// later:
stop();
```

Multiple listeners can subscribe to the same channel; all of them are called for each message,
in registration order, each wrapped in its own `try`/`catch` so one throwing listener doesn't
stop the others.

## `IPC.once`

```ts
function once<D>(
  channel: string,
  deserializer: PROTO.Deserializer<D>,
  listener: (value: NoInfer<D>) => void
): () => void
```

Like [`IPC.on`](#ipcon), but automatically unsubscribes after the first message is received. The
returned function can still be called earlier to cancel before any message arrives.

```ts
IPC.once('ready-signal', PROTO.Void, () => console.log('the other pack is ready'));
```

## `IPC.invoke`

```ts
function invoke<S, D>(
  channel: string,
  serializer: PROTO.Serializer<S>,
  value: NoInfer<S>,
  deserializer: PROTO.Deserializer<D>
): Promise<NoInfer<D>>
```

Sends `value` on `channel` as a request and returns a `Promise` that resolves with the first
matching response from a handler registered via [`IPC.handle`](#ipchandle).

```ts
const sum = await IPC.invoke('add', PROTO.Tuple(PROTO.Float64, PROTO.Float64), [2, 3], PROTO.Float64);
```

- Each call generates a fresh correlation `guid`, so **concurrent calls on the same channel each
  resolve with their own matching response**, regardless of arrival order:

  ```ts
  const [a, b, c] = await Promise.all([
    IPC.invoke('multiply', Args, { a: 2, b: 3 }, PROTO.Float64),
    IPC.invoke('multiply', Args, { a: 5, b: 4 }, PROTO.Float64),
    IPC.invoke('multiply', Args, { a: 12, b: 7 }, PROTO.Float64)
  ]);
  ```

- If no handler is registered (or it never responds), the returned `Promise` never settles -
  there is no built-in timeout. Wrap it yourself with `Promise.race` against a timer if you need
  one.
- See [Correlation](./wire-protocol.md#correlation) for exactly how request/response matching
  works, including compatibility with older/newer library versions on the other end.

## `IPC.handle`

```ts
function handle<D, S>(
  channel: string,
  deserializer: PROTO.Deserializer<D>,
  serializer: PROTO.Serializer<S>,
  listener: (value: NoInfer<D>) => NoInfer<S>
): () => void
```

Registers a **single-purpose responder** for `channel`: whenever [`IPC.invoke`](#ipcinvoke) is
called with a matching channel, `listener` runs synchronously and its return value is sent back
as the response. Returns an unsubscribe function.

```ts
IPC.handle('add', PROTO.Tuple(PROTO.Float64, PROTO.Float64), PROTO.Float64, ([a, b]) => a + b);
```

- `listener` is a plain synchronous function, not a generator or `async` function - if you need
  to do something asynchronous before responding, resolve it beforehand and call `handle` with
  the already-known state captured in a closure, or (for a fully custom async responder) drop
  down to [`NET.listen`](./wire-protocol.md#netlisten)/[`NET.emit`](./wire-protocol.md#netemit)
  directly.
- Multiple `handle` calls on the same channel will all run for every `invoke` call, but only one
  response will typically "win" the caller's `Promise` (whichever arrives first) - in practice,
  register exactly one handler per channel.
- Parameter order is `(deserializer, serializer)` - deserializer for the incoming request,
  serializer for the outgoing response - mirroring the shape of the function itself
  (`D` in, `S` out).

## Type parameter reference

| Function | Serializes (out) | Deserializes (in) |
|---|---|---|
| `send<S>` | `S` | - |
| `on<D>` | - | `D` |
| `once<D>` | - | `D` |
| `invoke<S, D>` | `S` (request) | `D` (response) |
| `handle<D, S>` | `S` (response) | `D` (request) |

## Next

- [Serialization](./serialization.md) for what can go in the `serializer`/`deserializer` slots
- [Wire Protocol](./wire-protocol.md) for what happens underneath `IPC`
