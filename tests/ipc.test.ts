import { beforeEach, describe, expect, it, vi } from 'vitest';
import IPC, { NET, PROTO } from '../src/ipc';
import { system } from '@minecraft/server';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ipc', () => {
  it('should receive the same value', async () => {
    const value = 'Hello World!';

    const recv = await new Promise<string>(resolve => {
      IPC.on('ipc:test', PROTO.String, str => {
        resolve(str);
      });

      IPC.send('ipc:test', PROTO.String, value);
    });

    expect(recv).toEqual(value);
  });

  it('invoke', async () => {
    const value = 'Hello World!';

    IPC.handle('test', PROTO.String, PROTO.String, v => v);

    const recv = await IPC.invoke('test', PROTO.String, value, PROTO.String);

    expect(recv).toEqual(value);
  });

  it('invoke-correlation', async () => {
    const Multiply = PROTO.Object({
      a: PROTO.Float64,
      b: PROTO.Float64
    });

    IPC.handle('multiply', Multiply, PROTO.Float64, args => {
      return args.a * args.b;
    });

    const [first, second, third] = await Promise.all([
      IPC.invoke('multiply', Multiply, { a: 2, b: 3 }, PROTO.Float64),
      IPC.invoke('multiply', Multiply, { a: 5, b: 4 }, PROTO.Float64),
      IPC.invoke('multiply', Multiply, { a: 12, b: 7 }, PROTO.Float64)
    ]);

    expect(first).toEqual(2 * 3);
    expect(second).toEqual(5 * 4);
    expect(third).toEqual(12 * 7);
  });
});

describe('backwards-compat', () => {
  it('old invoke -> new handle', async () => {
    const value = 'Hello World!';
    const channel = 'test';

    IPC.handle(channel, PROTO.String, PROTO.String, v => v);

    const recv = await new Promise(resolve => {
      const terminate = NET.listen(`ipc:${channel}:handle`, PROTO.String, function* (value) {
        resolve(value);
        terminate();
      });
      system.runJob(NET.emit(`ipc:${channel}:invoke`, PROTO.String, value));
    });

    expect(recv).toEqual(value);
  });

  it('new invoke -> old handle', async () => {
    const value = 'Hello World!';
    const channel = 'test';
    const listener = (v: string) => v;

    NET.listen(`ipc:${channel}:invoke`, PROTO.String, function* (value) {
      const result = listener(value);
      yield* NET.emit(`ipc:${channel}:handle`, PROTO.String, result);
    });

    const recv = await IPC.invoke(channel, PROTO.String, value, PROTO.String);

    expect(recv).toEqual(value);
  });
});

describe('cached', () => {
  it('use hits instead of re-serializing', () => {
    const spy = vi.spyOn(PROTO.String, 'serialize');

    const cached = PROTO.Cached(PROTO.String, 4);

    const stream1 = new PROTO.Buffer();
    system.runJob(cached.serialize('A', stream1)); // miss

    const stream2 = new PROTO.Buffer();
    system.runJob(cached.serialize('A', stream2)); // hit

    for (let i = 0; i < 10; i++) {
      const stream3 = new PROTO.Buffer();
      system.runJob(cached.serialize('A', stream3)); // hit
    }

    expect(spy).toHaveBeenCalledTimes(1); // missed once

    expect(stream1.to_uint8array()).toEqual(stream2.to_uint8array());
  });

  it('evict on max depth', () => {
    const spy = vi.spyOn(PROTO.String, 'serialize');
    const cached = PROTO.Cached(PROTO.String, 2);

    const s = new PROTO.Buffer();

    system.runJob(cached.serialize('A', s)); // miss, cache becomes [A]
    system.runJob(cached.serialize('B', s)); // miss, cache becomes [A, B]

    system.runJob(cached.serialize('A', s)); // hit, cache becomes [B, A]

    system.runJob(cached.serialize('C', s)); // miss, cache becomes [A, C]
    system.runJob(cached.serialize('B', s)); // miss, cache becomes [C, B]

    expect(spy).toHaveBeenCalledTimes(4); // missed 4 times
  });
});

describe('proto', () => {
  it('varint32 min', () => {
    const stream = new PROTO.Buffer();

    const int = -(2 ** 31);
    system.runJob(PROTO.VarInt32.serialize(int, stream));

    let deInt;
    system.runJob(
      (function* () {
        deInt = yield* PROTO.VarInt32.deserialize(stream);
      })()
    );

    expect(deInt).toEqual(int);
  });
});

