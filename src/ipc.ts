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

import { world, system, ScriptEventSource, ScriptEventCommandMessageAfterEvent } from '@minecraft/server'

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
       * @default 2048
       * @warning Modify only if you know what you're doing, incorrect values can cause issues
       */
      export let MAX_CMD_LENGTH: number = 2048
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
    private readonly _terminators: Array<() => void>

    private ARGS(data: any) {
      return [this._from, data]
    }
    private CHANNEL(channel: string, id: string = this._from) {
      return `${id}:${channel}`
    }
    private MAYBE_ENCRYPT(args: any[]) {
      return this._enc !== false ? ENCRYPTION.encrypt(JSON.stringify(args), this._enc) : args
    }
    private MAYBE_DECRYPT(args: any[]) {
      return this._enc !== false ? JSON.parse(ENCRYPTION.decrypt(args[1] as string, this._enc)) : args[1]
    }
    private GUARD(in_args: any, success: () => void) {
      if (in_args[0] === this._to) {
        success()
      }
    }

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
      this._terminators = new Array<() => void>()
    }

    terminate(notify: boolean = true) {
      this._terminators.forEach(terminate => terminate())
      this._terminators.length = 0
      if (notify) {
        emit('terminate', this._to, [this._from])
      }
    }

    send(channel: string, ...args: any[]): void {
      const data = this._enc !== false ? ENCRYPTION.encrypt(JSON.stringify(args), this._enc) : args
      emit('send', this.CHANNEL(channel, this._to), this.ARGS(data))
    }

    invoke(channel: string, ...args: any[]): Promise<any> {
      const data = this.MAYBE_ENCRYPT(args)
      emit('invoke', this.CHANNEL(channel, this._to), this.ARGS(data))
      return new Promise(resolve => {
        const terminate = listen('handle', this.CHANNEL(channel), args => {
          this.GUARD(args, () => {
            const data = this.MAYBE_DECRYPT(args)
            resolve(data)
            terminate()
          })
        })
      })
    }

    handle(channel: string, listener: (...args: any[]) => any) {
      const terminate = listen('invoke', this.CHANNEL(channel), args => {
        this.GUARD(args, () => {
          const data = this.MAYBE_DECRYPT(args)
          const result = listener(...data)
          const return_data = this.MAYBE_ENCRYPT(result)
          emit('handle', this.CHANNEL(channel, this._to), this.ARGS(return_data))
        })
      })
      this._terminators.push(terminate)
      return terminate
    }

    on(channel: string, listener: (...args: any[]) => void) {
      const terminate = listen('send', this.CHANNEL(channel), args => {
        this.GUARD(args, () => {
          const data = this.MAYBE_DECRYPT(args)
          listener(...data)
        })
      })
      this._terminators.push(terminate)
      return terminate
    }

    once(channel: string, listener: (...args: any[]) => void) {
      const terminate = listen('send', this.CHANNEL(channel), args => {
        this.GUARD(args, () => {
          const data = this.MAYBE_DECRYPT(args)
          listener(...data)
          terminate()
        })
      })
      this._terminators.push(terminate)
      return terminate
    }
  }

  export class ConnectionManager {
    private readonly _id: string
    private readonly _enc_map: Map<string, string | false>
    private readonly _con_map: Map<string, Connection>
    private readonly _enc_force: boolean

    private ARGS(data: any) {
      return [this._id, data]
    }
    private CHANNEL(channel: string, id: string = this._id) {
      return `${id}:${channel}`
    }

    private MAYBE_ENCRYPT(args: any[], encryption: string | false) {
      return encryption !== false ? ENCRYPTION.encrypt(JSON.stringify(args), encryption) : args
    }
    private MAYBE_DECRYPT(args: any[], encryption: string | false) {
      return encryption !== false ? JSON.parse(ENCRYPTION.decrypt(args[1] as string, encryption)) : args[1]
    }
    private GUARD(in_args: any, success: (encryption: string | false) => void) {
      const enc = this._enc_map.get(in_args[0]) as string | false
      if (enc !== undefined) {
        success(enc)
      }
    }

    get id() {
      return this._id
    }

    constructor(id: string, force_encryption: boolean = false) {
      this._id = id
      this._enc_map = new Map<string, string | false>()
      this._con_map = new Map<string, Connection>()
      this._enc_force = force_encryption
      listen('handshake', `${this._id}:SYN`, args => {
        const secret = ENCRYPTION.generate_secret(args[4])
        const public_key = ENCRYPTION.generate_public(secret, args[4], args[3])
        const enc = args[1] === 1 || this._enc_force ? ENCRYPTION.generate_shared(secret, args[2], args[3]) : false
        this._enc_map.set(args[0], enc)
        emit('handshake', `${args[0]}:ACK`, [this._id, this._enc_force ? 1 : 0, public_key])
      })

      listen('terminate', this._id, args => {
        this._enc_map.delete(args[0])
      })
    }

    connect(to: string, encrypted: boolean = false, timeout: number = 20): Promise<Connection> {
      return new Promise((resolve, reject) => {
        const con = this._con_map.get(to)
        if (con !== undefined) {
          con.terminate(false)
          resolve(con)
        } else {
          const secret = ENCRYPTION.generate_secret()
          const public_key = ENCRYPTION.generate_public(secret)
          const enc_flag = encrypted ? 1 : 0
          emit('handshake', `${to}:SYN`, [
            this._id,
            enc_flag,
            public_key,
            CONFIG.ENCRYPTION.PRIME,
            CONFIG.ENCRYPTION.MOD
          ])
          function clear() {
            terminate()
            system.clearRun(timeout_handle)
          }
          const timeout_handle = system.runTimeout(() => {
            reject()
            clear()
          }, timeout)
          const terminate = listen('handshake', `${this._id}:ACK`, args => {
            if (args[0] === to) {
              const enc = args[1] === 1 || encrypted ? ENCRYPTION.generate_shared(secret, args[2]) : false
              const new_con = new Connection(this._id, to, enc)
              this._con_map.set(to, new_con)
              resolve(new_con)
              clear()
            }
          })
        }
      })
    }

    handle(channel: string, listener: (...args: any[]) => any) {
      return listen('invoke', this.CHANNEL(channel), args => {
        this.GUARD(args, enc => {
          const data = this.MAYBE_DECRYPT(args, enc)
          const result = listener(...data)
          const return_data = this.MAYBE_ENCRYPT(result, enc)
          emit('handle', this.CHANNEL(channel, args[0]), this.ARGS(return_data))
        })
      })
    }

    on(channel: string, listener: (...args: any[]) => void) {
      return listen('send', this.CHANNEL(channel), args => {
        this.GUARD(args, enc => {
          const data = this.MAYBE_DECRYPT(args, enc)
          listener(...data)
        })
      })
    }

    once(channel: string, listener: (...args: any[]) => void) {
      const terminate = listen('send', this.CHANNEL(channel), args => {
        this.GUARD(args, enc => {
          const data = this.MAYBE_DECRYPT(args, enc)
          listener(...data)
          terminate()
        })
      })
      return terminate
    }

    send(channel: string, ...args: any[]): void {
      this._enc_map.forEach((value, key) => {
        const data = this.MAYBE_ENCRYPT(args, value)
        emit('send', this.CHANNEL(channel, key), this.ARGS(data))
      })
    }

    invoke(channel: string, ...args: any[]): Promise<any>[] {
      const promises: Promise<any>[] = []
      this._enc_map.forEach((value, key) => {
        const data = this.MAYBE_ENCRYPT(args, value)
        emit('invoke', this.CHANNEL(channel, key), this.ARGS(data))
        promises.push(
          new Promise(resolve => {
            const terminate = listen('handle', this.CHANNEL(channel), args => {
              if (args[0] === key) {
                const data = this.MAYBE_DECRYPT(args, value)
                resolve(data)
                terminate()
              }
            })
          })
        )
      })
      return promises
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
    const buffer = new Map<number, { size: number; data_strs: string[] }>()
    const event_listener = system.afterEvents.scriptEventReceive.subscribe(
      event => {
        if (event.id === `ipc:${event_id}` && event.sourceType === ScriptEventSource.Server) {
          const p: Payload.Packed = JSON.parse(decodeURI(event.message))
          if (p[0] === channel) {
            const payload: Payload = Payload.fromPacked(p)
            const fragment = buffer.has(payload.id)
              ? buffer.get(payload.id)
              : buffer.set(payload.id, { size: -1, data_strs: [] }).get(payload.id)
            if (fragment !== undefined) {
              fragment.size = payload.index === undefined ? 1 : payload.final ? payload.index + 1 : fragment.size
              fragment.data_strs[payload.index ?? 0] = payload.data
              if (fragment.size !== -1) {
                if (fragment.data_strs.filter(p => p !== null).length === fragment.size) {
                  const full_str = fragment.data_strs.reduce((acc, curr) => acc + curr, '')
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
    return () => system.afterEvents.scriptEventReceive.unsubscribe(event_listener)
  }

  function emit(event_id: string, channel: string, args: any[]) {
    const CMD = (payload: Payload) => `scriptevent ipc:${event_id} ${encodeURI(Payload.toString(payload))}`
    const RUN = (cmd: string) => world.getDimension('overworld').runCommand(cmd)
    const cmd = CMD({ channel: channel, id: ID, data: '' })
    system.runJob(
      (function* () {
        const args_str = JSON.stringify(args)
        yield

        const chars = new Array<string>()
        for (const char of args_str) {
          chars.push(char)
          yield
        }

        const enc_chars = new Array()
        {
          let acc: string = ''
          for (const char of JSON.stringify(args_str)) {
            if (char === '\\' && acc.length === 0) {
              acc += char
            } else {
              enc_chars.push(encodeURI(acc + char))
              acc = ''
            }
            yield
          }
        }

        const cmds = new Array<string>()

        let str = ''
        let enc_str_len = 0
        for (let i = 0; i < chars.length; i++) {
          const enc_char = enc_chars[i + 1]
          const cmd_len = enc_str_len + enc_char.length + cmd.length + `,${cmds.length},1`.length
          if (cmd_len < CONFIG.FRAGMENTATION.MAX_CMD_LENGTH) {
            str += chars[i]
            enc_str_len += enc_char.length
          } else {
            cmds.push(CMD({ channel: channel, id: ID, data: str, index: cmds.length }))
            str = chars[i]
            enc_str_len = enc_char.length
          }
          yield
        }

        cmds.push(
          CMD(
            cmds.length === 0
              ? { channel: channel, id: ID, data: str }
              : { channel: channel, id: ID, data: str, index: cmds.length, final: true }
          )
        )

        for (const cmd of cmds) {
          RUN(cmd)
          yield
        }
      })()
    )
    ID++
  }

  /** Sends a message with `args` to `channel` */
  export function send(channel: string, ...args: any[]): void {
    emit('send', channel, args)
  }

  /** Sends an `invoke` message through IPC, and expects a result asynchronously. */
  export function invoke(channel: string, ...args: any[]): Promise<any> {
    emit('invoke', channel, args)
    return new Promise(resolve => {
      const terminate = listen('handle', channel, args => {
        resolve(args[0])
        terminate()
      })
    })
  }

  /** Adds a handler for an `invoke` IPC. This handler will be called whenever `invoke(channel, ...args)` is called */
  export function handle(channel: string, listener: (...args: any[]) => any) {
    return listen('invoke', channel, args => {
      const result = listener(...args)
      emit('handle', channel, [result])
    })
  }

  /** Listens to `channel`. When a new message arrives, `listener` will be called with `listener(args)`. */
  export function on(channel: string, listener: (...args: any[]) => void) {
    return listen('send', channel, args => listener(...args))
  }

  /** Listens to `channel` once. When a new message arrives, `listener` will be called with `listener(args)`, and then removed. */
  export function once(channel: string, listener: (...args: any[]) => void) {
    const terminate = listen('send', channel, args => {
      listener(...args)
      terminate()
    })
    return terminate
  }
}

export default IPC
