# Advanced Serializers

These builders solve specific problems - polymorphic values, recursive/self-referential types,
adapting an existing serializer to a different type, runtime validation, and repeated-value
compression - that come up once you go beyond flat data shapes. All live in
[`PROTO`](./serialization.md); read that page first if you haven't.

## `Union`

```ts
function Union<T extends readonly any[]>(
  ...variants: { [K in keyof T]: PROTO.Serializable<T[K], true> }
): PROTO.Serializable<T[number], true>;
```

Encodes a value as one of several possible types ("tagged union" / "sum type"). On the wire: a
`UVarInt32` variant index, followed by that variant's own encoding.

```ts
const IntOrString = PROTO.Union(PROTO.VarInt32, PROTO.String); // PROTO.Serializable<number | string, true>
```

- **Every variant must be guarded** (`Serializable<_, true>`) - `Union` uses each variant's
  `is()` to decide, at serialize time, which one a given value matches
  (`variants.findIndex(v => v.is(value))`). This is also why `Union`'s output is always
  `Guard = true`: its own `is()` is just "does any variant match".
- **Variant order matters when types overlap.** The first variant whose `is()` returns `true`
  wins. For example, `PROTO.Union(PROTO.UVarInt32, PROTO.VarInt32)` will always pick
  `UVarInt32` for non-negative integers, even though `VarInt32` could also represent them -
  because `UVarInt32.is()` is checked first. Order variants from most-specific/most-common to
  least, the same way you'd order `switch`/`instanceof` branches. When variants are
  [`PROTO.Object`](./serialization.md#object) shapes that can overlap on their own keys, tag each
  one with a [`PROTO.Literal`](./serialization.md#literal) discriminant field instead of relying
  on ordering.
- **Throws** if you try to serialize a value matching no variant, or deserialize a variant index
  outside the registered range - treat both as programmer errors (a mismatched serializer between
  sender/receiver, or a value that was never validated with `is()`/`PROTO.Checked` before being
  sent).

## `Any`

```ts
const Any: PROTO.Serializable<Any, true>;
type Any = boolean | number | string | null | undefined | Array<Any> | Set<Any> | Map<Any, Any>;
```

A ready-made serializer for loosely-typed, JSON-like data, when you don't want to (or can't)
define an exact schema up front. It's built as a [`Recursive`](#lazy--recursive) `Union` over:

```
Boolean, UVarInt32, VarInt32, Float32, Float64, String, Null, Undefined, Array(self), Set(self), Map(self, self)
```

Two design choices are worth knowing about this ordering:

- **Numbers try compact encodings first**: unsigned-varint, then signed-varint, then `Float32`,
  then `Float64` as the catch-all - so a value like `5` costs 1 byte instead of 8.
- **`undefined` is its own variant**, not handled via `PROTO.Optional` wrapping the whole union.
  Wrapping would mean `Optional<Union<...>>`, effectively `Union<Union<...> | undefined>` - an
  extra presence-flag byte on *every* value just to support the `undefined` case once.

Use `PROTO.Any` for prototyping, debug/logging channels, or genuinely dynamic payloads - prefer
an explicit `PROTO.Object`/`PROTO.Union` schema wherever the shape is known, since `Any` pays a
tag byte per value and per container element.

```ts
IPC.send('debug-dump', PROTO.Any, { anything: 'goes', nested: [1, 2, new Map([['a', 1]])] });
```

Note that plain JS objects (`{ ... }`) are **not** part of `PROTO.Any` - only the listed
primitive/container types are. Use `Map` in place of object literals if you need `Any` inside a
keyed structure, or [`PROTO.Record`](./serialization.md#record) if the keys are always strings.

## `Lazy` / `Recursive`

```ts
function Lazy<T, Guard extends boolean>(init: () => PROTO.Serializable<T, Guard>): PROTO.Serializable<T, Guard>;
function Recursive<T, Guard extends boolean>(
  init: (self: PROTO.Serializable<T, Guard>) => PROTO.Serializable<T, Guard>
): PROTO.Serializable<T, Guard>;
```

`Lazy` defers calling `init()` until the serializer is first used (its `is`/`serialize`/
`deserialize` are getters that call and memoize `init()` on first access). This breaks
initialization-order problems: `init` can reference a `const` that isn't assigned yet at the time
`Lazy(...)` itself runs, as long as it *is* assigned by the time the returned serializer is
actually used.

`Recursive` builds on `Lazy` to let a serializer **reference itself**, for tree-shaped or
otherwise self-referential data:

```ts
function Recursive(init) {
  let target;
  target = init(PROTO.Lazy(() => target));
  return target;
}
```

`init` receives `self` - a `Lazy` reference to the *eventual* return value of `init` itself - and
must incorporate it wherever the type recurses. This is exactly how [`PROTO.Any`](#any) is
defined:

```ts
const Any = PROTO.Recursive(self =>
  PROTO.Union(
    PROTO.Boolean, PROTO.UVarInt32, PROTO.VarInt32, PROTO.Float32, PROTO.Float64,
    PROTO.String, PROTO.Null, PROTO.Undefined,
    PROTO.Array(self), PROTO.Set(self), PROTO.Map(self, self)
  )
);
```

A JSON-tree example of your own:

```ts
type Node = { label: string; children: Node[] };
const Node: PROTO.Serializable<Node, true> = PROTO.Recursive<Node, true>(self =>
  PROTO.Object({ label: PROTO.String, children: PROTO.Array(self) })
);
```

`Lazy` also memoizes: `init` runs at most once no matter how many times the serializer is used.

## `Transform`

```ts
function Transform<A, B>(
  base: PROTO.Serializable<A>,
  to: (value: B) => A,
  from: (value: A) => B,
  is?: (value: unknown) => value is B
): PROTO.Serializable<B>;
```

Adapts an existing serializer for `A` into one for a different type `B`, by mapping values through
`to`/`from` on the way in and out. Useful for serializing a class instance (or any type you don't
want to hand-write a serializer for) through a plain-data serializer you already have:

```ts
class Vector2 {
  constructor(public x: number, public y: number) {}
}

const Vector2Proto = PROTO.Transform(
  PROTO.Object({ x: PROTO.Float64, y: PROTO.Float64 }),
  (v: Vector2) => ({ x: v.x, y: v.y }), // to: B -> A, runs before base.serialize
  o => new Vector2(o.x, o.y), // from: A -> B, runs after base.deserialize
  (v): v is Vector2 => v instanceof Vector2 // optional guard for B
);
```

On the wire, `Vector2Proto` is indistinguishable from `PROTO.Object({ x, y })` - `Transform` only
changes what value comes out of `deserialize()` and what value `serialize()` accepts, not the byte
layout.

- `is` is optional and, unlike other builders, isn't derived from `base`'s guardedness - it's
  whatever you pass (or don't). Omit it and the result is `Serializable<B, false>`, with `is`
  simply `undefined`; supply it and the result is `Serializable<B, true>`.
- A numeric example without a guard - adapting `UVarInt32` to store an already-halved value:

  ```ts
  const Doubled = PROTO.Transform(PROTO.UVarInt32, (n: number) => n / 2, n => n * 2);
  ```

## `Cached`

```ts
function Cached<V>(s: PROTO.Serializable<V, true>, depth?: number): PROTO.Serializable<V, true>;
```

Wraps a serializer with an LRU cache of **already-serialized byte output**, keyed by value
identity (`Map` reference equality - so this helps for repeated primitive values like strings, or
the exact same object reused across messages, not "deep-equal" objects). `depth` (default `16`)
is the maximum number of distinct values kept.

```ts
const CachedName = PROTO.Cached(PROTO.String, 32);
```

- **On a cache hit**, the previously-computed bytes are written directly to the stream - the
  wrapped serializer's `serialize` is not called again - and the entry is bumped to
  most-recently-used.
- **On a miss**, the value is serialized into a scratch buffer, the resulting bytes are cached
  and written, and the oldest entry is evicted if the cache is now over `depth`.
- **Deserialization is unaffected** - it just delegates to the wrapped serializer. `Cached` only
  saves CPU time on the *serialize* side (skipping redundant encode work for repeated values); it
  does not change what's on the wire or add any framing.
- Good fit for values that repeat often across many messages and are moderately expensive to
  serialize (e.g. a large shared config object, a frequently-broadcast display name) - not useful
  for one-off or highly variable values, where the cache will only ever miss.

## `Checked`

```ts
function Checked<T>(s: PROTO.Serializable<T, true>): PROTO.Serializable<T, true>;
```

Wraps a guarded serializer with a runtime validation gate:

- **On serialize**, throws before writing anything if `s.is(value)` is `false`.
- **On deserialize**, throws after reading if `s.is(result)` is `false` - i.e. it also catches a
  *misbehaving* serializer that produces a value inconsistent with its own `is()`.

```ts
const SafePort = PROTO.Checked(PROTO.UInt16); // throws if you ever try to send e.g. -1 or 70000
```

Use `Checked` at trust boundaries - anywhere a value's validity isn't already guaranteed by
TypeScript's types (e.g. values coming from user input, disk, or another pack you don't fully
trust). The library uses it internally for exactly this reason: `NET`'s `Endpoint`, `Meta`, and
`Header` types are all wrapped in `Checked`, since that data is parsed from a raw `scriptevent`
that, in principle, any pack in the world could have sent.

`Checked` adds no extra bytes on the wire - it's a pure runtime guard around an existing
serializer.

## Next

- [Wire Protocol](./wire-protocol.md) - see `Checked`/`Union`/varints used for real in the packet header
- [FAQ & Troubleshooting](./faq-troubleshooting.md)
