/**
 * @license
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

import { world, system, ScriptEventSource } from '@minecraft/server'

namespace IPC {
  export class Connection {
    private readonly _from: string
    private readonly _to: string
    private readonly _enc: string | false
    private readonly _terminators: Array<() => void>

    private *MAYBE_ENCRYPT(args: any[]): Generator<void, any, void> {
      return this._enc !== false ? yield* CRYPTO.encrypt(JSON.stringify(args), this._enc) : args
    }
    private *MAYBE_DECRYPT(args: any[]): Generator<void, any, void> {
      return this._enc !== false ? JSON.parse(yield* CRYPTO.decrypt(args[1] as string, this._enc)) : args[1]
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
      const $ = this
      $._terminators.forEach(terminate => terminate())
      $._terminators.length = 0
      if (notify) {
        system.runJob(NET.emit('ipc', 'terminate', $._to, [$._from]))
      }
    }

    send(channel: string, ...args: any[]): void {
      const $ = this
      system.runJob(
        (function* () {
          const data = yield* $.MAYBE_ENCRYPT(args)
          yield* NET.emit('ipc', 'send', `${$._to}:${channel}`, [$._from, data])
        })()
      )
    }

    invoke(channel: string, ...args: any[]): Promise<any> {
      const $ = this
      system.runJob(
        (function* () {
          const data = yield* $.MAYBE_ENCRYPT(args)
          yield* NET.emit('ipc', 'invoke', `${$._to}:${channel}`, [$._from, data])
        })()
      )

      return new Promise(resolve => {
        const terminate = NET.listen('ipc', 'handle', `${$._from}:${channel}`, function* (args) {
          if (args[0] === $._to) {
            const data = yield* $.MAYBE_DECRYPT(args)
            resolve(data)
            terminate()
          }
        })
      })
    }

    on(channel: string, listener: (...args: any[]) => void) {
      const $ = this
      const terminate = NET.listen('ipc', 'send', `${$._from}:${channel}`, function* (args) {
        if (args[0] === $._to) {
          const data = yield* $.MAYBE_DECRYPT(args)
          listener(...data)
        }
      })
      $._terminators.push(terminate)
      return terminate
    }

    once(channel: string, listener: (...args: any[]) => void) {
      const $ = this
      const terminate = NET.listen('ipc', 'send', `${$._from}:${channel}`, function* (args) {
        if (args[0] === $._to) {
          const data = yield* $.MAYBE_DECRYPT(args)
          listener(...data)
          terminate()
        }
      })
      $._terminators.push(terminate)
      return terminate
    }

    handle(channel: string, listener: (...args: any[]) => any) {
      const $ = this
      const terminate = NET.listen('ipc', 'invoke', `${$._from}:${channel}`, function* (args) {
        if (args[0] === $._to) {
          const data = yield* $.MAYBE_DECRYPT(args)
          const result = listener(...data)
          const return_data = yield* $.MAYBE_ENCRYPT(result)
          yield* NET.emit('ipc', 'handle', `${$._to}:${channel}`, [$._from, return_data])
        }
      })
      $._terminators.push(terminate)
      return terminate
    }
  }

  export class ConnectionManager {
    private readonly _id: string
    private readonly _enc_map: Map<string, string | false>
    private readonly _con_map: Map<string, Connection>
    private readonly _enc_force: boolean

    private *MAYBE_ENCRYPT(args: any[], encryption: string | false): Generator<void, any, void> {
      return encryption !== false ? yield* CRYPTO.encrypt(JSON.stringify(args), encryption) : args
    }
    private *MAYBE_DECRYPT(args: any[], encryption: string | false): Generator<void, any, void> {
      return encryption !== false ? JSON.parse(yield* CRYPTO.decrypt(args[1] as string, encryption)) : args[1]
    }

    get id() {
      return this._id
    }

    constructor(id: string, force_encryption: boolean = false) {
      const $ = this
      this._id = id
      this._enc_map = new Map<string, string | false>()
      this._con_map = new Map<string, Connection>()
      this._enc_force = force_encryption
      NET.listen('ipc', 'handshake', `${this._id}:SYN`, function* (args) {
        const secret = CRYPTO.make_secret(args[4])
        const public_key = yield* CRYPTO.make_public(secret, args[4], args[3])
        const enc = args[1] === 1 || $._enc_force ? yield* CRYPTO.make_shared(secret, args[2], args[3]) : false
        $._enc_map.set(args[0], enc)
        yield* NET.emit('ipc', 'handshake', `${args[0]}:ACK`, [$._id, $._enc_force ? 1 : 0, public_key])
      })

      NET.listen('ipc', 'terminate', this._id, function* (args) {
        $._enc_map.delete(args[0])
      })
    }

    connect(to: string, encrypted: boolean = false, timeout: number = 20): Promise<Connection> {
      const $ = this
      return new Promise((resolve, reject) => {
        const con = this._con_map.get(to)
        if (con !== undefined) {
          con.terminate(false)
          resolve(con)
        } else {
          const secret = CRYPTO.make_secret()
          const enc_flag = encrypted ? 1 : 0
          system.runJob(
            (function* () {
              const public_key = yield* CRYPTO.make_public(secret)
              yield* NET.emit('ipc', 'handshake', `${to}:SYN`, [$._id, enc_flag, public_key, CRYPTO.PRIME, CRYPTO.MOD])
            })()
          )
          function clear() {
            terminate()
            system.clearRun(timeout_handle)
          }
          const timeout_handle = system.runTimeout(() => {
            reject()
            clear()
          }, timeout)
          const terminate = NET.listen('ipc', 'handshake', `${this._id}:ACK`, function* (args) {
            if (args[0] === to) {
              const enc = args[1] === 1 || encrypted ? yield* CRYPTO.make_shared(secret, args[2]) : false
              const new_con = new Connection($._id, to, enc)
              $._con_map.set(to, new_con)
              resolve(new_con)
              clear()
            }
          })
        }
      })
    }

    send(channel: string, ...args: any[]): void {
      const $ = this
      system.runJob(
        (function* () {
          for (const [key, value] of $._enc_map) {
            const data = yield* $.MAYBE_ENCRYPT(args, value)
            yield* NET.emit('ipc', 'send', `${key}:${channel}`, [$._id, data])
          }
        })()
      )
    }

    invoke(channel: string, ...args: any[]): Promise<any>[] {
      const $ = this
      const promises: Promise<any>[] = []

      for (const [key, value] of $._enc_map) {
        system.runJob(
          (function* () {
            const data = yield* $.MAYBE_ENCRYPT(args, value)
            yield* NET.emit('ipc', 'invoke', `${key}:${channel}`, [$._id, data])
          })()
        )

        promises.push(
          new Promise(resolve => {
            const terminate = NET.listen('ipc', 'handle', `${$._id}:${channel}`, function* (args) {
              if (args[0] === key) {
                const data = yield* $.MAYBE_DECRYPT(args, value)
                resolve(data)
                terminate()
              }
            })
          })
        )
      }
      return promises
    }

    on(channel: string, listener: (...args: any[]) => void) {
      const $ = this
      return NET.listen('ipc', 'send', `${$._id}:${channel}`, function* (args) {
        const enc = $._enc_map.get(args[0]) as string | false
        if (enc !== undefined) {
          const data = yield* $.MAYBE_DECRYPT(args, enc)
          listener(...data)
        }
      })
    }

    once(channel: string, listener: (...args: any[]) => void) {
      const $ = this
      const terminate = NET.listen('ipc', 'send', `${$._id}:${channel}`, function* (args) {
        const enc = $._enc_map.get(args[0]) as string | false
        if (enc !== undefined) {
          const data = yield* $.MAYBE_DECRYPT(args, enc)
          listener(...data)
          terminate()
        }
      })
      return terminate
    }

    handle(channel: string, listener: (...args: any[]) => any) {
      const $ = this
      return NET.listen('ipc', 'invoke', `${$._id}:${channel}`, function* (args) {
        const enc = $._enc_map.get(args[0]) as string | false
        if (enc !== undefined) {
          const data = yield* $.MAYBE_DECRYPT(args, enc)
          const result = listener(...data)
          const return_data = yield* $.MAYBE_ENCRYPT(result, enc)
          yield* NET.emit('ipc', 'handle', `${args[0]}:${channel}`, [$._id, return_data])
        }
      })
    }
  }

  /** Sends a message with `args` to `channel` */
  export function send(channel: string, ...args: any[]): void {
    system.runJob(NET.emit('ipc', 'send', channel, args))
  }

  /** Sends an `invoke` message through IPC, and expects a result asynchronously. */
  export function invoke(channel: string, ...args: any[]): Promise<any> {
    system.runJob(NET.emit('ipc', 'invoke', channel, args))
    return new Promise(resolve => {
      const terminate = NET.listen('ipc', 'handle', channel, function* (args) {
        resolve(args[0])
        terminate()
      })
    })
  }

  /** Listens to `channel`. When a new message arrives, `listener` will be called with `listener(args)`. */
  export function on(channel: string, listener: (...args: any[]) => void) {
    return NET.listen('ipc', 'send', channel, function* (args) {
      listener(...args)
    })
  }

  /** Listens to `channel` once. When a new message arrives, `listener` will be called with `listener(args)`, and then removed. */
  export function once(channel: string, listener: (...args: any[]) => void) {
    const terminate = NET.listen('ipc', 'send', channel, function* (args) {
      listener(...args)
      terminate()
    })
    return terminate
  }

  /** Adds a handler for an `invoke` IPC. This handler will be called whenever `invoke(channel, ...args)` is called */
  export function handle(channel: string, listener: (...args: any[]) => any) {
    return NET.listen('ipc', 'invoke', channel, function* (args) {
      const result = listener(...args)
      yield* NET.emit('ipc', 'handle', channel, [result])
    })
  }
}