describe('net', () => {
  it('should ignore non-ipc scriptevent', () => {
    const spy = vi.spyOn(PROTO.MIPS, 'deserialize');

    NET.listen('', PROTO.Void, function* () {});

    system.sendScriptEvent('not_valid', '');

    expect(spy).toHaveBeenCalledTimes(0);

    system.sendScriptEvent('(0x00):not_valid', '');

    expect(spy).toHaveBeenCalledTimes(1);

    system.sendScriptEvent('(0x00):(0x00000000)', '');

    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('should fragment less than or equal 2048 bytes', () => {
    const cases = [
      'A'.repeat(50000),
      '😀'.repeat(2000),
      ('A'.repeat(1000) + '😀').repeat(200),
      '𐐷'.repeat(2000),
      Array.from({ length: 50000 }, () => String.fromCharCode(Math.random() * 0xffff)).join(''),
      'A'.repeat(50000),
      '\u0100'.repeat(20000),
      '\u4000'.repeat(20000),
      String.fromCharCode(0x200000).repeat(20000),
      String.fromCharCode(0x40000000).repeat(20000),
      '𐐷'.repeat(20000),
      ['\u007F', '\u0080', '\u4000', String.fromCharCode(0x200000), String.fromCharCode(0x40000000)]
        .join('')
        .repeat(5000),
      Array.from({ length: 50000 }, () => String.fromCharCode(Math.floor(Math.random() * 0xffffffff))).join('')
    ];

    system.runJob(
      (function* () {
        for (const str of cases) {
          const buf = new PROTO.Buffer();
          yield* PROTO.String.serialize(str, buf);

          const serialized = yield* NET.serialize(buf, NET.FRAG_MAX);
          for (const str of serialized) {
            expect(str.length).toBeLessThanOrEqual(NET.FRAG_MAX);

            const utf8 = new TextEncoder().encode(str);
            expect(utf8.length).toBeLessThanOrEqual(NET.FRAG_MAX);

            const buf = yield* NET.deserialize([str]);
            expect(buf.to_uint8array().length).toBeLessThanOrEqual(NET.FRAG_MAX);
          }
        }
      })()
    );
  });
});

describe('union', () => {
  it('round-trips each variant correctly', () => {
    const NumOrStrOrBool = PROTO.Union(PROTO.Float64, PROTO.String, PROTO.Boolean);

    for (const value of [42, -3.5, 'hello', true, false]) {
      const stream = new PROTO.Buffer();
      system.runJob(NumOrStrOrBool.serialize(value as number | string | boolean, stream));

      let result;
      system.runJob(
        (function* () {
          result = yield* NumOrStrOrBool.deserialize(stream);
        })()
      );

      expect(result).toEqual(value);
    }
  });

  it('is() matches values belonging to any variant and rejects others', () => {
    const NumOrStr = PROTO.Union(PROTO.Float64, PROTO.String);

    expect(NumOrStr.is(42)).toBe(true);
    expect(NumOrStr.is('hi')).toBe(true);
    expect(NumOrStr.is(true)).toBe(false);
    expect(NumOrStr.is({})).toBe(false);
    expect(NumOrStr.is(undefined)).toBe(false);
  });

  it('routes to the first matching variant when ranges overlap', () => {
    const spy = vi.spyOn(PROTO.VarInt32, 'serialize');
    const IntUnion = PROTO.Union(PROTO.UVarInt32, PROTO.VarInt32);

    const stream = new PROTO.Buffer();
    system.runJob(IntUnion.serialize(5, stream));

    expect(spy).not.toHaveBeenCalled();
  });

  it('throws when serializing a value that matches no variant', () => {
    const NumOrStr = PROTO.Union(PROTO.Float64, PROTO.String);
    const stream = new PROTO.Buffer();

    expect(() => system.runJob(NumOrStr.serialize({} as any, stream))).toThrow();
  });

  it('throws when deserializing an out-of-range variant index', () => {
    const NumOrStr = PROTO.Union(PROTO.Float64, PROTO.String);

    const stream = new PROTO.Buffer();
    system.runJob(PROTO.UVarInt32.serialize(99, stream));

    expect(() =>
      system.runJob(
        (function* () {
          yield* NumOrStr.deserialize(stream);
        })()
      )
    ).toThrow();
  });
});

describe('checked', () => {
  it('passes through valid values unchanged', () => {
    const checked = PROTO.Checked(PROTO.String);
    const stream = new PROTO.Buffer();

    system.runJob(checked.serialize('hello', stream));

    let result;
    system.runJob(
      (function* () {
        result = yield* checked.deserialize(stream);
      })()
    );

    expect(result).toEqual('hello');
  });

  it('throws on serialize when the input fails is()', () => {
    const checked = PROTO.Checked(PROTO.String);
    const stream = new PROTO.Buffer();

    expect(() => system.runJob(checked.serialize(42 as any, stream))).toThrow();
  });

  it('throws on deserialize when the output fails is()', () => {
    const misbehaving: PROTO.Serializable<string, true> = {
      is: (v): v is string => typeof v === 'string',
      *serialize(_value, stream) {
        yield* PROTO.Float64.serialize(0, stream);
      },
      *deserialize(stream) {
        yield* PROTO.Float64.deserialize(stream);
        return 42 as unknown as string;
      }
    };
    const checked = PROTO.Checked(misbehaving);
    const stream = new PROTO.Buffer();
    system.runJob(checked.serialize('irrelevant', stream));

    expect(() =>
      system.runJob(
        (function* () {
          yield* checked.deserialize(stream);
        })()
      )
    ).toThrow();
  });
});

describe('lazy / recursive', () => {
  it('only resolves the thunk once, even across multiple calls', () => {
    let calls = 0;
    const lazy = PROTO.Lazy(() => {
      calls++;
      return PROTO.String;
    });

    const s1 = new PROTO.Buffer();
    system.runJob(lazy.serialize('a', s1));
    const s2 = new PROTO.Buffer();
    system.runJob(lazy.serialize('b', s2));
    lazy.is('c');

    expect(calls).toBe(1);
  });

  it('a self-reference used directly as a Union variant works (no wrapping composite)', () => {
    type Loose = number | string;
    const value: Loose = 42;
    const Loose: PROTO.Serializable<Loose, true> = PROTO.Recursive<Loose, true>(_self =>
      PROTO.Union(PROTO.Float64, PROTO.String)
    );

    const stream = new PROTO.Buffer();
    system.runJob(Loose.serialize(value, stream));
    let result;
    system.runJob(
      (function* () {
        result = yield* Loose.deserialize(stream);
      })()
    );
    expect(result).toEqual(value);
  });

  it('recursive Array(self) / Map(self, self) now construct and round-trip correctly', () => {
    const value: PROTO.Any = [
      1,
      'two',
      true,
      null,
      undefined,
      new globalThis.Map<PROTO.Any, PROTO.Any>([
        ['nested', [1, 2, 3]],
        [4, new globalThis.Map<PROTO.Any, PROTO.Any>([['deep', true]])]
      ])
    ];

    const stream = new PROTO.Buffer();
    system.runJob(PROTO.Any.serialize(value, stream));

    let result: PROTO.Any;
    system.runJob(
      (function* () {
        result = yield* PROTO.Any.deserialize(stream);
      })()
    );

    expect(result!).toEqual(value);
  });
});

describe('PROTO.Any', () => {
  it('round-trips every primitive variant', () => {
    for (const value of [true, false, 42, -17, 3.14, 'hello', null, undefined]) {
      const stream = new PROTO.Buffer();
      system.runJob(PROTO.Any.serialize(value as PROTO.Any, stream));

      let result;
      system.runJob(
        (function* () {
          result = yield* PROTO.Any.deserialize(stream);
        })()
      );

      expect(result).toBe(value);
    }
  });

  it('is() accepts every valid variant and rejects unsupported types', () => {
    expect(PROTO.Any.is(42)).toBe(true);
    expect(PROTO.Any.is('str')).toBe(true);
    expect(PROTO.Any.is(null)).toBe(true);
    expect(PROTO.Any.is(undefined)).toBe(true);
    expect(PROTO.Any.is(Symbol('x'))).toBe(false);
  });
});

describe('Guard inference and backward compat', () => {
  it('Object() fully inferred tracks Guard and composes into Union', () => {
    const Meta = PROTO.Object({ guid: PROTO.String, signature: PROTO.String });
    const MetaOrString = PROTO.Union(Meta, PROTO.String);

    const value = { guid: 'a', signature: 'b' };
    const stream = new PROTO.Buffer();
    system.runJob(MetaOrString.serialize(value, stream));

    let result;
    system.runJob(
      (function* () {
        result = yield* MetaOrString.deserialize(stream);
      })()
    );

    expect(result).toEqual(value);
  });

  it('Tuple() fully inferred tracks Guard and composes into Union', () => {
    const Pair = PROTO.Tuple(PROTO.String, PROTO.UVarInt32);
    const PairOrBool = PROTO.Union(Pair, PROTO.Boolean);

    const value: [string, number] = ['a', 5];
    const stream = new PROTO.Buffer();
    system.runJob(PairOrBool.serialize(value, stream));

    let result;
    system.runJob(
      (function* () {
        result = yield* PairOrBool.deserialize(stream);
      })()
    );

    expect(result).toEqual(value);
  });

  it('explicit-T Object<T>({...}) still round-trips (old style)', () => {
    type Meta = { guid: string; signature: string };
    const Meta = PROTO.Object<Meta>({ guid: PROTO.String, signature: PROTO.String });

    const value: Meta = { guid: 'a', signature: 'b' };
    const stream = new PROTO.Buffer();
    system.runJob(Meta.serialize(value, stream));

    let result;
    system.runJob(
      (function* () {
        result = yield* Meta.deserialize(stream);
      })()
    );

    expect(result).toEqual(value);
  });

  it('explicit-T Tuple<T>(...) still round-trips (old style)', () => {
    const Pair = PROTO.Tuple<[string, number]>(PROTO.String, PROTO.UVarInt32);

    const value: [string, number] = ['x', 9];
    const stream = new PROTO.Buffer();
    system.runJob(Pair.serialize(value, stream));

    let result;
    system.runJob(
      (function* () {
        result = yield* Pair.deserialize(stream);
      })()
    );

    expect(result).toEqual(value);
  });
});
