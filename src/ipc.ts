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

import { ScriptEventSource, system, world } from '@minecraft/server'

export namespace SERDE {
  export class ByteArray {
    private _buffer: Uint8Array
    private _data_view: DataView
    private _length: number

    constructor(size: number = 256) {
      this._buffer = new Uint8Array(size)
      this._data_view = new DataView(this._buffer.buffer)
      this._length = 0
    }

    write(...values: number[]): void {
      this._ensure_capacity(this._length + values.length)
      this._buffer.set(values, this._length)
      this._length += values.length
    }

    read(amount: number = 1): number[] {
      if (this._length === 0) return []
      const values = this._buffer.subarray(this._length - amount, this._length).reverse()
      this._length -= amount
      return Array.from(values)
    }

    write_start(...values: number[]): void {
      this._ensure_capacity(this._length + values.length)
      this._buffer.set(this._buffer.subarray(0, this._length), values.length)
      this._buffer.set(values, 0)
      this._length += values.length
    }

    read_start(): number | undefined {
      if (this._length === 0) return undefined
      const value = this._buffer[0]
      this._buffer.set(this._buffer.subarray(1, this._length))
      this._length--
      return value
    }

    write_uint8(value: number): void {
      this._ensure_capacity(this._length + 1)
      this._data_view.setUint8(this._length, value)
      this._length += 1
    }

    read_uint8(): number | undefined {
      if (this._length < 1) return undefined
      return this._data_view.getUint8(--this._length)
    }

    write_uint16(value: number): void {
      this._ensure_capacity(this._length + 2)
      this._data_view.setUint16(this._length, value)
      this._length += 2
    }

    read_uint16(): number | undefined {
      if (this._length < 2) return undefined
      const bytes = new Uint8Array(this._buffer.subarray(this._length - 2, this._length)).reverse()
      const value = new DataView(bytes.buffer).getUint16(0)
      this._length -= 2
      return value
    }

    write_uint32(value: number): void {
      this._ensure_capacity(this._length + 4)
      this._data_view.setUint32(this._length, value)
      this._length += 4
    }

    read_uint32(): number | undefined {
      if (this._length < 4) return undefined
      const bytes = new Uint8Array(this._buffer.subarray(this._length - 4, this._length)).reverse()
      const value = new DataView(bytes.buffer).getUint32(0)
      this._length -= 4
      return value
    }

    write_int8(value: number): void {
      this._ensure_capacity(this._length + 1)
      this._data_view.setInt8(this._length, value)
      this._length += 1
    }

    read_int8(): number | undefined {
      if (this._length < 1) return undefined
      return this._data_view.getInt8(--this._length)
    }

    write_int16(value: number): void {
      this._ensure_capacity(this._length + 2)
      this._data_view.setInt16(this._length, value)
      this._length += 2
    }

    read_int16(): number | undefined {
      if (this._length < 2) return undefined
      const bytes = new Uint8Array(this._buffer.subarray(this._length - 2, this._length)).reverse()
      const value = new DataView(bytes.buffer).getInt16(0)
      this._length -= 2
      return value
    }

    write_int32(value: number): void {
      this._ensure_capacity(this._length + 4)
      this._data_view.setInt32(this._length, value)
      this._length += 4
    }

    read_int32(): number | undefined {
      if (this._length < 4) return undefined
      const bytes = new Uint8Array(this._buffer.subarray(this._length - 4, this._length)).reverse()
      const value = new DataView(bytes.buffer).getInt32(0)
      this._length -= 4
      return value
    }

    write_f32(value: number): void {
      this._ensure_capacity(this._length + 4)
      this._data_view.setFloat32(this._length, value)
      this._length += 4
    }

    read_f32(): number | undefined {
      if (this._length < 4) return undefined
      const bytes = new Uint8Array(this._buffer.subarray(this._length - 4, this._length)).reverse()
      const value = new DataView(bytes.buffer).getFloat32(0)
      this._length -= 4
      return value
    }

