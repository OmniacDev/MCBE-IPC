import { describe, it, expect } from 'vitest';
import IPC, { NET, PROTO } from '../src/ipc';
import { system } from '@minecraft/server';

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
