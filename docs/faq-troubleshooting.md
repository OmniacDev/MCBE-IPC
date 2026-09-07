# FAQ & Troubleshooting

## My listener never fires

- **Channel name mismatch.** `IPC.send('chat', ...)` only reaches `IPC.on('chat', ...)` -
  channel strings must match exactly, including case. Remember `send`/`on`/`once` share one
  namespace (`ipc:{channel}:send`) while `invoke`/`handle` share another
  (`ipc:{channel}:invoke` / `ipc:{channel}:handle`) - see
  [Architecture -> Channel namespacing](./architecture.md#channel-namespacing).
- **The listening pack hasn't loaded/imported the module yet.** Each pack runs its own script
  instance; importing `mcbe-ipc` is what registers its `scriptEventReceive` subscription. Make
  sure `IPC.on`/`IPC.handle` has actually run *before* the other pack calls
  `IPC.send`/`IPC.invoke` - there's no message buffering or replay for listeners that subscribe
  late.
- **Serializer/deserializer mismatch.** If the sender's serializer and receiver's deserializer
  don't describe the same byte layout, deserialization will silently produce garbage or throw
  partway through (which is caught per-listener and logged to console, not re-thrown). Check the
  console for `[MCBE-IPC] listener error while handling packet on "...":` messages.

## `IPC.invoke` never resolves

There is **no built-in timeout**. If nothing ever responds - no `IPC.handle` was registered for
that channel, the responder pack isn't loaded, or the response was dropped - the returned
`Promise` simply stays pending forever. Guard it yourself if needed:

```ts
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => system.runTimeout(() => reject(new Error('IPC timeout')), ms))
  ]);
}
```

Also double check you're not running **two concurrent `invoke` calls against a legacy,
uncorrelated responder** on the same channel. In that specific scenario, response matching
degrades to "first response wins" rather than resolving the right call - see
[Wire Protocol -> Backward/forward compatibility](./wire-protocol.md#backwardforward-compatibility).

## A large payload fails, gets corrupted, or arrives partially

A packet only completes once *every* one of its fragments has arrived; there's no retry or
timeout for a stuck multi-fragment packet. If you suspect fragmentation issues:

- Check `NET.FRAG_MAX` (default `2048`) against your platform's real `scriptevent` message length
  limit - if it's set higher than what your Minecraft version actually allows, individual
  fragments themselves may be rejected/truncated before `NET` ever sees them.
- Remember `FRAG_MAX` budgets *estimated UTF-8 byte size*, not raw JS string length - see
  [Wire Protocol -> Message packing](./wire-protocol.md#message-packing-denser-than-mips) - so
  don't assume `message.length <= FRAG_MAX` is the invariant being enforced.
- A "received duplicate fragment" error means two fragments arrived claiming the same `index` for
  the same packet `guid` - this generally indicates a duplicate/retransmitted `scriptevent` from
  elsewhere in the world, not a bug in ordering.

## `PROTO.Union`/`PROTO.Any` picked the "wrong" variant

`Union` always uses the **first** variant whose `is()` matches - see
[Advanced Serializers -> Union](./advanced-serializers.md#union). If your variants' `is()` checks
overlap (e.g. two numeric ranges), reorder them from most-specific to least, the same way you'd
order `if`/`instanceof` branches.

## Getting a "not enough bytes" error from `Buffer.consume`

This means a deserializer tried to read more bytes than remain in the buffer - almost always a
symptom of a serializer/deserializer mismatch between sender and receiver (different shape,
different field order, or different library version with an incompatible wire format). Confirm
both sides use the exact same serializer definition for a given channel.

## Where to ask further

- [GitHub Issues](https://github.com/OmniacDev/MCBE-IPC/issues)
- The [test suite](../tests/ipc.test.ts) doubles as a large set of runnable, verified usage
  examples for nearly every feature described in these docs.