    write_f64(value: number): void {
      this._ensure_capacity(this._length + 8)
      this._data_view.setFloat64(this._length, value)
      this._length += 8
    }

    read_f64(): number | undefined {
      if (this._length < 8) return undefined
      const bytes = new Uint8Array(this._buffer.subarray(this._length - 8, this._length)).reverse()
      const value = new DataView(bytes.buffer).getFloat64(0)
      this._length -= 8
      return value
    }

    private _ensure_capacity(size: number) {
      if (size > this._buffer.length) {
        const larger_buffer = new Uint8Array(size * 2)
        larger_buffer.set(this._buffer)
        this._buffer = larger_buffer
        this._data_view = new DataView(this._buffer.buffer)
      }
    }

    static from_uint8array(array: Uint8Array) {
      const byte_array = new ByteArray()
      byte_array._buffer = array
      byte_array._length = array.length
      byte_array._data_view = new DataView(array.buffer)
      return byte_array
    }

    to_uint8array() {
      return this._buffer.subarray(0, this._length)
    }
  }

  export function uint8array_to_string(uint8array: Uint8Array): string {
    let utf16_string = ''
    for (let i = 0; i < uint8array.length; i++) {
      const char_code = uint8array[i] | (uint8array[++i] << 8)
      if (char_code > 0xff) utf16_string += String.fromCharCode(char_code)
      else utf16_string += `?${char_code.toString(16).padStart(2, '0')}`
    }
    return utf16_string
  }

