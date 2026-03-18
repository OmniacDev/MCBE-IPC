import { bench, describe } from 'vitest';
import IPC, { NET, PROTO } from '../src/ipc';
import { system } from './mocks/@minecraft/server';

describe('ipc-benchmark', () => {
  bench('send', () => {
    IPC.send('ipc:test', PROTO.String, 'Hello World!');
  });

  let resolveFn: (value: string) => void = _ => {};
  IPC.on('ipc:test', PROTO.String, str => {
    resolveFn(str);
  });

  bench('send + receive', async () => {
    await new Promise<string>(resolve => {
      resolveFn = resolve;

      IPC.send('ipc:test', PROTO.String, 'Hello World!');
    });
  });

  IPC.handle('ipc:test', PROTO.String, PROTO.String, _ => {
    return 'Hello World!';
  });

  bench('invoke', async () => {
    await IPC.invoke('ipc:test', PROTO.String, 'Hello World!', PROTO.String);
  });
});

describe('mips-benchmark', async () => {
  const buffer = new PROTO.Buffer();
  system.runJob(PROTO.String.serialize('Hello World!', buffer));
  const bytes = buffer.to_uint8array();

  bench('serialize', () => {
    system.runJob(
      (function* () {
        const buffer = PROTO.Buffer.from_uint8array(bytes);

        yield* PROTO.MIPS.serialize(buffer);
      })()
    );
  });

  const serialized = await new Promise<string>(resolve => {
    system.runJob(
      (function* () {
        const buffer = new PROTO.Buffer();
        yield* PROTO.String.serialize('Hello World!', buffer);
        const serialized = yield* PROTO.MIPS.serialize(buffer);
        resolve(serialized);
      })()
    );
  });

  bench('deserialize', () => {
    system.runJob(
      (function* () {
        yield* PROTO.MIPS.deserialize(serialized);
      })()
    );
  });
});

describe('net-benchmark', async () => {
  const buffer = new PROTO.Buffer();
  system.runJob(PROTO.String.serialize('Hello World!', buffer));
  const bytes = buffer.to_uint8array();

  bench('serialize', () => {
    system.runJob(
      (function* () {
        const buffer = PROTO.Buffer.from_uint8array(bytes);
        yield* NET.serialize(buffer);
      })()
    );
  });

  const serialized = await new Promise<string[]>(resolve => {
    system.runJob(
      (function* () {
        const buffer = new PROTO.Buffer();
        yield* PROTO.String.serialize('Hello World!', buffer);
        const serialized = yield* NET.serialize(buffer);
        resolve(serialized);
      })()
    );
  });

  bench('deserialize', () => {
    system.runJob(
      (function* () {
        yield* NET.deserialize(serialized);
      })()
    );
  });
});

describe('cached-benchmark', () => {
  const base = PROTO.String;
  const cached = PROTO.Cached(base, 32);

  const largeString = 'A'.repeat(512);

  const stream = new PROTO.Buffer();
  stream.write = (_: any) => {
    return;
  };

  bench('uncached', () => {
    system.runJob(base.serialize(largeString, stream));
  });

  bench('cached', () => {
    system.runJob(cached.serialize(largeString, stream));
  });
});
