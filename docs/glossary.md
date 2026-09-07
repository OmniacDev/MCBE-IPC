# Glossary

Quick reference for terms used throughout these docs. Each links to where it's covered in depth.

**Buffer** ([`PROTO.Buffer`](./serialization.md#protobuffer))
A growable byte buffer wrapping `Uint8Array`/`DataView`, with a cursor-based `reserve`/`consume`
read-write interface. The type every `Serializable`'s `serialize`/`deserialize` reads from and
writes to.

**Channel**
A string name passed to `IPC.send`/`on`/`once`/`invoke`/`handle`, scoped separately from the raw
`NET` endpoint namespace. See [Channel namespacing](./architecture.md#channel-namespacing).

**Correlation / correlation `guid`**
The mechanism that lets [`IPC.invoke`](./ipc-api.md#ipcinvoke) match a response back to the
specific call that triggered it, so concurrent `invoke` calls on the same channel each resolve
correctly. See [Correlation](./wire-protocol.md#correlation).

**Endpoint**
The full internal string a `NET.emit`/`NET.listen` call is scoped to (e.g. `ipc:chat:send`).
`IPC` builds these for you from a plain channel name; see
[Channel namespacing](./architecture.md#channel-namespacing).

**Fragment / Fragmentation**
Splitting a packet's serialized payload across multiple `scriptevent` calls when it exceeds
`NET.FRAG_MAX` (default 2048 bytes). See [Fragmentation](./wire-protocol.md#fragmentation).

**Guard** (the `Guard extends boolean` type parameter on `Serializable<T, Guard>`)
Tracks, at the type level, whether a serializer's `is()` runtime type guard is guaranteed to
exist. See [The Guard type parameter](./serialization.md#the-guard-type-parameter).

**GUID**
An 8-hex-character random ID (`UTIL.generate_id()`) used both to group a packet's fragments
together and, for `invoke`/`handle`, as the [correlation](./wire-protocol.md#correlation) key.

**Header** (`NET.Header`)
The per-fragment metadata (`meta`, `index`, `final`) sent alongside a packet's payload, embedded
in the `scriptevent` `id` field via [MIPS encoding](./wire-protocol.md#mips-encoding). See
[Endpoints and the packet header](./wire-protocol.md#endpoints-and-the-packet-header).

**MIPS**
Short for the **MCBE-IPC Packet Standard**, the RFC defining this library's wire format
([full spec](https://gist.github.com/OmniacDev/ecd6f61ffd8d0ed6be1b7cf6ecea9145)). In code,
`PROTO.MIPS` specifically refers to the hex-string encoding used for the `scriptevent` `id`
field. See [MIPS encoding](./wire-protocol.md#mips-encoding).

**Serializable\<T, Guard\>**
The core interface every serializer implements: `serialize`, `deserialize`, and an optional
`is()` type guard. See [The Serializable model](./serialization.md#the-serializablet-guard-model).

**Signature** (`meta.signature`)
A string tag on a packet's metadata, currently `"mcbe-ipc:v3"`, optionally suffixed
`+correlation`. Used to signal correlation-awareness for backward/forward compatibility. See
[Correlation](./wire-protocol.md#correlation).

**`scriptevent`**
Minecraft Bedrock's native cross-pack messaging primitive (`system.sendScriptEvent` /
`system.afterEvents.scriptEventReceive`) - the only transport MCBE-IPC has to work with. See
[Architecture](./architecture.md).

## Next

- [Architecture](./architecture.md)
- [Wire Protocol](./wire-protocol.md)
