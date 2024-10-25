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

import { world, system, ScriptEventSource } from '@minecraft/server'

namespace SERDE {
  const valid_chars = '()-.ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz'
  const sequence_regex = /\?{2}[0-9a-zA-Z\.\-]{3}|\?{1}[0-9a-zA-Z\.\-]{2}|[^?]+/g
  const UTF8_regex = /^\?{1}[0-9a-zA-Z\.\-]{2}$/
  const UTF16_regex = /^\?{2}[0-9a-zA-Z\.\-]{3}$/

  const BASE64 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-'

  export function* b64_encode(char: string) {
    let code = char.charCodeAt(0)
    let encoded = ''

    while (code > 0) {
      encoded = BASE64[code % 64] + encoded
      code = Math.floor(code / 64)
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

  export function* encode(str: string, ignored: string = valid_chars): Generator<void, string, void> {
    const result = new Array<string>()
    for (let i = 0; i < str.length; i++) {
      const char = str.charAt(i)
      if (ignored.includes(char)) {
        result.push(char)
      } else {
        let code = char.charCodeAt(0)
        if (code >= 0xd800) {
          result.push(`??${(yield* b64_encode(char)).padStart(3, '0')}`)
        } else {
          result.push(`?${(yield* b64_encode(char)).padStart(2, '0')}`)
        }
      }
      yield
    }
    return result.join('')
  }

  export function* decode(str: string): Generator<void, string, void> {
    const result = new Array<string>()
    for (const sequence of str.match(sequence_regex) ?? []) {
      if (sequence.startsWith('??') && UTF16_regex.test(sequence)) {
        result.push(yield* b64_decode(sequence.slice(2)))
      } else if (sequence.startsWith('?') && UTF8_regex.test(sequence))
        result.push(yield* b64_decode(sequence.slice(1)))
      else {
        result.push(sequence)
      }
      yield
    }
    return result.join('')
  }
}

namespace CRYPTO {
  export const PRIME: number = 19893121
  export const MOD: number = 341

  const to_HEX = (n: number): string => n.toString(16).toUpperCase()
  const to_NUM = (h: string): number => parseInt(h, 16)

  function* mod_exp(base: number, exp: number, mod: number): Generator<void, number, void> {
    let result = 1
    base = base % mod
    while (exp > 0) {
      if (exp % 2 === 1) {
        result = (result * base) % mod
      }
      exp = Math.floor(exp / 2)
      base = (base * base) % mod
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
  export const FRAG_MAX: number = 2048

  interface Payload {
    channel: string
    id: string
    data: string
    index?: number
    final?: boolean
  }

  namespace Payload {
    export type Packed =
      | [string, string, string]
      | [string, string, string, number]
      | [string, string, string, number, number]
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

  interface SERDE_Payload {
    event: string
    channel: string
    id: string
    index?: number
    final?: boolean
  }

  namespace SERDE_Payload {
    export type Packed =
      | [string, string, string]
      | [string, string, string, number]
      | [string, string, string, number, number]
    export function toString(p: SERDE_Payload): string {
      return JSON.stringify(toPacked(p))
    }
    export function fromString(s: string): SERDE_Payload {
      return fromPacked(JSON.parse(s) as Packed)
    }

    export function toPacked(p: SERDE_Payload): Packed {
      return p.index !== undefined
        ? p.final !== undefined
          ? [p.event, p.channel, p.id, p.index, p.final ? 1 : 0]
          : [p.event, p.channel, p.id, p.index]
        : [p.event, p.channel, p.id]
    }

    export function fromPacked(p: Packed): SERDE_Payload {
      return p[3] !== undefined
        ? p[4] !== undefined
          ? { event: p[0], channel: p[1], id: p[2], index: p[3], final: p[4] === 1 }
          : { event: p[0], channel: p[1], id: p[2], index: p[3] }
        : { event: p[0], channel: p[1], id: p[2] }
    }
  }

  const LUT: string[] = Array.from<string, string>({ length: 256 }, (_v, i) => {
    return (i < 16 ? '0' : '') + i.toString(16).toUpperCase()
  })

  function generate_id(): string {
    const r = (Math.random() * 0x100000000) >>> 0

    return [LUT[r & 0xff], LUT[(r >> 8) & 0xff], LUT[(r >> 16) & 0xff], LUT[(r >> 24) & 0xff]].join('')
  }

  export function listen(event_id: string, channel: string, callback: (args: any[]) => void) {
    const buffer = new Map<string, { size: number; data_strs: string[]; data_size: number }>()
    const jobs = new Array<number>()
    const event_listener = system.afterEvents.scriptEventReceive.subscribe(
      event => {
        if (event.id === `ipc:${event_id}` && event.sourceType === ScriptEventSource.Server) {
          const p: Payload.Packed = JSON.parse(decodeURI(event.message))
          if (p[0] === channel) {
            const payload: Payload = Payload.fromPacked(p)
            const fragment = buffer.has(payload.id)
              ? buffer.get(payload.id)
              : buffer.set(payload.id, { size: -1, data_strs: [], data_size: 0 }).get(payload.id)
            if (fragment !== undefined) {
              fragment.size = payload.index === undefined ? 1 : payload.final ? payload.index + 1 : fragment.size
              fragment.data_strs[payload.index ?? 0] = payload.data
              fragment.data_size += (payload.index ?? 0) + 1
              if (fragment.size !== -1) {
                if (fragment.data_size === (fragment.size * (fragment.size + 1)) / 2) {
                  const job = system.runJob(
                    (function* () {
                      let full_str = ''
                      for (const str of fragment.data_strs) {
                        full_str += str
                        yield
                      }
                      callback(JSON.parse(full_str))
                      buffer.delete(payload.id)
                    })()
                  )
                  jobs.push(job)
                }
              }
            }
          }
        }
      },
      { namespaces: ['ipc'] }
    )
    return () => {
      system.afterEvents.scriptEventReceive.unsubscribe(event_listener)
      for (const job of jobs) {
        system.clearJob(job)
      }
      jobs.length = 0
    }
  }

  export function* emit(event_id: string, channel: string, args: any[]): Generator<void, void, void> {
    const ID = generate_id()

    const MSG = (payload: Payload) => encodeURI(Payload.toString(payload))
    const RUN = (msg: string) => world.getDimension('overworld').runCommand(`scriptevent ipc:${event_id} ${msg}`)
    const msg = MSG({ channel: channel, id: ID, data: '' })

    const args_str = JSON.stringify(args)

    const chars = new Array<string>()
    for (const char of args_str) {
      chars.push(char)
      yield
    }

    const enc_chars = new Array<string>()
    {
      let acc: string = ''
      for (const char of JSON.stringify(args_str)) {
        if (char === '\\' && acc.length === 0) {
          acc += char
        } else {
          enc_chars.push(yield* SERDE.encode(acc + char))
          acc = ''
        }
        yield
      }
    }

    let len = 0
    let str = ''
    let enc_str_len = 0
    for (let i = 0; i < chars.length; i++) {
      const enc_char = enc_chars[i + 1]
      const msg_len = enc_str_len + enc_char.length + msg.length + `,${len},1`.length
      if (msg_len < NET.FRAG_MAX) {
        str += chars[i]
        enc_str_len += enc_char.length
      } else {
        RUN(MSG({ channel: channel, id: ID, data: str, index: len }))
        len++
        str = chars[i]
        enc_str_len = enc_char.length
      }
      yield
    }

    RUN(
      MSG(
        len === 0
          ? { channel: channel, id: ID, data: str }
          : { channel: channel, id: ID, data: str, index: len, final: true }
      )
    )
  }

  export function* serde_emit(event_id: string, channel: string, args: any[]): Generator<void, void, void> {
    const ID = generate_id()

    const MSG = (data: string) => SERDE.encode(data)
    const E_ID = (payload: SERDE_Payload) => SERDE.encode(SERDE_Payload.toString(payload))
    const RUN = (id: string, msg: string) => world.getDimension('overworld').runCommand(`scriptevent ipc:${id} ${msg}`)

    const args_str = JSON.stringify(args)

    const chars = new Array<string>()
    for (const char of args_str) {
      chars.push(char)
      yield
    }

    const enc_chars = new Array<string>()
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

    let len = 0
    let str = ''
    let enc_str_len = 0
    for (let i = 0; i < chars.length; i++) {
      const enc_char = enc_chars[i + 1]
      const msg_len = enc_str_len + enc_char.length
      if (msg_len < NET.FRAG_MAX) {
        str += chars[i]
        enc_str_len += enc_char.length
      } else {
        RUN(yield* E_ID({ event: event_id, channel: channel, id: ID, index: len }), yield* MSG(str))
        len++
        str = chars[i]
        enc_str_len = enc_char.length
      }
      yield
    }

    RUN(
      yield* E_ID(
        len === 0
          ? { event: event_id, channel: channel, id: ID }
          : { event: event_id, channel: channel, id: ID, index: len, final: true }
      ),
      yield* MSG(str)
    )
  }

  export function serde_listen(event_id: string, channel: string, callback: (args: any[]) => void) {
    const buffer = new Map<string, { size: number; data_strs: string[]; data_size: number }>()
    const jobs = new Array<number>()
    const event_listener = system.afterEvents.scriptEventReceive.subscribe(
      event => {
        if (event.id.startsWith(`ipc:`) && event.sourceType === ScriptEventSource.Server) {
          const job = system.runJob(
            (function* () {
              const payload = SERDE_Payload.fromString(yield* SERDE.decode(event.id.slice(4)))
              if (payload.event === event_id && payload.channel === channel) {
                const data = yield* SERDE.decode(event.message)

                const fragment = buffer.has(payload.id)
                  ? buffer.get(payload.id)
                  : buffer.set(payload.id, { size: -1, data_strs: [], data_size: 0 }).get(payload.id)
                if (fragment !== undefined) {
                  fragment.size = payload.index === undefined ? 1 : payload.final ? payload.index + 1 : fragment.size
                  fragment.data_strs[payload.index ?? 0] = data
                  fragment.data_size += (payload.index ?? 0) + 1
                  if (fragment.size !== -1) {
                    if (fragment.data_size === (fragment.size * (fragment.size + 1)) / 2) {
                      let full_str = ''
                      for (const str of fragment.data_strs) {
                        full_str += str
                        yield
                      }
                      callback(JSON.parse(full_str))
                      buffer.delete(payload.id)
                    }
                  }
                }
              }
            })()
          )
          jobs.push(job)
        }
      },
      { namespaces: ['ipc'] }
    )
    return () => {
      system.afterEvents.scriptEventReceive.unsubscribe(event_listener)
      for (const job of jobs) {
        system.clearJob(job)
      }
      jobs.length = 0
    }
  }
}

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
        system.runJob(NET.emit('terminate', $._to, [$._from]))
      }
    }

    send(channel: string, ...args: any[]): void {
      const $ = this
      system.runJob(
        (function* () {
          const data = yield* $.MAYBE_ENCRYPT(args)
          yield* NET.emit('send', `${$._to}:${channel}`, [$._from, data])
        })()
      )
    }

    invoke(channel: string, ...args: any[]): Promise<any> {
      const $ = this
      system.runJob(
        (function* () {
          const data = yield* $.MAYBE_ENCRYPT(args)
          yield* NET.emit('invoke', `${$._to}:${channel}`, [$._from, data])
        })()
      )

      return new Promise(resolve => {
        const terminate = NET.listen('handle', `${$._from}:${channel}`, args => {
          if (args[0] === $._to) {
            system.runJob(
              (function* () {
                const data = yield* $.MAYBE_DECRYPT(args)
                resolve(data)
              })()
            )
            terminate()
          }
        })
      })
    }

    on(channel: string, listener: (...args: any[]) => void) {
      const $ = this
      const terminate = NET.listen('send', `${$._from}:${channel}`, args => {
        if (args[0] === $._to) {
          system.runJob(
            (function* () {
              const data = yield* $.MAYBE_DECRYPT(args)
              listener(...data)
            })()
          )
        }
      })
      $._terminators.push(terminate)
      return terminate
    }

    once(channel: string, listener: (...args: any[]) => void) {
      const $ = this
      const terminate = NET.listen('send', `${$._from}:${channel}`, args => {
        if (args[0] === $._to) {
          system.runJob(
            (function* () {
              const data = yield* $.MAYBE_DECRYPT(args)
              listener(...data)
            })()
          )
          terminate()
        }
      })
      $._terminators.push(terminate)
      return terminate
    }

    handle(channel: string, listener: (...args: any[]) => any) {
      const $ = this
      const terminate = NET.listen('invoke', `${$._from}:${channel}`, args => {
        if (args[0] === $._to) {
          system.runJob(
            (function* () {
              const data = yield* $.MAYBE_DECRYPT(args)
              const result = listener(...data)
              const return_data = yield* $.MAYBE_ENCRYPT(result)
              yield* NET.emit('handle', `${$._to}:${channel}`, [$._from, return_data])
            })()
          )
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
      NET.listen('handshake', `${this._id}:SYN`, args => {
        system.runJob(
          (function* () {
            const secret = CRYPTO.make_secret(args[4])
            const public_key = yield* CRYPTO.make_public(secret, args[4], args[3])
            const enc = args[1] === 1 || $._enc_force ? yield* CRYPTO.make_shared(secret, args[2], args[3]) : false
            $._enc_map.set(args[0], enc)
            yield* NET.emit('handshake', `${args[0]}:ACK`, [$._id, $._enc_force ? 1 : 0, public_key])
          })()
        )
      })

      NET.listen('terminate', this._id, args => {
        this._enc_map.delete(args[0])
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
              yield* NET.emit('handshake', `${to}:SYN`, [$._id, enc_flag, public_key, CRYPTO.PRIME, CRYPTO.MOD])
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
          const terminate = NET.listen('handshake', `${this._id}:ACK`, args => {
            if (args[0] === to) {
              system.runJob(
                (function* () {
                  const enc = args[1] === 1 || encrypted ? yield* CRYPTO.make_shared(secret, args[2]) : false
                  const new_con = new Connection($._id, to, enc)
                  $._con_map.set(to, new_con)
                  resolve(new_con)
                })()
              )
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
            yield* NET.emit('send', `${key}:${channel}`, [$._id, data])
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
            yield* NET.emit('invoke', `${key}:${channel}`, [$._id, data])
          })()
        )

        promises.push(
          new Promise(resolve => {
            const terminate = NET.listen('handle', `${$._id}:${channel}`, args => {
              if (args[0] === key) {
                system.runJob(
                  (function* () {
                    const data = yield* $.MAYBE_DECRYPT(args, value)
                    resolve(data)
                  })()
                )
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
      return NET.listen('send', `${$._id}:${channel}`, args => {
        const enc = this._enc_map.get(args[0]) as string | false
        if (enc !== undefined) {
          system.runJob(
            (function* () {
              const data = yield* $.MAYBE_DECRYPT(args, enc)
              listener(...data)
            })()
          )
        }
      })
    }

    once(channel: string, listener: (...args: any[]) => void) {
      const $ = this
      const terminate = NET.listen('send', `${$._id}:${channel}`, args => {
        const enc = this._enc_map.get(args[0]) as string | false
        if (enc !== undefined) {
          system.runJob(
            (function* () {
              const data = yield* $.MAYBE_DECRYPT(args, enc)
              listener(...data)
            })()
          )
          terminate()
        }
      })
      return terminate
    }

    handle(channel: string, listener: (...args: any[]) => any) {
      const $ = this
      return NET.listen('invoke', `${$._id}:${channel}`, args => {
        const enc = this._enc_map.get(args[0]) as string | false
        if (enc !== undefined) {
          system.runJob(
            (function* () {
              const data = yield* $.MAYBE_DECRYPT(args, enc)
              const result = listener(...data)
              const return_data = yield* $.MAYBE_ENCRYPT(result, enc)
              yield* NET.emit('handle', `${args[0]}:${channel}`, [$._id, return_data])
            })()
          )
        }
      })
    }
  }

  /** Sends a message with `args` to `channel` */
  export function send(channel: string, ...args: any[]): void {
    system.runJob(NET.emit('send', channel, args))
  }

  /** Sends an `invoke` message through IPC, and expects a result asynchronously. */
  export function invoke(channel: string, ...args: any[]): Promise<any> {
    system.runJob(NET.emit('invoke', channel, args))
    return new Promise(resolve => {
      const terminate = NET.listen('handle', channel, args => {
        resolve(args[0])
        terminate()
      })
    })
  }

  /** Listens to `channel`. When a new message arrives, `listener` will be called with `listener(args)`. */
  export function on(channel: string, listener: (...args: any[]) => void) {
    return NET.listen('send', channel, args => listener(...args))
  }

  /** Listens to `channel` once. When a new message arrives, `listener` will be called with `listener(args)`, and then removed. */
  export function once(channel: string, listener: (...args: any[]) => void) {
    const terminate = NET.listen('send', channel, args => {
      listener(...args)
      terminate()
    })
    return terminate
  }

  /** Adds a handler for an `invoke` IPC. This handler will be called whenever `invoke(channel, ...args)` is called */
  export function handle(channel: string, listener: (...args: any[]) => any) {
    return NET.listen('invoke', channel, args => {
      const result = listener(...args)
      system.runJob(NET.emit('handle', channel, [result]))
    })
  }
}

export default IPC