export default IPC

namespace SERDE {
  const INVALID_START_CODES = [48, 49, 50, 51, 52, 53, 54, 55, 56, 57]
  const INVALID_CODES = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
    31, 32, 33, 34, 35, 36, 37, 38, 39, 42, 43, 44, 47, 58, 59, 60, 61, 62, 63, 64, 91, 92, 93, 94, 96, 123, 124, 125,
    126, 127
  ]

  const sequence_regex = /\?[0-9a-zA-Z.\-]{2}|[^?]+/g
  const encoded_regex = /^\?[0-9a-zA-Z.\-]{2}$/

  const BASE64 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-'

  export function* b64_encode(char: string) {
    let encoded = ''
    for (let code = char.charCodeAt(0); code > 0; code = Math.floor(code / 64)) {
      encoded = BASE64[code % 64] + encoded
      yield
    }
    return encoded
  }

  export function* b64_decode(enc: string) {
    let code = 0
    for (let i = 0; i < enc.length; i++) {
      code += 64 ** (enc.length - 1 - i) * BASE64.indexOf(enc[i])
      yield
    }
    return String.fromCharCode(code)
  }

  export function* encode(str: string): Generator<void, string, void> {
    let result = ''
    for (let i = 0; i < str.length; i++) {
      const char = str.charAt(i)
      const char_code = char.charCodeAt(0)
      if ((i === 0 && INVALID_START_CODES.includes(char_code)) || INVALID_CODES.includes(char_code)) {
        result += `?${(yield* b64_encode(char)).padStart(2, '0')}`
      } else {
        result += char
      }
      yield
    }
    return result
  }

  export function* decode(str: string): Generator<void, string, void> {
    let result = ''
    const seqs = str.match(sequence_regex) ?? []
    for (let i = 0; i < seqs.length; i++) {
      const seq = seqs[i]
      if (seq.startsWith('?') && encoded_regex.test(seq)) result += yield* b64_decode(seq.slice(1))
      else {
        result += seq
      }
      yield
    }
    return result
  }
}