  export function string_to_uint8array(utf16_string: string): Uint8Array {
    const result: number[] = []
    for (let i = 0; i < utf16_string.length; i++) {
      const char_code = utf16_string.charCodeAt(i)
      if (char_code === '?'.charCodeAt(0) && i + 2 < utf16_string.length) {
        const hex = utf16_string.slice(i + 1, i + 3)
        result.push(parseInt(hex, 16))
      } else {
        result.push(char_code & 0xff)
        result.push(char_code >> 8)
      }
    }
    return new Uint8Array(result)
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

export class Proto {
  static Int8: NET.Serializable<number> = {
    serialize(value, stream) {
      stream.write_int8(value)
    },
    deserialize(stream) {
      return stream.read_int8()!
    }
  }
  static Int16: NET.Serializable<number> = {
    serialize(value, stream) {
      stream.write_int16(value)
    },
    deserialize(stream) {
      return stream.read_int16()!
    }
  }
  static Int32: NET.Serializable<number> = {
    serialize(value, stream) {
      stream.write_int32(value)
    },
    deserialize(stream) {
      return stream.read_int32()!
    }
  }
  static UInt8: NET.Serializable<number> = {
    serialize(value, stream) {
      stream.write_uint8(value)
    },
    deserialize(stream) {
      return stream.read_uint8()!
    }
  }
  static UInt16: NET.Serializable<number> = {
    serialize(value, stream) {
      stream.write_uint16(value)
    },
    deserialize(stream) {
      return stream.read_uint16()!
    }
  }
  static UInt32: NET.Serializable<number> = {
    serialize(value, stream) {
      stream.write_uint32(value)
    },
    deserialize(stream) {
      return stream.read_uint32()!
    }
  }
  static Float32: NET.Serializable<number> = {
    serialize(value, stream) {
      stream.write_f32(value)
    },
    deserialize(stream) {
      return stream.read_f32()!
    }
  }
  static Float64: NET.Serializable<number> = {
    serialize(value, stream) {
      stream.write_f64(value)
    },
    deserialize(stream) {
      return stream.read_f64()!
    }
  }
  static VarInt: NET.Serializable<number> = {
    serialize(value, stream) {
      while (value >= 0x80) {
        stream.write((value & 0x7f) | 0x80)
        value >>= 7
      }
      stream.write(value)
    },
    deserialize(stream) {
      let value = 0
      let shift = 0
      let byte
      do {
        byte = stream.read()[0]!
        value |= (byte & 0x7f) << shift
        shift += 7
      } while (byte & 0x80)
      return value
    }
  }
  static String: NET.Serializable<string> = {
    serialize(value, stream) {
      Proto.VarInt.serialize(value.length, stream)
      for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i)
        Proto.VarInt.serialize(code, stream)
      }
    },
    deserialize(stream) {
      const length = Proto.VarInt.deserialize(stream)
      let value = ''
      for (let i = 0; i < length; i++) {
        const code = Proto.VarInt.deserialize(stream)
        value += String.fromCharCode(code)
      }
      return value
    }
  }
  static Boolean: NET.Serializable<boolean> = {
    serialize(value, stream) {
      stream.write(value ? 1 : 0)
    },
    deserialize(stream) {
      const value = stream.read()[0]!
      return value === 1
    }
  }
  static UInt8Array: NET.Serializable<Uint8Array> = {
    serialize(value: Uint8Array, stream: SERDE.ByteArray) {
      Proto.VarInt.serialize(value.length, stream)
      for (const item of value) {
        stream.write_uint8(item)
      }
    },
    deserialize(stream: SERDE.ByteArray): Uint8Array {
      const length = Proto.VarInt.deserialize(stream)
      const result = new Uint8Array(length)
      for (let i = 0; i < length; i++) {
        result[i] = stream.read_uint8()!
      }
      return result
    }
  }
  static Object<T extends object>(obj: { [K in keyof T]: NET.Serializable<T[K]> }): NET.Serializable<T> {
    return {
      serialize(value, stream) {
        for (const key in obj) {
          if (value.hasOwnProperty(key)) {
            obj[key].serialize(value[key], stream)
          }
        }
      },
      deserialize(stream) {
        const result: Partial<T> = {}
        for (const key in obj) {
          result[key] = obj[key].deserialize(stream)
        }
        return result as T
      }
    }
  }
  static Array<T>(items: NET.Serializable<T>): NET.Serializable<T[]> {
    return {
      serialize(value, stream) {
        Proto.VarInt.serialize(value.length, stream)
        for (const item of value) {
          items.serialize(item, stream)
        }
      },
      deserialize(stream) {
        const result: T[] = []
        const length = Proto.VarInt.deserialize(stream)
        for (let i = 0; i < length; i++) {
          result[i] = items.deserialize(stream)
        }
        return result
      }
    }
  }
  static Tuple<T extends any[]>(...items: { [K in keyof T]: NET.Serializable<T[K]> }): NET.Serializable<T> {
    return {
      serialize(value, stream) {
        for (let i = 0; i < items.length; i++) {
          items[i].serialize(value[i], stream)
        }
      },
      deserialize(stream) {
        const result: any[] = []
        for (let i = 0; i < items.length; i++) {
          result[i] = items[i].deserialize(stream)
        }
        return result as T
      }
    }
  }
  static Optional<T>(item: NET.Serializable<T>): NET.Serializable<T | undefined> {
    return {
      serialize(value, stream) {
        Proto.Boolean.serialize(value !== undefined, stream)
        if (value !== undefined) {
          item.serialize(value, stream)
        }
      },
      deserialize(stream) {
        const defined = Proto.Boolean.deserialize(stream)
        if (defined) {
          return item.deserialize(stream)
        }
      }
    }
  }
}

export namespace NET {
  export interface Serializable<T = any> {
    serialize(value: T, stream: ByteArray): void
    deserialize(stream: ByteArray): T
  }

  import ByteArray = SERDE.ByteArray
  const FRAG_MAX: number = 2048

  type Endpoint = string
  type Packet = Uint8Array
  type Listener = (header: Header, packet: Packet) => Generator<void, void, void>
  interface Header {
    guid: string
    index?: number
    final?: boolean
  }

  const Header: Serializable<Header> = Proto.Object({
    guid: Proto.String,
    index: Proto.Optional(Proto.VarInt),
    final: Proto.Optional(Proto.Boolean)
  })

