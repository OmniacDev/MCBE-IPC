/**
 * @license
 * MIT License
 *
 * Copyright (c) 2025 OmniacDev
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

import { system } from '@minecraft/server'
import { NET, PROTO } from './ipc'

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

  export function make_secret(mod: number): number {
    return Math.floor(Math.random() * (mod - 1)) + 1
  }

  export function* make_public(secret: number, mod: number, prime: number): Generator<void, string, void> {
    return to_HEX(yield* mod_exp(mod, secret, prime))
  }

  export function* make_shared(secret: number, other: string, prime: number): Generator<void, string, void> {
    return to_HEX(yield* mod_exp(to_NUM(other), secret, prime))
  }

  export function* encrypt(raw: Uint8Array, key: string): Generator<void, Uint8Array, void> {
    let encrypted = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) {
      encrypted[i] = raw[i] ^ key.charCodeAt(i % key.length)
      yield
    }
    return encrypted
  }

  export function* decrypt(encrypted: Uint8Array, key: string): Generator<void, Uint8Array, void> {
    let decrypted = new Uint8Array(encrypted.length)
    for (let i = 0; i < encrypted.length; i++) {
      decrypted[i] = encrypted[i] ^ key.charCodeAt(i % key.length)
      yield
    }
    return decrypted
  }
}

export namespace DirectIPC {
  const ConnectionSerializer = PROTO.Object({
    from: PROTO.String,
    bytes: PROTO.UInt8Array
  })
  const HandshakeSynchronizeSerializer = PROTO.Object({
    from: PROTO.String,
    encryption_enabled: PROTO.Boolean,
    encryption_public_key: PROTO.String,
    encryption_prime: PROTO.UVarInt32,
    encryption_modulus: PROTO.UVarInt32
  })
  const HandshakeAcknowledgeSerializer = PROTO.Object({
    from: PROTO.String,
    encryption_enabled: PROTO.Boolean,
    encryption_public_key: PROTO.String
  })

  export class Connection {
    private readonly _from: string
    private readonly _to: string
    private readonly _enc: string | false
    private readonly _terminators: Array<() => void>

    private *MAYBE_ENCRYPT(bytes: Uint8Array): Generator<void, Uint8Array, void> {
      return this._enc !== false ? yield* CRYPTO.encrypt(bytes, this._enc) : bytes
    }
    private *MAYBE_DECRYPT(bytes: Uint8Array): Generator<void, Uint8Array, void> {
      return this._enc !== false ? yield* CRYPTO.decrypt(bytes, this._enc) : bytes
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
        system.runJob(NET.emit(`ipc:${$._to}:terminate`, PROTO.String, $._from))
      }
    }

    send<S extends PROTO.Serializable<T>, T>(channel: string, serializer: S & PROTO.Serializable<T>, value: T): void {
      const $ = this
      system.runJob(
        (function* () {
          const stream = new PROTO.ByteQueue()
          yield* serializer.serialize(value, stream)
          const bytes = yield* $.MAYBE_ENCRYPT(stream.to_uint8array())
          yield* NET.emit(`ipc:${$._to}:manager:${channel}:send`, ConnectionSerializer, {
            from: $._from,
            bytes
          })
        })()
      )
    }

    invoke<TS extends PROTO.Serializable<T>, T, RS extends PROTO.Serializable<R>, R>(
      channel: string,
      serializer: TS & PROTO.Serializable<T>,
      value: T,
      deserializer: RS & PROTO.Serializable<R>
    ): Promise<R> {
      const $ = this
      system.runJob(
        (function* () {
          const stream = new PROTO.ByteQueue()
          yield* serializer.serialize(value, stream)
          const bytes = yield* $.MAYBE_ENCRYPT(stream.to_uint8array())
          yield* NET.emit(`ipc:${$._to}:manager:${channel}:invoke`, ConnectionSerializer, {
            from: $._from,
            bytes
          })
        })()
      )

      return new Promise(resolve => {
        const terminate = NET.listen(`ipc:${$._from}:connection:${channel}:handle`, ConnectionSerializer, function* (data) {
          if (data.from === $._to) {
            const bytes = yield* $.MAYBE_DECRYPT(data.bytes)
            const stream = PROTO.ByteQueue.from_uint8array(bytes)
            const value = yield* deserializer.deserialize(stream)
            resolve(value)
            terminate()
          }
        })
      })
    }

    on<S extends PROTO.Serializable<T>, T>(
      channel: string,
      deserializer: S & PROTO.Serializable<T>,
      listener: (value: T) => void
    ) {
      const $ = this
      const terminate = NET.listen(`ipc:${$._from}:connection:${channel}:send`, ConnectionSerializer, function* (data) {
        if (data.from === $._to) {
          const bytes = yield* $.MAYBE_DECRYPT(data.bytes)
          const stream = PROTO.ByteQueue.from_uint8array(bytes)
          const value = yield* deserializer.deserialize(stream)
          listener(value)
        }
      })
      $._terminators.push(terminate)
      return terminate
    }

    once<S extends PROTO.Serializable<T>, T>(
      channel: string,
      deserializer: S & PROTO.Serializable<T>,
      listener: (value: T) => void
    ) {
      const $ = this
      const terminate = NET.listen(`ipc:${$._from}:connection:${channel}:send`, ConnectionSerializer, function* (data) {
        if (data.from === $._to) {
          const bytes = yield* $.MAYBE_DECRYPT(data.bytes)
          const stream = PROTO.ByteQueue.from_uint8array(bytes)
          const value = yield* deserializer.deserialize(stream)
          listener(value)
          terminate()
        }
      })
      $._terminators.push(terminate)
      return terminate
    }

    handle<TS extends PROTO.Serializable<T>, T, RS extends PROTO.Serializable<R>, R>(
      channel: string,
      deserializer: TS & PROTO.Serializable<T>,
      serializer: RS & PROTO.Serializable<R>,
      listener: (value: T) => R
    ) {
      const $ = this
      const terminate = NET.listen(`ipc:${$._from}:connection:${channel}:invoke`, ConnectionSerializer, function* (data) {
        if (data.from === $._to) {
          const bytes = yield* $.MAYBE_DECRYPT(data.bytes)
          const stream = PROTO.ByteQueue.from_uint8array(bytes)
          const value = yield* deserializer.deserialize(stream)
          const result = listener(value)
          const return_stream = new PROTO.ByteQueue()
          yield* serializer.serialize(result, return_stream)
          const return_bytes = yield* $.MAYBE_ENCRYPT(return_stream.to_uint8array())
          yield* NET.emit(`ipc:${$._to}:manager:${channel}:handle`, ConnectionSerializer, {
            from: $._from,
            bytes: return_bytes
          })
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

    private *MAYBE_ENCRYPT(bytes: Uint8Array, encryption: string | false): Generator<void, Uint8Array, void> {
      return encryption !== false ? yield* CRYPTO.encrypt(bytes, encryption) : bytes
    }
    private *MAYBE_DECRYPT(bytes: Uint8Array, encryption: string | false): Generator<void, Uint8Array, void> {
      return encryption !== false ? yield* CRYPTO.decrypt(bytes, encryption) : bytes
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
      NET.listen(`ipc:${this._id}:handshake:synchronize`, HandshakeSynchronizeSerializer, function* (data) {
        const secret = CRYPTO.make_secret(data.encryption_modulus)
        const public_key = yield* CRYPTO.make_public(secret, data.encryption_modulus, data.encryption_prime)
        const enc =
          data.encryption_enabled || $._enc_force
            ? yield* CRYPTO.make_shared(secret, data.encryption_public_key, data.encryption_prime)
            : false
        $._enc_map.set(data.from, enc)
        yield* NET.emit(`ipc:${data.from}:handshake:acknowledge`, HandshakeAcknowledgeSerializer, {
          from: $._id,
          encryption_public_key: public_key,
          encryption_enabled: $._enc_force
        })
      })

      NET.listen(`ipc:${this._id}:terminate`, PROTO.String, function* (value) {
        $._enc_map.delete(value)
      })
    }

    connect(
      to: string,
      encrypted: boolean = false,
      timeout: number = 20,
      mod: number = CRYPTO.MOD,
      prime: number = CRYPTO.PRIME
    ): Promise<Connection> {
      const $ = this
      return new Promise((resolve, reject) => {
        const con = this._con_map.get(to)
        if (con !== undefined) {
          con.terminate(false)
          resolve(con)
        } else {
          const secret = CRYPTO.make_secret(mod)
          system.runJob(
            (function* () {
              const public_key = yield* CRYPTO.make_public(secret, mod, prime)
              yield* NET.emit(`ipc:${to}:handshake:synchronize`, HandshakeSynchronizeSerializer, {
                from: $._id,
                encryption_enabled: encrypted,
                encryption_public_key: public_key,
                encryption_prime: prime,
                encryption_modulus: mod
              })
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
          const terminate = NET.listen(
            `ipc:${this._id}:handshake:acknowledge`,
            HandshakeAcknowledgeSerializer,
            function* (data) {
              if (data.from === to) {
                const enc =
                  data.encryption_enabled || encrypted
                    ? yield* CRYPTO.make_shared(secret, data.encryption_public_key, prime)
                    : false
                const new_con = new Connection($._id, to, enc)
                $._con_map.set(to, new_con)
                resolve(new_con)
                clear()
              }
            }
          )
        }
      })
    }

    send<S extends PROTO.Serializable<T>, T>(channel: string, serializer: S & PROTO.Serializable<T>, value: T): void {
      const $ = this
      system.runJob(
        (function* () {
          for (const [key, enc] of $._enc_map) {
            const stream = new PROTO.ByteQueue()
            yield* serializer.serialize(value, stream)
            const bytes = yield* $.MAYBE_ENCRYPT(stream.to_uint8array(), enc)
            yield* NET.emit(`ipc:${key}:connection:${channel}:send`, ConnectionSerializer, {
              from: $._id,
              bytes
            })
          }
        })()
      )
    }

    invoke<TS extends PROTO.Serializable<T>, T, RS extends PROTO.Serializable<R>, R>(
      channel: string,
      serializer: TS & PROTO.Serializable<T>,
      value: T,
      deserializer: RS & PROTO.Serializable<R>
    ): Promise<R>[] {
      const $ = this
      const promises: Promise<any>[] = []

      for (const [key, enc] of $._enc_map) {
        system.runJob(
          (function* () {
            const stream = new PROTO.ByteQueue()
            yield* serializer.serialize(value, stream)
            const bytes = yield* $.MAYBE_ENCRYPT(stream.to_uint8array(), enc)
            yield* NET.emit(`ipc:${key}:connection:${channel}:invoke`, ConnectionSerializer, {
              from: $._id,
              bytes
            })
          })()
        )

        promises.push(
          new Promise(resolve => {
            const terminate = NET.listen(`ipc:${$._id}:manager:${channel}:handle`, ConnectionSerializer, function* (data) {
              if (data.from === key) {
                const bytes = yield* $.MAYBE_DECRYPT(data.bytes, enc)
                const stream = PROTO.ByteQueue.from_uint8array(bytes)
                const value = yield* deserializer.deserialize(stream)
                resolve(value)
                terminate()
              }
            })
          })
        )
      }
      return promises
    }

    on<S extends PROTO.Serializable<T>, T>(
      channel: string,
      deserializer: S & PROTO.Serializable<T>,
      listener: (value: T) => void
    ) {
      const $ = this
      return NET.listen(`ipc:${$._id}:manager:${channel}:send`, ConnectionSerializer, function* (data) {
        const enc = $._enc_map.get(data.from) as string | false
        if (enc !== undefined) {
          const bytes = yield* $.MAYBE_DECRYPT(data.bytes, enc)
          const stream = PROTO.ByteQueue.from_uint8array(bytes)
          const value = yield* deserializer.deserialize(stream)
          listener(value)
        }
      })
    }

    once<S extends PROTO.Serializable<T>, T>(
      channel: string,
      deserializer: S & PROTO.Serializable<T>,
      listener: (value: T) => void
    ) {
      const $ = this
      const terminate = NET.listen(`ipc:${$._id}:manager:${channel}:send`, ConnectionSerializer, function* (data) {
        const enc = $._enc_map.get(data.from) as string | false
        if (enc !== undefined) {
          const bytes = yield* $.MAYBE_DECRYPT(data.bytes, enc)
          const stream = PROTO.ByteQueue.from_uint8array(bytes)
          const value = yield* deserializer.deserialize(stream)
          listener(value)
          terminate()
        }
      })
      return terminate
    }

    handle<TS extends PROTO.Serializable<T>, T, RS extends PROTO.Serializable<R>, R>(
      channel: string,
      deserializer: TS & PROTO.Serializable<T>,
      serializer: RS & PROTO.Serializable<R>,
      listener: (value: T) => R
    ) {
      const $ = this
      return NET.listen(`ipc:${$._id}:manager:${channel}:invoke`, ConnectionSerializer, function* (data) {
        const enc = $._enc_map.get(data.from) as string | false
        if (enc !== undefined) {
          const input_bytes = yield* $.MAYBE_DECRYPT(data.bytes, enc)
          const input_stream = PROTO.ByteQueue.from_uint8array(input_bytes)
          const input_value = yield* deserializer.deserialize(input_stream)
          const result = listener(input_value)
          const output_stream = new PROTO.ByteQueue()
          yield* serializer.serialize(result, output_stream)
          const output_bytes = yield* $.MAYBE_ENCRYPT(output_stream.to_uint8array(), enc)
          yield* NET.emit(`ipc:${data.from}:connection:${channel}:handle`, ConnectionSerializer, {
            from: $._id,
            bytes: output_bytes
          })
        }
      })
    }
  }
}

export default DirectIPC
