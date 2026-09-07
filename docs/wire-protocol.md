# Wire Protocol (`NET`)

This page documents exactly what crosses the `scriptevent` boundary and why - useful for
debugging, for interoperating with a non-JS/TS implementation, or just for satisfying curiosity.
Casual users of the library can generally stop at [`IPC`](./ipc-api.md). `NET` is defined in
[`src/ipc.ts`](../src/ipc.ts).

## The constraint: `scriptevent`

Minecraft Bedrock's script API exposes exactly one cross-pack communication primitive:

```ts
system.sendScriptEvent(id: string, message: string): void;
system.afterEvents.scriptEventReceive.subscribe(event => { event.id; event.message; event.sourceType; });
```

Both `id` and `message` are plain strings with restrictive length limits, and that's the entire
surface area. Everything in `NET` exists to turn this into something that can carry an arbitrarily
large, structured, binary payload.

## Endpoints and the packet header

`NET` groups messages by a string **endpoint** (e.g. `ipc:mychannel:send`) and attaches a small
**header** to every packet:

```ts
type Meta = { guid: string; signature: string };
type Header = { meta: Meta; index: number; final: boolean };
```

| Field | Purpose |
|---|---|
| `meta.guid` | Identifies a logical *packet* (which may span multiple fragments, see [Fragmentation](#fragmentation)), and, for `invoke`/`handle`, correlates a request with its response (see [Correlation](#correlation)) |
| `meta.signature` | A version/feature marker, currently `"mcbe-ipc:v3"`, optionally suffixed `+correlation` |
| `index` / `final` | This fragment's position, and whether it's the last one, in its packet |

Both the `endpoint` string and the `Header` are run through `PROTO.Checked(...)` before being
trusted, since a `scriptevent` in principle could arrive from any pack in the world, not just ones
running this library correctly.

## MIPS encoding

MIPS is short for the **MCBE-IPC Packet Standard** - the formal spec for this library's packet
structure and wire format, published separately as an RFC:
[MCBE-IPC Packet Standard (MIPS)](https://gist.github.com/OmniacDev/ecd6f61ffd8d0ed6be1b7cf6ecea9145).
This page summarizes the parts of it implemented by `src/ipc.ts`; the RFC is the source of truth
for the wire format itself, including for anyone implementing a compatible client in another
language.

In code, `PROTO.MIPS` refers specifically to the small hex-string encoding the RFC defines for
embedding a serialized `Buffer` in a Minecraft `scriptevent` **`id`** field, since that field
can't carry arbitrary binary data. `endpoint` and `Header` are serialized to bytes via `PROTO`,
then wrapped by `PROTO.MIPS` before being placed in `id`:

```
(0x<uppercase-hex-byte-pairs>)
```

```ts
PROTO.MIPS.is_valid('(0x48656C6C6F)'); // true - starts with "(0x", ends with ")"
```

This encoding is deliberately simple (2 hex chars per byte, always ASCII) rather than dense,
because it's only used for the small, fixed-shape endpoint + header data that rides in the `id`
field - and critically, it never produces a `:` character, which matters because...

## Assembling the `scriptevent` call

`NET.emit` builds each outgoing `scriptevent` call as:

```
id:      "{MIPS(serialized endpoint)}:{MIPS(serialized header)}"
message: "{one fragment of the NET-encoded payload}"
```

On receipt, the handler:

1. Ignores the event unless `sourceType === ScriptEventSource.Server`.
2. Splits `event.id` on `:` into `[serialized_endpoint, serialized_header]` - safe, because MIPS
   output never contains `:`.
3. Validates and deserializes the endpoint; looks up listeners registered for it.
4. Validates and deserializes the header.
5. Calls every registered listener for that endpoint with `(header, event.message)`, each
   independently `try`/`catch`-wrapped so one throwing listener can't break the others.

## Fragmentation

A packet's serialized payload may not fit in one `scriptevent` message. `NET.serialize` splits a
`PROTO.Buffer` into one or more strings, each within a configurable byte budget:

```ts
export let FRAG_MAX: number = 2048; // mutable - tune to your platform's actual scriptevent message limit
```

### Message packing: denser than MIPS

Unlike the `id` field's simple hex encoding, the **`message`** field uses a mixed encoding
designed to pack more data per character, since `message` is where the bulk of the payload lives:

`NET.serialize` reads the buffer two bytes at a time as a little-endian 16-bit `char_code`:

- If `char_code <= 0xFF` (i.e. the second/high byte is `0`) - the common case for buffers full of
  small values - it's written as **2 hex characters** (like MIPS), and counted as costing 2 bytes
  toward `FRAG_MAX`.
- Otherwise, it's written as a **single literal UTF-16 character**
  (`String.fromCharCode(char_code)`), carrying a full 16 bits of payload in one character, and
  counted toward `FRAG_MAX` by its *estimated UTF-8 encoded size* (1-4 bytes depending on code
  point range) - because `FRAG_MAX` is meant to approximate the transmitted byte budget, not raw
  JS string length.

`NET.deserialize` reverses this per character: a code point `<= 0xFF` is actually two hex digits
representing one byte pair; anything higher is a literal double-byte value.

This is why the test suite exercises strings full of high code points, emoji, and random bytes
(see the fragmentation tests in `tests/ipc.test.ts`) - it's verifying both encodings round-trip
correctly and that every produced fragment actually respects `FRAG_MAX` once UTF-8-encoded.

### Reassembly

`NET.listen`'s internal listener buffers fragments by `header.meta.guid`:

```ts
const buffer: Map<string, { size: number; fragments: string[]; received: number }> = new Map();
```

- The first fragment of a new `guid` creates an entry (after an optional
  [`filter`](./ipc-api.md) check - see below).
- `header.final` on a fragment tells the receiver the total fragment count (`index + 1`).
- Once `received === size`, all fragments are concatenated in order, run through
  `NET.deserialize`, and handed to the deserializer/callback; the buffered entry is deleted.
- A duplicate fragment index for the same `guid` throws.

Fragment order isn't assumed to match arrival order in general - each fragment carries its own
`index` and is placed at `fragments[header.index]` - but a **given packet's fragments must all
arrive** (there's no retry/timeout for a stalled multi-fragment packet; a dropped fragment leaves
that `guid`'s entry buffered forever).

## Correlation

`meta.guid` doubles as the mechanism that makes [`IPC.invoke`](./ipc-api.md#ipcinvoke) resolve
the *correct* concurrent call's `Promise`:

1. `invoke` generates a fresh `guid` and sets `signature = "mcbe-ipc:v3+correlation"`.
2. It listens on `ipc:{channel}:handle` with a `filter` that accepts a response only if its
   signature *doesn't* mention `+correlation` (backward compatibility, see below) **or** its
   `guid` matches the one just generated.
3. [`IPC.handle`](./ipc-api.md#ipchandle) echoes the *same* `guid`/signature back on response
   only if the incoming request's signature contained `+correlation`; otherwise it responds with
   default (uncorrelated) metadata.

This is what lets `Promise.all([invoke(...), invoke(...), invoke(...)])` on the same channel
resolve each promise with its own matching result even if responses arrive in a different order
than the requests were sent (see the "invoke-correlation" test in `tests/ipc.test.ts`).

### Backward/forward compatibility

Because correlation is signaled through `signature` rather than assumed, mismatched
old/new versions of this library interoperate on a "best effort, last one wins" basis:

- **New `invoke` -> old (uncorrelated) responder**: the responder never echoes `+correlation`, so
  `invoke`'s filter (which explicitly allows non-correlated signatures through) accepts the
  response anyway.
- **Old (uncorrelated) requester -> new `handle`**: the request's signature lacks `+correlation`,
  so `handle` responds without correlation metadata, which the legacy caller (which never
  filtered by `guid` in the first place) accepts as-is.

Both are covered by the "backwards-compat" tests in `tests/ipc.test.ts`. The tradeoff: talking to
an uncorrelated peer means you lose the "resolve the right concurrent call" guarantee for that
exchange - safe as long as you aren't firing concurrent `invoke` calls against a legacy responder
on the same channel.

## Low-level escape hatch: `NET.emit` / `NET.listen`

If `IPC`'s five functions don't fit your use case, call `NET` directly with your own endpoint
naming scheme:

```ts
function* emit<S>(endpoint: string, serializer: PROTO.Serializer<S>, value: S, options?: { metaOverride?: Partial<Meta> }): Generator<void, void, void>;
function listen<D>(endpoint: string, deserializer: PROTO.Deserializer<D>, callback: (value: D, meta: Meta) => Generator<void, void, void>, options?: { filter?: (meta: Meta) => boolean }): () => void;
```

`emit` is a generator - drive it with `system.runJob(NET.emit(...))` as the library itself does
throughout `IPC`. `listen` registers immediately and returns an unsubscribe function, matching
every `IPC` subscribe function.

## References

- [MCBE-IPC Packet Standard (MIPS) RFC](https://gist.github.com/OmniacDev/ecd6f61ffd8d0ed6be1b7cf6ecea9145) -
  the formal wire-format specification this page summarizes an implementation of.

## Next

- [FAQ & Troubleshooting](./faq-troubleshooting.md)