  const endpoint_map = new Map<Endpoint, Array<Listener>>()

  system.afterEvents.scriptEventReceive.subscribe(event => {
    system.runJob(
      (function* () {
        const [serialized_endpoint, serialized_header] = event.id.split(':')

        const endpoint_stream: ByteArray = ByteArray.from_uint8array(
          SERDE.string_to_uint8array(serialized_endpoint).reverse()
        )
        const endpoint: Endpoint = Proto.String.deserialize(endpoint_stream)

        const listeners = endpoint_map.get(endpoint)
        if (event.sourceType === ScriptEventSource.Server && listeners) {
          const header_stream: ByteArray = ByteArray.from_uint8array(
            SERDE.string_to_uint8array(serialized_header).reverse()
          )
          const header: Header = Header.deserialize(header_stream)

          const packet: Packet = SERDE.string_to_uint8array(event.message).reverse()

          for (let i = 0; i < listeners.length; i++) {
            yield* listeners[i](header, packet)
          }
        }
      })()
    )
  })

  function create_listener(endpoint: Endpoint, listener: Listener) {
    let listeners = endpoint_map.get(endpoint)
    if (!listeners) {
      listeners = new Array<Listener>()
      endpoint_map.set(endpoint, listeners)
    }
    listeners.push(listener)

    return () => {
      const idx = listeners.indexOf(listener)
      if (idx !== -1) listeners.splice(idx, 1)

      if (listeners.length === 0) {
        endpoint_map.delete(endpoint)
      }
    }
  }

  function generate_id(): string {
    const r = (Math.random() * 0x100000000) >>> 0
    return (
      (r & 0xff).toString(16).padStart(2, '0') +
      ((r >> 8) & 0xff).toString(16).padStart(2, '0') +
      ((r >> 16) & 0xff).toString(16).padStart(2, '0') +
      ((r >> 24) & 0xff).toString(16).padStart(2, '0')
    ).toUpperCase()
  }

  export function* emit<T>(endpoint: string, serializer: Serializable<T>, value: T): Generator<void, void, void> {
    const guid = generate_id()

    const endpoint_stream = new ByteArray()
    Proto.String.serialize(endpoint, endpoint_stream)
    const serialized_endpoint = SERDE.uint8array_to_string(endpoint_stream.to_uint8array())

    const RUN = function* (header: Header, serialized_packet: string) {
      const header_stream = new SERDE.ByteArray()
      Header.serialize(header, header_stream)
      const serialized_header = SERDE.uint8array_to_string(header_stream.to_uint8array())
      world
        .getDimension('overworld')
        .runCommand(`scriptevent ${serialized_endpoint}:${serialized_header} ${serialized_packet}`)
    }

    const packet_stream = new ByteArray()
    serializer.serialize(value, packet_stream)
    const packet = packet_stream.to_uint8array()

    const packet_count = Math.ceil(packet.length / FRAG_MAX)

    for (let i = 0; i < packet_count; i++) {
      const start = i * FRAG_MAX
      const end = Math.min(start + FRAG_MAX, packet.length)
      const sub_bytes = packet.subarray(start, end)
      const sub_string = SERDE.uint8array_to_string(sub_bytes)

      if (packet_count === 1) yield* RUN({ guid }, sub_string)
      else if (i === packet_count - 1) yield* RUN({ guid, index: i, final: true }, sub_string)
      else yield* RUN({ guid, index: i }, sub_string)
    }
  }