namespace CRYPTO {
  export const PRIME: number = 19893121
  export const MOD: number = 341

  const to_HEX = (n: number): string => n.toString(16).toUpperCase()
  const to_NUM = (h: string): number => parseInt(h, 16)

  function* mod_exp(base: number, exp: number, mod: number): Generator<void, number, void> {
    let result = 1
    let b = base % mod
    for (let e = exp; e > 0; e = Math.floor(e / 2)) {
      if (e % 2 === 1) {
        result = (result * b) % mod
      }
      b = (b * b) % mod
      yield
    }
    return result
  }

  export function make_secret(mod: number = CRYPTO.MOD): number {
    return Math.floor(Math.random() * (mod - 1)) + 1
  }

  export function* make_public(
    secret: number,
    mod: number = CRYPTO.MOD,
    prime: number = CRYPTO.PRIME
  ): Generator<void, string, void> {
    return to_HEX(yield* mod_exp(mod, secret, prime))
  }

  export function* make_shared(
    secret: number,
    other: string,
    prime: number = CRYPTO.PRIME
  ): Generator<void, string, void> {
    return to_HEX(yield* mod_exp(to_NUM(other), secret, prime))
  }

  export function* encrypt(raw: string, key: string): Generator<void, string, void> {
    let encrypted = ''
    for (let i = 0; i < raw.length; i++) {
      encrypted += String.fromCharCode(raw.charCodeAt(i) ^ key.charCodeAt(i % key.length))
      yield
    }
    return encrypted
  }

