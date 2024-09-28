/**
 * MIT License
 *
 * Copyright (c) 2024 OmniacDev
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { world, system } from '@minecraft/server'

namespace IPC {
  let ID = 0

  export namespace CONFIG {
    export namespace ENCRYPTION {
      /**
       * @description Used to generate secrets, must be a prime number
       * @default 19893121
       * @warning Modify only if you know what you're doing, incorrect values can cause issues
       */
      export let PRIME: number = 19893121
      /**
       * @description Used to generate secrets, must be a prime root of {@link PRIME}
       * @default 341
       * @warning Modify only if you know what you're doing, incorrect values can cause issues
       */
      export let MOD: number = 341
    }
    export namespace FRAGMENTATION {
      /**
       * @description Used when fragmenting data strings
       * @default 1024
       * @warning Modify only if you know what you're doing, incorrect values can cause issues
       */
      export let MAX_CMD_LENGTH: number = 1024
    }
  }

  namespace ENCRYPTION {
    export function generate_secret(mod: number = CONFIG.ENCRYPTION.MOD): number {
      return Math.floor(Math.random() * (mod - 1)) + 1
    }

    export function generate_public(
      secret: number,
      mod: number = CONFIG.ENCRYPTION.MOD,
      prime: number = CONFIG.ENCRYPTION.PRIME
    ): string {
      return HEX(mod_exp(mod, secret, prime))
    }

    export function generate_shared(
      secret: number,
      other_key: string,
      prime: number = CONFIG.ENCRYPTION.PRIME
    ): string {
      return HEX(mod_exp(NUM(other_key), secret, prime))
    }

    export function encrypt(raw: string, key: string): string {
      let encrypted = ''
      for (let i = 0; i < raw.length; i++) {
        encrypted += String.fromCharCode(raw.charCodeAt(i) ^ key.charCodeAt(i % key.length))
      }
      return encrypted
    }

    export function decrypt(encrypted: string, key: string): string {
      let decrypted = ''
      for (let i = 0; i < encrypted.length; i++) {
        decrypted += String.fromCharCode(encrypted.charCodeAt(i) ^ key.charCodeAt(i % key.length))
      }
      return decrypted
    }

    function mod_exp(base: number, exp: number, mod: number): number {
      let result = 1
      base = base % mod
      while (exp > 0) {
        if (exp % 2 === 1) {
          result = (result * base) % mod
        }
        exp = Math.floor(exp / 2)
        base = (base * base) % mod
      }
      return result
    }

    function HEX(num: number): string {
      return num.toString(16).toUpperCase()
    }
    function NUM(hex: string): number {
      return parseInt(hex, 16)
    }
  }

  export class Connection {
    private readonly _from: string
    private readonly _to: string
    private readonly _enc: string | false

    get from() {
      return this._from
    }

    get to() {
      return this._to
    }

    constructor(from: string, to: string, encryption: string | false) {
      this._from = from
      this._to = to
      this._enc = encryption
    }

    send(channel: string, ...args: any[]): void {
      const data = this._enc !== false ? ENCRYPTION.encrypt(JSON.stringify(args), this._enc) : args
      emit('send', `${this._to}:${channel}`, [this._from, data])
    }

    invoke(channel: string, ...args: any[]): Promise<any> {
      const data = this._enc !== false ? ENCRYPTION.encrypt(JSON.stringify(args), this._enc) : args
      emit('invoke', `${this._to}:${channel}`, [this._from, data])
      return new Promise(resolve => {
        const listener = listen('handle', `${this._from}:${channel}`, args => {
          const data = this._enc !== false ? JSON.parse(ENCRYPTION.decrypt(args[1] as string, this._enc)) : args[1]
          resolve(data)
          system.afterEvents.scriptEventReceive.unsubscribe(listener)
        })
      })
    }
  }

  export class ConnectionManager {
    private readonly _id: string
    private readonly _enc_map: Map<string, string | false>
    private readonly _enc_force: boolean

    get id() {
      return this._id
    }

    constructor(id: string, force_encryption: boolean = false) {
      this._id = id
      this._enc_map = new Map<string, string | false>()
      this._enc_force = force_encryption
      listen('handshake', `${this._id}:SYN`, args => {
        const secret = ENCRYPTION.generate_secret(args[4])
        const public_key = ENCRYPTION.generate_public(secret, args[4], args[3])
        const enc = args[1] === 1 || this._enc_force ? ENCRYPTION.generate_shared(secret, args[2], args[3]) : false
        this._enc_map.set(args[0], enc)
        emit('handshake', `${args[0]}:ACK`, [this._id, this._enc_force ? 1 : 0, public_key])
      })
    }

    connect(to: string, encrypted: boolean = false, timeout: number = 20): Promise<Connection> {
      const secret = ENCRYPTION.generate_secret()
      const public_key = ENCRYPTION.generate_public(secret)
      const enc_flag = encrypted ? 1 : 0
      emit('handshake', `${to}:SYN`, [this._id, enc_flag, public_key, CONFIG.ENCRYPTION.PRIME, CONFIG.ENCRYPTION.MOD])
      return new Promise((resolve, reject) => {
        function clear() {
          system.afterEvents.scriptEventReceive.unsubscribe(listener)
          system.clearRun(timeout_handle)
        }
        const timeout_handle = system.runTimeout(() => {
          reject()
          clear()
        }, timeout)
        const listener = listen('handshake', `${this._id}:ACK`, args => {
          if (args[0] === to) {
            const enc = args[1] === 1 || encrypted ? ENCRYPTION.generate_shared(secret, args[2]) : false
            resolve(new Connection(this._id, to, enc))
            clear()
          }
        })
      })
    }

    handle(channel: string, listener: (...args: any[]) => any) {
      listen('invoke', `${this._id}:${channel}`, args => {
        const enc = this._enc_map.get(args[0]) as string | false
        const data: any[] = enc !== false ? JSON.parse(ENCRYPTION.decrypt(args[1] as string, enc)) : args[1]
        const result = listener(...data)
        const return_data = enc !== false ? ENCRYPTION.encrypt(JSON.stringify(result), enc) : result
        emit('handle', `${args[0]}:${channel}`, [this._id, return_data])
      })
    }

    on(channel: string, listener: (...args: any[]) => void) {
      listen('send', `${this._id}:${channel}`, args => {
        const enc = this._enc_map.get(args[0]) as string | false
        const data: any[] = enc !== false ? JSON.parse(ENCRYPTION.decrypt(args[1] as string, enc)) : args[1]
        listener(...data)
      })
    }

    once(channel: string, listener: (...args: any[]) => void) {
      const event = listen('send', `${this._id}:${channel}`, args => {
        const enc = this._enc_map.get(args[0]) as string | false
        const data: any[] = enc !== false ? JSON.parse(ENCRYPTION.decrypt(args[1] as string, enc)) : args[1]
        listener(...data)
        system.afterEvents.scriptEventReceive.unsubscribe(event)
      })
    }
  }

  interface Payload {
    channel: string
    id: number
    data: string
    index?: number
    final?: boolean
  }

  namespace Payload {
    export type Packed =
      | [string, number, string]
      | [string, number, string, number]
      | [string, number, string, number, number]
    export function toString(p: Payload): string {
      return JSON.stringify(toPacked(p))
    }
    export function fromString(s: string): Payload {
      return fromPacked(JSON.parse(s) as Packed)
    }

    export function toPacked(p: Payload): Packed {
      return p.index !== undefined
        ? p.final !== undefined
          ? [p.channel, p.id, p.data, p.index, p.final ? 1 : 0]
          : [p.channel, p.id, p.data, p.index]
        : [p.channel, p.id, p.data]
    }

    export function fromPacked(p: Packed): Payload {
      return p[3] !== undefined
        ? p[4] !== undefined
          ? { channel: p[0], id: p[1], data: p[2], index: p[3], final: p[4] === 1 }
          : { channel: p[0], id: p[1], data: p[2], index: p[3] }
        : { channel: p[0], id: p[1], data: p[2] }
    }
  }

  function listen(event_id: string, channel: string, callback: (args: any[]) => void) {
    const buffer = new Map<number, { size: number; payloads: Payload[] }>()
    return system.afterEvents.scriptEventReceive.subscribe(
      event => {
        if (event.id === `ipc:${event_id}`) {
          const p: Payload.Packed = JSON.parse(decodeURI(event.message))
          if (p[0] === channel) {
            const payload: Payload = Payload.fromPacked(p)
            const fragment = buffer.has(payload.id)
              ? buffer.get(payload.id)
              : buffer.set(payload.id, { size: -1, payloads: [] }).get(payload.id)
            if (fragment !== undefined) {
              fragment.size = payload.index === undefined ? 1 : payload.final ? payload.index + 1 : fragment.size
              fragment.payloads[payload.index ?? 0] = payload
              if (fragment.size !== -1) {
                if (fragment.payloads.filter(p => p !== null).length === fragment.size) {
                  const full_str = fragment.payloads.map(contents => contents.data).join('')
                  callback(JSON.parse(full_str))
                  buffer.delete(payload.id)
                }
              }
            }
          }
        }
      },
      { namespaces: ['ipc'] }
    )
  }

  function emit(event_id: string, channel: string, args: any[]) {
    function CMD(payload: Payload) {
      return `scriptevent ipc:${event_id} ${encodeURI(Payload.toString(payload))}`
    }

    const args_str = JSON.stringify(args)
    const commands: string[] = []

    let idx = 0
    while (idx != -1) {
      let sub_str = args_str.substring(idx)

      if (commands.length === 0) {
        const single = CMD({ channel: channel, id: ID, data: sub_str })
        if (single.length < CONFIG.FRAGMENTATION.MAX_CMD_LENGTH) {
          commands.push(single)
          idx = -1
          break
        }
      }

      const final = CMD({ channel: channel, id: ID, data: sub_str, index: commands.length, final: true })
      if (final.length < CONFIG.FRAGMENTATION.MAX_CMD_LENGTH) {
        commands.push(final)
        idx = -1
        break
      } else {
        const mid = CMD({ channel: channel, id: ID, data: sub_str, index: commands.length })
        if (mid.length > CONFIG.FRAGMENTATION.MAX_CMD_LENGTH) {
          const true_chars = Array.from(sub_str)

          const chars = (function (chars: string[]) {
            const result: string[] = []
            let accumulator: string = ''
            chars.forEach(c => {
              if (c === '\\') {
                accumulator += c
                if (accumulator.length === 2) {
                  result.push(accumulator)
                  accumulator = ''
                }
              } else {
                if (accumulator.length === 1) {
                  result.push(accumulator + c)
                  accumulator = ''
                } else {
                  result.push(c)
                }
              }
            })
            return result
          })(Array.from(JSON.stringify(sub_str)))

          const encoded_chars = chars.map(c => encodeURI(c))

          let adjusted_chars = true_chars

          const encoded_chars_length = encoded_chars.reduce((acc, c) => acc + c.length, 0)
          const length_overflow = mid.length - CONFIG.FRAGMENTATION.MAX_CMD_LENGTH
          const encoded_data_target_length = encoded_chars_length - length_overflow
          if (encoded_data_target_length < 1) throw new Error('Invalid Target Length')
          let encoded_chars_total = encoded_chars_length
          while (encoded_chars_total > encoded_data_target_length) {
            adjusted_chars.pop()
            encoded_chars_total -= encoded_chars[adjusted_chars.length + 1]?.length
          }
          const adjusted_string = adjusted_chars.join('')

          if (adjusted_string.length < 1) throw new Error('Empty Data')
          const new_cmd = CMD({ channel: channel, id: ID, data: adjusted_string, index: commands.length })
          sub_str = args_str.substring(idx, idx + adjusted_string.length)
          idx += adjusted_string.length
          commands.push(new_cmd)
        } else {
          commands.push(mid)
        }
      }
    }

    system.runJob(
      (function* () {
        for (const cmd of commands) {
          world.getDimension('overworld').runCommand(cmd)
          yield
        }
      })()
    )
    ID++
  }

  /** Sends an `invoke` message through IPC, and expects a result asynchronously. */
  export function invoke(channel: string, ...args: any[]): Promise<any> {
    emit('invoke', channel, args)
    return new Promise(resolve => {
      const listener = listen('handle', channel, args => {
        resolve(args[0])
        system.afterEvents.scriptEventReceive.unsubscribe(listener)
      })
    })
  }

  /** Adds a handler for an `invoke` IPC. This handler will be called whenever `invoke(channel, ...args)` is called */
  export function handle(channel: string, listener: (...args: any[]) => any) {
    listen('invoke', channel, args => {
      const result = listener(...args)
      emit('handle', channel, [result])
    })
  }

  /** Sends a message with `args` to `channel` */
  export function send(channel: string, ...args: any[]): void {
    emit('send', channel, args)
  }

  /** Listens to `channel`. When a new message arrives, `listener` will be called with `listener(args)`. */
  export function on(channel: string, listener: (...args: any[]) => void) {
    listen('send', channel, args => listener(...args))
  }

  /** Listens to `channel` once. When a new message arrives, `listener` will be called with `listener(args)`, and then removed. */
  export function once(channel: string, listener: (...args: any[]) => void) {
    const event = listen('send', channel, args => {
      listener(...args)
      system.afterEvents.scriptEventReceive.unsubscribe(event)
    })
  }
}

export default IPC