  export function listen<T>(
    endpoint: string,
    serializer: Serializable<T>,
    callback: (value: T) => Generator<void, void, void>
  ) {
    const buffer = new Map<string, { size: number; packets: Packet[]; data_size: number }>()
    const listener: Listener = function* (payload: Header, packet: Packet): Generator<void, void, void> {
      if (payload.index === undefined) {
        const packet_stream = SERDE.ByteArray.from_uint8array(packet)
        const value = serializer.deserialize(packet_stream)
        yield* callback(value)
      } else {
        let fragment = buffer.get(payload.guid)
        if (!fragment) {
          fragment = { size: -1, packets: [], data_size: 0 }
          buffer.set(payload.guid, fragment)
        }
        if (payload.final) fragment.size = payload.index + 1

        fragment.packets[payload.index] = packet
        fragment.data_size += payload.index + 1

        if (fragment.size !== -1 && fragment.data_size === (fragment.size * (fragment.size + 1)) / 2) {
          let length = 0
          for (let i = 0; i < fragment.packets.length; i++) {
            length += fragment.packets[i].length
            yield
          }

          let bytes = new Uint8Array(length)
          let offset = 0
          for (let i = 0; i < fragment.packets.length; i++) {
            bytes.set(fragment.packets[i], offset)
            offset += fragment.packets[i].length
          }

          const stream = SERDE.ByteArray.from_uint8array(bytes)
          const value = serializer.deserialize(stream)
          yield* callback(value)

          buffer.delete(payload.guid)
        }
      }
    }
    return create_listener(endpoint, listener)
  }
}

namespace IPC {
  const ConnectionSerializer = Proto.Object({
    from: Proto.String,
    bytes: Proto.UInt8Array
  })
  const HandshakeSynchronizeSerializer = Proto.Object({
    from: Proto.String,
    encryption_enabled: Proto.Boolean,
    encryption_public_key: Proto.String,
    encryption_prime: Proto.VarInt,
    encryption_modulus: Proto.VarInt
  })
  const HandshakeAcknowledgeSerializer = Proto.Object({
    from: Proto.String,
    encryption_enabled: Proto.Boolean,
    encryption_public_key: Proto.String
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
        system.runJob(NET.emit(`ipc:${$._to}:terminate`, Proto.String, $._from))
      }
    }

    send<T>(channel: string, serializer: NET.Serializable<T>, value: T): void {
      const $ = this
      system.runJob(
        (function* () {
          const stream = new SERDE.ByteArray()
          serializer.serialize(value, stream)
          const bytes = yield* $.MAYBE_ENCRYPT(stream.to_uint8array())
          yield* NET.emit(`ipc:${$._to}:${channel}:send`, ConnectionSerializer, {
            from: $._from,
            bytes
          })
        })()
      )
    }

    invoke<T, R>(
      channel: string,
      serializer: NET.Serializable<T>,
      value: T,
      deserializer: NET.Serializable<R>
    ): Promise<R> {
      const $ = this
      system.runJob(
        (function* () {
          const stream = new SERDE.ByteArray()
          serializer.serialize(value, stream)
          const bytes = yield* $.MAYBE_ENCRYPT(stream.to_uint8array())
          yield* NET.emit(`ipc:${$._to}:${channel}:invoke`, ConnectionSerializer, {
            from: $._from,
            bytes
          })
        })()
      )

      return new Promise(resolve => {
        const terminate = NET.listen(`ipc:${$._from}:${channel}:handle`, ConnectionSerializer, function* (data) {
          if (data.from === $._to) {
            const bytes = yield* $.MAYBE_DECRYPT(data.bytes)
            const stream = SERDE.ByteArray.from_uint8array(bytes.reverse())
            const value = deserializer.deserialize(stream)
            resolve(value)
            terminate()
          }
        })
      })
    }

    on<T>(channel: string, deserializer: NET.Serializable<T>, listener: (value: T) => void) {
      const $ = this
      const terminate = NET.listen(`ipc:${$._from}:${channel}:send`, ConnectionSerializer, function* (data) {
        if (data.from === $._to) {
          const bytes = yield* $.MAYBE_DECRYPT(data.bytes)
          const stream = SERDE.ByteArray.from_uint8array(bytes.reverse())
          const value = deserializer.deserialize(stream)
          listener(value)
        }
      })
      $._terminators.push(terminate)
      return terminate
    }

