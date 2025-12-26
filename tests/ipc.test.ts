import { describe, it, expect } from 'vitest'
import IPC, { PROTO } from '../src/ipc'

describe('ipc', () => {
  it('should receive the same value', async () => {
    const value = "Hello World!";
    
    const recv = await new Promise<string>(resolve => {
      IPC.on('ipc:test', PROTO.String, str => {
        resolve(str)
      })

      IPC.send('ipc:test', PROTO.String, value)
    })

    expect(recv).toEqual(value)
  })
})