  export function* decrypt(encrypted: string, key: string): Generator<void, string, void> {
    let decrypted = ''
    for (let i = 0; i < encrypted.length; i++) {
      decrypted += String.fromCharCode(encrypted.charCodeAt(i) ^ key.charCodeAt(i % key.length))
      yield
    }
    return decrypted
  }
}

export namespace NET {
  const FRAG_MAX: number = 2048

  type Listener = (payload: Payload, data: string) => Generator<void, void, void>
  const namespace_listeners = new Map<string, Array<Listener>>()

  system.afterEvents.scriptEventReceive.subscribe(event => {
    system.runJob(
      (function* () {
        const ids = event.id.split(':')
        const namespace = yield* SERDE.decode(ids[0])
        const listeners = namespace_listeners.get(namespace)
        if (event.sourceType === ScriptEventSource.Server && listeners) {
          const payload = Payload.fromString(yield* SERDE.decode(ids[1]))
          for (let i = 0; i < listeners.length; i++) {
            yield* listeners[i](payload, event.message)
          }
        }
      })()
    )
  })

  function create_listener(namespace: string, listener: Listener) {
    let listeners = namespace_listeners.get(namespace)
    if (!listeners) {
      listeners = new Array<Listener>()
      namespace_listeners.set(namespace, listeners)
    }
    listeners.push(listener)

    return () => {
      const idx = listeners.indexOf(listener)
      if (idx !== -1) listeners.splice(idx, 1)

      if (listeners.length === 0) {
        namespace_listeners.delete(namespace)
      }
    }
  }

  type Payload =
    | [event: string, channel: string, id: string]
    | [event: string, channel: string, id: string, index: number]
    | [event: string, channel: string, id: string, index: number, final: number]

  namespace Payload {
    export function toString(p: Payload): string {
      return JSON.stringify(p)
    }
    export function fromString(s: string): Payload {
      return JSON.parse(s)
    }
  }

  const LUT: string[] = Array.from<string, string>({ length: 256 }, (_v, i) => {
    return i.toString(16).toUpperCase().padStart(2, '0')
  })

  function generate_id(): string {
    const r = (Math.random() * 0x100000000) >>> 0

    return [LUT[r & 0xff], LUT[(r >> 8) & 0xff], LUT[(r >> 16) & 0xff], LUT[(r >> 24) & 0xff]].join('')
  }

  export function* emit(namespace: string, event: string, channel: string, args: any[]): Generator<void, void, void> {
    const id = generate_id()
    const enc_namespace = yield* SERDE.encode(namespace)
    const args_str = yield* SERDE.encode(JSON.stringify(args))

    const RUN = function* (payload: Payload, data_str: string) {
      const enc_payload = yield* SERDE.encode(Payload.toString(payload))
      world.getDimension('overworld').runCommand(`scriptevent ${enc_namespace}:${enc_payload} ${data_str}`)
    }

    let len = 0
    let str = ''
    let str_size = 0
    for (let i = 0; i < args_str.length; i++) {
      const char = args_str[i]
      const code = char.charCodeAt(0)
      const char_size = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4

      if (str_size + char_size < FRAG_MAX) {
        str += char
        str_size += char_size
      } else {
        yield* RUN([event, channel, id, len], str)
        len++
        str = char
        str_size = char_size
      }
      yield
    }

    yield* RUN(len === 0 ? [event, channel, id] : [event, channel, id, len, 1], str)
  }

  export function listen(
    namespace: string,
    event: string,
    channel: string,
    callback: (args: any[]) => Generator<void, void, void>
  ) {
    const buffer = new Map<string, { size: number; data_strs: string[]; data_size: number }>()
    const listener = function* (payload: Payload, data: string): Generator<void, void, void> {
      const [p_event, p_channel, id, index, final] = payload
      if (p_event === event && p_channel === channel) {
        if (index === undefined) {
          yield* callback(JSON.parse(yield* SERDE.decode(data)))
        } else {
          let fragment = buffer.get(id)
          if (!fragment) {
            fragment = { size: -1, data_strs: [], data_size: 0 }
            buffer.set(id, fragment)
          }

          fragment.size = final === 1 ? index + 1 : fragment.size
          fragment.data_strs[index] = data
          fragment.data_size += index + 1

          if (fragment.size !== -1 && fragment.data_size === (fragment.size * (fragment.size + 1)) / 2) {
            let full_str = ''
            for (let i = 0; i < fragment.data_strs.length; i++) {
              full_str += fragment.data_strs[i]
              yield
            }
            yield* callback(JSON.parse(yield* SERDE.decode(full_str)))
            buffer.delete(id)
          }
        }
      }
    }
    return create_listener(namespace, listener)
  }
}