    once<T>(channel: string, deserializer: NET.Serializable<T>, listener: (value: T) => void) {
      const $ = this
      const terminate = NET.listen(`ipc:${$._from}:${channel}:send`, ConnectionSerializer, function* (data) {
        if (data.from === $._to) {
          const bytes = yield* $.MAYBE_DECRYPT(data.bytes)
          const stream = SERDE.ByteArray.from_uint8array(bytes.reverse())
          const value = deserializer.deserialize(stream)
          listener(value)
          terminate()
        }
      })
      $._terminators.push(terminate)
      return terminate
    }

    handle<T, R>(
      channel: string,
      deserializer: NET.Serializable<T>,
      serializer: NET.Serializable<R>,
      listener: (value: T) => R
    ) {
      const $ = this
      const terminate = NET.listen(`ipc:${$._from}:${channel}:invoke`, ConnectionSerializer, function* (data) {
        if (data.from === $._to) {
          const bytes = yield* $.MAYBE_DECRYPT(data.bytes)
          const stream = SERDE.ByteArray.from_uint8array(bytes.reverse())
          const value = deserializer.deserialize(stream)
          const result = listener(value)
          const return_stream = new SERDE.ByteArray()
          serializer.serialize(result, return_stream)
          const return_bytes = yield* $.MAYBE_ENCRYPT(return_stream.to_uint8array())
          yield* NET.emit(`ipc:${$._to}:${channel}:handle`, ConnectionSerializer, {
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

      NET.listen(`ipc:${this._id}:terminate`, Proto.String, function* (value) {
        $._enc_map.delete(value)
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
          system.runJob(
            (function* () {
              const public_key = yield* CRYPTO.make_public(secret)
              yield* NET.emit(`ipc:${to}:handshake:synchronize`, HandshakeSynchronizeSerializer, {
                from: $._id,
                encryption_enabled: encrypted,
                encryption_public_key: public_key,
                encryption_prime: CRYPTO.PRIME,
                encryption_modulus: CRYPTO.MOD
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
                    ? yield* CRYPTO.make_shared(secret, data.encryption_public_key)
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

    send<T>(channel: string, serializer: NET.Serializable<T>, value: T): void {
      const $ = this
      system.runJob(
        (function* () {
          for (const [key, enc] of $._enc_map) {
            const stream = new SERDE.ByteArray()
            serializer.serialize(value, stream)
            const bytes = yield* $.MAYBE_ENCRYPT(stream.to_uint8array(), enc)
            yield* NET.emit(`ipc:${key}:${channel}:send`, ConnectionSerializer, {
              from: $._id,
              bytes
            })
          }
        })()
      )
    }

    invoke<T, R>(
      channel: string,
      serializer: NET.Serializable<T>,
      value: T,
      deserializer: NET.Serializable<R>
    ): Promise<R>[] {
      const $ = this
      const promises: Promise<any>[] = []

      for (const [key, enc] of $._enc_map) {
        system.runJob(
          (function* () {
            const stream = new SERDE.ByteArray()
            serializer.serialize(value, stream)
            const bytes = yield* $.MAYBE_ENCRYPT(stream.to_uint8array(), enc)
            yield* NET.emit(`ipc:${key}:${channel}:invoke`, ConnectionSerializer, {
              from: $._id,
              bytes
            })
          })()
        )

        promises.push(
          new Promise(resolve => {
            const terminate = NET.listen(`ipc:${$._id}:${channel}:handle`, ConnectionSerializer, function* (data) {
              if (data.from === key) {
                const bytes = yield* $.MAYBE_DECRYPT(data.bytes, enc)
                const stream = SERDE.ByteArray.from_uint8array(bytes.reverse())
                const value = deserializer.deserialize(stream)
                resolve(value)
                terminate()
              }
            })
          })
        )
      }
      return promises
    }

    on<T>(channel: string, deserializer: NET.Serializable<T>, listener: (value: T) => void) {
      const $ = this
      return NET.listen(`ipc:${$._id}:${channel}:send`, ConnectionSerializer, function* (data) {
        const enc = $._enc_map.get(data.from) as string | false
        if (enc !== undefined) {
          const bytes = yield* $.MAYBE_DECRYPT(data.bytes, enc)
          const stream = SERDE.ByteArray.from_uint8array(bytes.reverse())
          const value = deserializer.deserialize(stream)
          listener(value)
        }
      })
    }

    once<T>(channel: string, deserializer: NET.Serializable<T>, listener: (value: T) => void) {
      const $ = this
      const terminate = NET.listen(`ipc:${$._id}:${channel}:send`, ConnectionSerializer, function* (data) {
        const enc = $._enc_map.get(data.from) as string | false
        if (enc !== undefined) {
          const bytes = yield* $.MAYBE_DECRYPT(data.bytes, enc)
          const stream = SERDE.ByteArray.from_uint8array(bytes.reverse())
          const value = deserializer.deserialize(stream)
          listener(value)
          terminate()
        }
      })
      return terminate
    }

    handle<T, R>(
      channel: string,
      deserializer: NET.Serializable<T>,
      serializer: NET.Serializable<R>,
      listener: (value: T) => R
    ) {
      const $ = this
      return NET.listen(`ipc:${$._id}:${channel}:invoke`, ConnectionSerializer, function* (data) {
        const enc = $._enc_map.get(data.from) as string | false
        if (enc !== undefined) {
          const input_bytes = yield* $.MAYBE_DECRYPT(data.bytes, enc)
          const input_stream = SERDE.ByteArray.from_uint8array(input_bytes.reverse())
          const input_value = deserializer.deserialize(input_stream)
          const result = listener(input_value)
          const output_stream = new SERDE.ByteArray()
          serializer.serialize(result, output_stream)
          const output_bytes = yield* $.MAYBE_ENCRYPT(output_stream.to_uint8array(), enc)
          yield* NET.emit(`ipc:${data.from}:${channel}:handle`, ConnectionSerializer, {
            from: $._id,
            bytes: output_bytes
          })
        }
      })
    }
  }

  /** Sends a message with `args` to `channel` */
  export function send<T>(channel: string, serializer: NET.Serializable<T>, value: T): void {
    system.runJob(NET.emit(`ipc:${channel}:send`, serializer, value))
  }

  /** Sends an `invoke` message through IPC, and expects a result asynchronously. */
  export function invoke<T, R>(
    channel: string,
    serializer: NET.Serializable<T>,
    value: T,
    deserializer: NET.Serializable<R>
  ): Promise<R> {
    system.runJob(NET.emit(`ipc:${channel}:invoke`, serializer, value))
    return new Promise(resolve => {
      const terminate = NET.listen(`ipc:${channel}:handle`, deserializer, function* (value) {
        resolve(value)
        terminate()
      })
    })
  }

  /** Listens to `channel`. When a new message arrives, `listener` will be called with `listener(args)`. */
  export function on<T>(channel: string, deserializer: NET.Serializable<T>, listener: (value: T) => void): () => void {
    return NET.listen(`ipc:${channel}:send`, deserializer, function* (value) {
      listener(value)
    })
  }

  /** Listens to `channel` once. When a new message arrives, `listener` will be called with `listener(args)`, and then removed. */
  export function once<T>(channel: string, deserializer: NET.Serializable<T>, listener: (value: T) => void) {
    const terminate = NET.listen(`ipc:${channel}:send`, deserializer, function* (value) {
      listener(value)
      terminate()
    })
    return terminate
  }

  /** Adds a handler for an `invoke` IPC. This handler will be called whenever `invoke(channel, ...args)` is called */
  export function handle<T, R>(
    channel: string,
    deserializer: NET.Serializable<T>,
    serializer: NET.Serializable<R>,
    listener: (value: T) => R
  ): () => void {
    return NET.listen(`ipc:${channel}:invoke`, deserializer, function* (value) {
      const result = listener(value)
      yield* NET.emit(`ipc:${channel}:handle`, serializer, result)
    })
  }
}

export default IPC
