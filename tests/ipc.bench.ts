import { bench, describe } from 'vitest'
import IPC, { NET, PROTO } from '../src/ipc'
import { system } from './mocks/@minecraft/server'
import Buffer = PROTO.Buffer
import MIPS = PROTO.MIPS

describe('ipc-benchmark', () => {
  bench('send', () => {
    IPC.send('ipc:test', PROTO.String, 'Hello World!')
  })
  
  let resolveFn: (value: string) => void = _ => {}
  IPC.on('ipc:test', PROTO.String, str => {
    resolveFn(str)
  })

  bench('send + receive', async () => {
    await new Promise<string>(resolve => {
      resolveFn = resolve

      IPC.send('ipc:test', PROTO.String, 'Hello World!')
    })
  })

  IPC.handle('ipc:test', PROTO.String, PROTO.String, _ => {
    return 'Hello World!'
  })
  
  bench('invoke', async () => {
    await IPC.invoke('ipc:test', PROTO.String, 'Hello World!', PROTO.String)
  })
})

describe('mips-benchmark', async () => {
  const buffer = new Buffer()
  system.runJob(PROTO.String.serialize('Hello World!', buffer))
  const bytes = buffer.to_uint8array()

  bench('serialize', () => {
    system.runJob(
      (function* () {
        const buffer = Buffer.from_uint8array(bytes)

        yield* MIPS.serialize(buffer)
      })()
    )
  })

  const serialized = await new Promise<string>(resolve => {
    system.runJob(
      (function* () {
        const buffer = new Buffer()
        yield* PROTO.String.serialize('Hello World!', buffer)
        const serialized = yield* MIPS.serialize(buffer)
        resolve(serialized)
      })()
    )
  })

  bench('deserialize', () => {
    system.runJob(
      (function* () {
        yield * MIPS.deserialize(serialized)
      })()
    )
  })
})

describe('net-benchmark', async () => {
  const buffer = new Buffer()
  system.runJob(PROTO.String.serialize('Hello World!', buffer))
  const bytes = buffer.to_uint8array()
  
  bench("serialize", () => {
    system.runJob(function*(){
      const buffer = Buffer.from_uint8array(bytes)
      yield* NET.serialize(buffer)
    }())
  })
  
  const serialized = await new Promise<string[]>(resolve => {
    system.runJob(function*(){
      const buffer = new Buffer()
      yield* PROTO.String.serialize('Hello World!', buffer)
      const serialized = yield* NET.serialize(buffer)
      resolve(serialized)
    }())
  })
  
  bench("deserialize", () => {
    system.runJob(
      (function* () {
        yield* NET.deserialize(serialized)
      })()
    )
  })
})