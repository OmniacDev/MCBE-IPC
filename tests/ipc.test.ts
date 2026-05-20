import { describe, it, expect, vi, beforeEach } from 'vitest';
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
