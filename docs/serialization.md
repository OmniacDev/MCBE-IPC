# Serialization (`PROTO`)

`PROTO` is the namespace that describes *how a value turns into bytes and back*. Every serializer
in this library - built-in or custom - implements the same small interface, which is what lets
them compose: a `PROTO.Object` can be built out of `PROTO.String` and `PROTO.Float64`, a
`PROTO.Array` can hold `PROTO.Object`s, and so on. It's all defined in
[`src/ipc.ts`](../src/ipc.ts).

## The `Serializable<T, Guard>` model

```ts
interface Serializer<T> {
  serialize(value: T, stream: Buffer): Generator<void, void, void>;
}

interface Deserializer<T> {
  deserialize(stream: Buffer): Generator<void, T, void>;
}

type Serializable<T, Guard extends boolean = false> = Serializer<T> & Deserializer<T> & Guarded<T, Guard>;
```

Every built-in serializer (`PROTO.String`, `PROTO.Float64`, `PROTO.Object(...)`, etc.) is a plain
object with up to three members:

| Member | Purpose |
|---|---|
| `serialize(value, stream)` | Writes `value` into a [`PROTO.Buffer`](#protobuffer) |
| `deserialize(stream)` | Reads a value back out of a `PROTO.Buffer` |
| `is(value)` *(optional)* | A TypeScript type guard: runtime-checks whether `value` is a valid `T` |

`IPC.send`/`IPC.on` only need `serialize`/`deserialize` (typed as `Serializer<S>`/
`Deserializer<D>`), so **any object implementing just those two functions works as a
serializer** - you don't have to use `PROTO`'s builders at all, though they cover the vast
majority of cases and add the optional `is()` guard for free.

### Why `serialize`/`deserialize` are generators

Both methods return `Generator<void, ..., void>` rather than doing their work eagerly. Minecraft's
script engine watches how long a script keeps running synchronously within a single tick, and
serializing something large (a big array, a deeply nested object, a long string) all at once can
run long enough to trip that watchdog. Making `serialize`/`deserialize` generators lets that work
be driven by Minecraft's `system.runJob`, which resumes a generator a step at a time, spread
across ticks, instead of blocking the game thread in one shot. Every call site in this library
that drives one (`NET.emit`, `NET.listen`'s internal scriptevent handler) wraps it in
`system.runJob(...)`. When composing serializers (e.g. inside `PROTO.Object`), always `yield*`
into child serializers to propagate this cooperative-yielding behavior rather than draining the
generator eagerly.

### The `Guard` type parameter

`Guard extends boolean` tracks, **at the type level**, whether `is()` is guaranteed to exist:

```ts
type Guarded<T, Guard extends boolean> = Guard extends true
  ? { is(value: unknown): value is T }
  : { is?(value: unknown): value is T };
```

Every built-in primitive serializer is `Serializable<T, true>` - `is` is always present. Builder
functions like `PROTO.Object`/`PROTO.Array`/`PROTO.Union` propagate this: if every input
serializer is guarded (`Guard = true`), the result is too; if any input serializer is unguarded,
the result's `Guard` degrades to `false` at the type level (the runtime `is` will simply be
`undefined` in that case). This is why most builder functions in this library have three
overloads - a "fully guarded in -> guarded out" overload, a "plain in -> unguarded out" overload,
and a generic fallback for explicit control - you don't need to think about this unless you're
writing your own generic serializer builder.

To safely call a possibly-absent `is()`, use the internal `Guarded.is` helper, which returns
`false` if `is` is missing - this is what every composite builder uses internally to validate
nested values.

`is()` matters for two things:
1. **`PROTO.Union`** needs it to pick which variant a value belongs to at serialize time.
2. **`PROTO.Checked`** needs it to validate values at runtime before/after (de)serializing.

See [Advanced Serializers](./advanced-serializers.md) for both.

## `PROTO.Buffer`

A small growable byte buffer used as the read/write "stream" every serializer operates on.

```ts
const buffer = new PROTO.Buffer(); // default initial capacity: 256 bytes
```

| Member | Description |
|---|---|
| `write(byte: number)` / `write(bytes: Uint8Array)` | Append data, growing capacity as needed |
| `read()` / `read(amount: number)` | Consume and return a byte or a `Uint8Array` slice |
| `reserve(amount)` | Grow the writable region by `amount` bytes, returning the offset to write at |
| `consume(amount)` | Advance the readable region by `amount` bytes, returning the offset to read from; throws if not enough bytes remain |
| `data_view` | The underlying `DataView`, for numeric reads/writes (`setInt8`, `getFloat64`, etc.) |
| `front` / `end` | Current readable-region bounds |
| `Buffer.from_uint8array(array)` | Wrap an existing `Uint8Array` as a readable buffer |
| `to_uint8array()` | View the current readable region as a `Uint8Array` |

`Buffer` is a sliding window: `read`/`consume` advance an internal offset rather than copying
already-read data away, and `ensure_capacity` compacts + doubles the backing array only when
writing would otherwise overflow it. You will rarely touch `Buffer` directly - it's mostly
relevant when writing a custom serializer from scratch.

## Primitive serializers

All of the following are `PROTO.Serializable<T, true>` - always guarded.

| Serializer | TS type | Wire size | Notes |
|---|---|---|---|
| `PROTO.Void` | `void` | 0 bytes | Accepts only `undefined`; useful for signal-only channels |
| `PROTO.Null` | `null` | 0 bytes | |
| `PROTO.Undefined` | `undefined` | 0 bytes | |
| `PROTO.Boolean` | `boolean` | 1 byte | |
| `PROTO.Int8` / `PROTO.UInt8` | `number` | 1 byte | Range-checked in `is()` |
| `PROTO.Int16` / `PROTO.UInt16` | `number` | 2 bytes | Range-checked in `is()` |
| `PROTO.Int32` / `PROTO.UInt32` | `number` | 4 bytes | Range-checked in `is()` |
| `PROTO.Float32` | `number` | 4 bytes | `is()` requires `Math.fround(value) === value` (no precision loss) |
| `PROTO.Float64` | `number` | 8 bytes | Accepts any JS `number`, including non-integers |
| `PROTO.UVarInt32` | `number` | 1-5 bytes | Variable-length unsigned integer, `0` to `4294967295` |
| `PROTO.VarInt32` | `number` | 1-5 bytes | Variable-length signed integer (zigzag-encoded over `UVarInt32`), `-2147483648` to `2147483647` |
| `PROTO.String` | `string` | 1-5 bytes (length) + up to 5 bytes per char | UTF-16 code units, each individually `UVarInt32`-encoded - see note below |
| `PROTO.UInt8Array` | `Uint8Array` | 1-5 bytes (length) + N bytes | Raw byte copy, length-prefixed |
| `PROTO.Date` | `Date` | 8 bytes | Encoded as `Float64` epoch milliseconds |

### Variable-length integers

`UVarInt32`/`VarInt32` use a standard LEB128-style encoding: 7 payload bits per byte, with the
top bit set on every byte except the last. `VarInt32` additionally zigzag-encodes the sign so
small negative numbers stay compact (`(value << 1) ^ (value >> 31)`). Small non-negative numbers -
array/string lengths, enum tags, variant indices - cost a single byte; this is why `UVarInt32` is
used pervasively as the "length"/"index"/"tag" type throughout the rest of the library
(`PROTO.Array`, `PROTO.Map`, `PROTO.Set`, `PROTO.Record`, `PROTO.String`, `PROTO.Union`, and the
`NET` packet header all use it).

### `PROTO.String` encoding

Rather than encoding to UTF-8 bytes, `PROTO.String` writes each UTF-16 code unit as its own
`UVarInt32`. This is deliberately simple rather than maximally compact - it round-trips any JS
string (including unpaired surrogates) without a separate encoding step, at the cost of extra
bytes for non-ASCII text. If you need denser text encoding for large payloads, consider
`PROTO.UInt8Array` with your own UTF-8 encoding via `TextEncoder`/`TextDecoder`.

## Composite builders

These are functions that take one or more child serializers (or, for `Literal`, a constant value)
and return a new serializer.

### `Object`

```ts
function Object<T extends object>(shape: { [K in keyof T]: PROTO.Serializable<T[K], true> }): PROTO.Serializable<T, true>;
```

Serializes a plain object field-by-field, in the key order of `shape`. No field-count or
field-name markers are written - the shape itself, known to both sides, is the schema.

```ts
const Vec3 = PROTO.Object({ x: PROTO.Float64, y: PROTO.Float64, z: PROTO.Float64 });
// PROTO.Serializable<{ x: number; y: number; z: number }, true>
```

TypeScript infers the resulting value type from `shape` automatically. You can still pin an
explicit type if you prefer:

```ts
interface Vec3 { x: number; y: number; z: number }
const Vec3: PROTO.Serializable<Vec3, true> = PROTO.Object<Vec3>({ x: PROTO.Float64, y: PROTO.Float64, z: PROTO.Float64 });
```

`is()` checks that the value is a non-array object where every key in `shape` is present and
individually passes its own serializer's `is()`. Extra keys not in `shape` are ignored by `is()`
and simply not transmitted - see [`Literal`](#literal) below for how to guard against a value that
has all the right keys but is semantically the wrong variant of a union.

### `Array`

```ts
function Array<T>(itemSerializer: PROTO.Serializable<T, true>): PROTO.Serializable<T[], true>;
```

Length-prefixed homogeneous array:

```ts
const Names = PROTO.Array(PROTO.String); // PROTO.Serializable<string[], true>
```

### `Tuple`

```ts
function Tuple<T extends any[]>(...s: { [K in keyof T]: PROTO.Serializable<T[K], true> }): PROTO.Serializable<T, true>;
```

Fixed-length, heterogeneous, positional - like `Object` but by index instead of key. No length is
written on the wire (the length is fixed and known to both sides); `is()` does check
`value.length === s.length`.

```ts
const Pair = PROTO.Tuple(PROTO.String, PROTO.UVarInt32); // PROTO.Serializable<[string, number], true>
```

### `Optional`

```ts
function Optional<T>(s: PROTO.Serializable<T, true>): PROTO.Serializable<T | undefined, true>;
```

Writes a 1-byte presence flag, then the value only if present:

```ts
const MaybeName = PROTO.Optional(PROTO.String); // PROTO.Serializable<string | undefined, true>
```

### `Map` / `Set`

```ts
function Map<K, V>(keySerializer: PROTO.Serializable<K, true>, valueSerializer: PROTO.Serializable<V, true>): PROTO.Serializable<Map<K, V>, true>;
function Set<V>(valueSerializer: PROTO.Serializable<V, true>): PROTO.Serializable<Set<V>, true>;
```

Length-prefixed key/value or value sequences over JS `Map`/`Set`. `is()` validates every entry,
not just the container type.

```ts
const Scores = PROTO.Map(PROTO.String, PROTO.UVarInt32); // PROTO.Serializable<Map<string, number>, true>
```

### `Record`

```ts
function Record<V>(valueSerializer: PROTO.Serializable<V, true>): PROTO.Serializable<Record<string, V>, true>;
```

Like `Map`, but over a plain string-keyed JS object instead of a `Map` instance - reach for
`Record` when your data is naturally a `{ [key: string]: V }` dictionary (e.g. JSON-shaped data)
rather than a `Map`:

```ts
const Scores = PROTO.Record(PROTO.UVarInt32); // PROTO.Serializable<Record<string, number>, true>

IPC.send('scores', Scores, { alice: 10, bob: 20 });
```

On the wire it's the same shape as `Map` (a `UVarInt32` entry count, then `String` key +
`V`-serialized value pairs) - `is()` rejects arrays and validates every value against
`valueSerializer`. Object keys are always strings in JS regardless of how they were written (so
`{ 1: 'a' }` round-trips fine; the key becomes the string `"1"`).

### `Literal`

```ts
function Literal<T extends string | number | boolean>(value: T): PROTO.Serializable<T, true>;
```

Serializes a single known constant - always the same `value`, written as **zero bytes**, since
both sides already agree on what it is:

```ts
const Foo = PROTO.Literal('foo'); // PROTO.Serializable<'foo', true>
```

`is()` checks strict equality (`v === value`), not just the type - `PROTO.Literal(5).is('5')` is
`false`. The main use case is tagging otherwise-overlapping [`PROTO.Object`](#object) variants so
[`PROTO.Union`](./advanced-serializers.md#union) can tell them apart:

```ts
const Click = PROTO.Object({ type: PROTO.Literal('click' as const), x: PROTO.Float64, y: PROTO.Float64 });
const Move = PROTO.Object({
  type: PROTO.Literal('move' as const),
  x: PROTO.Float64,
  y: PROTO.Float64,
  z: PROTO.Float64
});
const Event = PROTO.Union(Click, Move);
```

Without the `type` tag, `Click.is(moveEvent)` would be `true` too - `Object`'s `is()` only checks
that its own keys are present and valid, not that no *other* fields exist - so `Union` could pick
`Click` first for a `Move` value and silently drop `z`. A `Literal`-tagged discriminant field
makes each variant's `is()` reject every other variant's values.

## Writing your own serializer

Because `Serializable<T>` is just a plain interface, you can hand-write one for any type the
built-ins don't cover - a class instance, a branded type, a domain-specific encoding:

```ts
const RGB: PROTO.Serializable<{ r: number; g: number; b: number }, true> = {
  is: (v): v is { r: number; g: number; b: number } =>
    typeof v === 'object' && v !== null && 'r' in v && 'g' in v && 'b' in v,
  *serialize(value, stream) {
    stream.write(value.r);
    stream.write(value.g);
    stream.write(value.b);
  },
  *deserialize(stream) {
    return { r: stream.read(), g: stream.read(), b: stream.read() };
  }
};
```

Or simply compose the builders above - `PROTO.Object({ r: PROTO.UInt8, g: PROTO.UInt8, b: PROTO.UInt8 })`
would produce the same result with less code. If you'd rather adapt an *existing* serializer to a
different type (e.g. a class instance) than write one from scratch, see
[`PROTO.Transform`](./advanced-serializers.md#transform).

## Next

- [Advanced Serializers](./advanced-serializers.md) - `Union`, `Any`, `Transform`, `Cached`, `Lazy`/`Recursive`, `Checked`
- [Wire Protocol](./wire-protocol.md) - how `PROTO.Buffer` bytes actually cross the `scriptevent` boundary
