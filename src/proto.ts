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

export namespace PROTO {
  export interface Serializable<T> {
    serialize(value: T, stream: ByteQueue): Generator<void, void, void>
    deserialize(stream: ByteQueue): Generator<void, T, void>
  }
  export class ByteQueue {
    private _buffer: Uint8Array
    private _data_view: DataView
    private _length: number
    private _offset: number

    get end() {
      return this._length + this._offset
    }

    get front() {
      return this._offset
    }

    get data_view() {
      return this._data_view
    }

    constructor(size: number = 256) {
      this._buffer = new Uint8Array(size)
      this._data_view = new DataView(this._buffer.buffer)
      this._length = 0
      this._offset = 0
    }

    write(...values: number[]): void {
      this.ensure_capacity(values.length)
      this._buffer.set(values, this.end)
      this._length += values.length
    }

    read(amount: number = 1): number[] {
      if (this._length > 0) {
        const max_amount = amount > this._length ? this._length : amount
        const values = this._buffer.subarray(this._offset, this._offset + max_amount)
        this._length -= max_amount
        this._offset += max_amount
        return globalThis.Array.from(values)
      }
      return []
    }

    ensure_capacity(size: number) {
      if (this.end + size > this._buffer.length) {
        const larger_buffer = new Uint8Array((this.end + size) * 2)
        larger_buffer.set(this._buffer.subarray(this._offset, this.end), 0)
        this._buffer = larger_buffer
        this._offset = 0
        this._data_view = new DataView(this._buffer.buffer)
      }
    }

    static from_uint8array(array: Uint8Array) {
      const byte_queue = new ByteQueue()
      byte_queue._buffer = array
      byte_queue._length = array.length
      byte_queue._offset = 0
      byte_queue._data_view = new DataView(array.buffer)
      return byte_queue
    }

    to_uint8array() {
      return this._buffer.subarray(this._offset, this.end)
    }
  }
  export namespace MIPS {
    export function* serialize(byte_queue: PROTO.ByteQueue): Generator<void, string, void> {
      const uint8array = byte_queue.to_uint8array()

      let str = '(0x'
      for (let i = 0; i < uint8array.length; i++) {
        const hex = uint8array[i].toString(16).padStart(2, '0').toUpperCase()
        str += hex
        yield
      }
      str += ')'
      return str
    }
    export function* deserialize(str: string): Generator<void, PROTO.ByteQueue, void> {
      if (str.startsWith('(0x') && str.endsWith(')')) {
        const result = []
        const hex_str = str.slice(3, str.length - 1)
        for (let i = 0; i < hex_str.length; i++) {
          const hex = hex_str[i] + hex_str[++i]
          result.push(parseInt(hex, 16))
          yield
        }
        return ByteQueue.from_uint8array(new Uint8Array(result))
      }
      return new ByteQueue()
    }
  }
  export const Void: PROTO.Serializable<void> = {
    *serialize() {},
    *deserialize() {}
  }
  export const Null: PROTO.Serializable<null> = {
    *serialize() {},
    *deserialize() {
      return null
    }
  }
  export const Undefined: PROTO.Serializable<undefined> = {
    *serialize() {},
    *deserialize() {
      return undefined
    }
  }
  export const Int8: PROTO.Serializable<number> = {
    *serialize(value, stream) {
      const length = 1
      stream.write(...globalThis.Array(length).fill(0))
      stream.data_view.setInt8(stream.end - length, value)
    },
    *deserialize(stream) {
      const value = stream.data_view.getInt8(stream.front)
      stream.read(1)
      return value
    }
  }
  export const Int16: PROTO.Serializable<number> = {
    *serialize(value, stream) {
      const length = 2
      stream.write(...globalThis.Array(length).fill(0))
      stream.data_view.setInt16(stream.end - length, value)
    },
    *deserialize(stream) {
      const value = stream.data_view.getInt16(stream.front)
      stream.read(2)
      return value
    }
  }
  export const Int32: PROTO.Serializable<number> = {
    *serialize(value, stream) {
      const length = 4
      stream.write(...globalThis.Array(length).fill(0))
      stream.data_view.setInt32(stream.end - length, value)
    },
    *deserialize(stream) {
      const value = stream.data_view.getInt32(stream.front)
      stream.read(4)
      return value
    }
  }
  export const UInt8: PROTO.Serializable<number> = {
    *serialize(value, stream) {
      const length = 1
      stream.write(...globalThis.Array(length).fill(0))
      stream.data_view.setUint8(stream.end - length, value)
    },
    *deserialize(stream) {
      const value = stream.data_view.getUint8(stream.front)
      stream.read(1)
      return value
    }
  }
  export const UInt16: PROTO.Serializable<number> = {
    *serialize(value, stream) {
      const length = 2
      stream.write(...globalThis.Array(length).fill(0))
      stream.data_view.setUint16(stream.end - length, value)
    },
    *deserialize(stream) {
      const value = stream.data_view.getUint16(stream.front)
      stream.read(2)
      return value
    }
  }
  export const UInt32: PROTO.Serializable<number> = {
    *serialize(value, stream) {
      const length = 4
      stream.write(...globalThis.Array(length).fill(0))
      stream.data_view.setUint32(stream.end - length, value)
    },
    *deserialize(stream) {
      const value = stream.data_view.getUint32(stream.front)
      stream.read(4)
      return value
    }
  }
  export const UVarInt32: PROTO.Serializable<number> = {
    *serialize(value, stream) {
      while (value >= 0x80) {
        stream.write((value & 0x7f) | 0x80)
        value >>= 7
        yield
      }
      stream.write(value)
    },
    *deserialize(stream) {
      let value = 0
      let size = 0
      let byte
      do {
        byte = stream.read()[0]
        value |= (byte & 0x7f) << (size * 7)
        size += 1
        yield
      } while ((byte & 0x80) !== 0 && size < 10)
      return value
    }
  }
  export const Float32: PROTO.Serializable<number> = {
    *serialize(value, stream) {
      const length = 4
      stream.write(...globalThis.Array(length).fill(0))
      stream.data_view.setFloat32(stream.end - length, value)
    },
    *deserialize(stream) {
      const value = stream.data_view.getFloat32(stream.front)
      stream.read(4)
      return value
    }
  }
  export const Float64: PROTO.Serializable<number> = {
    *serialize(value, stream) {
      const length = 8
      stream.write(...globalThis.Array(length).fill(0))
      stream.data_view.setFloat64(stream.end - length, value)
    },
    *deserialize(stream) {
      const value = stream.data_view.getFloat64(stream.front)
      stream.read(8)
      return value
    }
  }
  export const String: PROTO.Serializable<string> = {
    *serialize(value, stream) {
      yield* PROTO.UVarInt32.serialize(value.length, stream)
      for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i)
        yield* PROTO.UVarInt32.serialize(code, stream)
      }
    },
    *deserialize(stream) {
      const length = yield* PROTO.UVarInt32.deserialize(stream)
      let value = ''
      for (let i = 0; i < length; i++) {
        const code = yield* PROTO.UVarInt32.deserialize(stream)
        value += globalThis.String.fromCharCode(code)
      }
      return value
    }
  }
  export const Boolean: PROTO.Serializable<boolean> = {
    *serialize(value, stream) {
      stream.write(value ? 1 : 0)
    },
    *deserialize(stream) {
      const value = stream.read()[0]!
      return value === 1
    }
  }
  export const UInt8Array: PROTO.Serializable<Uint8Array> = {
    *serialize(value: Uint8Array, stream: ByteQueue) {
      yield* PROTO.UVarInt32.serialize(value.length, stream)
      stream.write(...value)
    },
    *deserialize(stream: ByteQueue) {
      const length = yield* PROTO.UVarInt32.deserialize(stream)
      return new Uint8Array(stream.read(length))
    }
  }
  export const Date: PROTO.Serializable<Date> = {
    *serialize(value: Date, stream: ByteQueue) {
      yield* PROTO.Float64.serialize(value.getTime(), stream)
    },
    *deserialize(stream: ByteQueue) {
      return new globalThis.Date(yield* PROTO.Float64.deserialize(stream))
    }
  }
  export function Object<T extends object>(obj: { [K in keyof T]: PROTO.Serializable<T[K]> }): PROTO.Serializable<T> {
    return {
      *serialize(value, stream) {
        for (const key in obj) {
          yield* obj[key].serialize(value[key], stream)
        }
      },
      *deserialize(stream) {
        const result: Partial<T> = {}
        for (const key in obj) {
          result[key] = yield* obj[key].deserialize(stream)
        }
        return result as T
      }
    }
  }
  export function Array<T>(value: PROTO.Serializable<T>): PROTO.Serializable<T[]> {
    return {
      *serialize(array, stream) {
        yield* PROTO.UVarInt32.serialize(array.length, stream)
        for (const item of array) {
          yield* value.serialize(item, stream)
        }
      },
      *deserialize(stream) {
        const result: T[] = []
        const length = yield* PROTO.UVarInt32.deserialize(stream)
        for (let i = 0; i < length; i++) {
          result[i] = yield* value.deserialize(stream)
        }
        return result
      }
    }
  }
  export function Tuple<T extends any[]>(
    ...values: { [K in keyof T]: PROTO.Serializable<T[K]> }
  ): PROTO.Serializable<T> {
    return {
      *serialize(tuple, stream) {
        for (let i = 0; i < values.length; i++) {
          yield* values[i].serialize(tuple[i], stream)
        }
      },
      *deserialize(stream) {
        const result: any[] = []
        for (let i = 0; i < values.length; i++) {
          result[i] = yield* values[i].deserialize(stream)
        }
        return result as T
      }
    }
  }
  export function Optional<T>(value: PROTO.Serializable<T>): PROTO.Serializable<T | undefined> {
    return {
      *serialize(optional, stream) {
        yield* PROTO.Boolean.serialize(value !== undefined, stream)
        if (optional !== undefined) {
          yield* value.serialize(optional, stream)
        }
      },
      *deserialize(stream) {
        const defined = yield* PROTO.Boolean.deserialize(stream)
        if (defined) {
          return yield* value.deserialize(stream)
        }
        return undefined
      }
    }
  }
  export function Map<K, V>(key: PROTO.Serializable<K>, value: PROTO.Serializable<V>): PROTO.Serializable<Map<K, V>> {
    return {
      *serialize(map, stream) {
        yield* PROTO.UVarInt32.serialize(map.size, stream)
        for (const [k, v] of map.entries()) {
          yield* key.serialize(k, stream)
          yield* value.serialize(v, stream)
        }
      },
      *deserialize(stream) {
        const size = yield* PROTO.UVarInt32.deserialize(stream)
        const result = new globalThis.Map<K, V>()
        for (let i = 0; i < size; i++) {
          const k = yield* key.deserialize(stream)
          const v = yield* value.deserialize(stream)
          result.set(k, v)
        }
        return result
      }
    }
  }
  export function Set<V>(value: PROTO.Serializable<V>): PROTO.Serializable<Set<V>> {
    return {
      *serialize(set, stream) {
        yield* PROTO.UVarInt32.serialize(set.size, stream)
        for (const [_, v] of set.entries()) {
          yield* value.serialize(v, stream)
        }
      },
      *deserialize(stream) {
        const size = yield* PROTO.UVarInt32.deserialize(stream)
        const result = new globalThis.Set<V>()
        for (let i = 0; i < size; i++) {
          const v = yield* value.deserialize(stream)
          result.add(v)
        }
        return result
      }
    }
  }
  export type Endpoint = string
  export type Header = {
    guid: string
    encoding: string
    index: number
    final: boolean
  }
  export const Endpoint: PROTO.Serializable<Endpoint> = PROTO.String
  export const Header: PROTO.Serializable<Header> = PROTO.Object<Header>({
    guid: PROTO.String,
    encoding: PROTO.String,
    index: PROTO.UVarInt32,
    final: PROTO.Boolean
  })
}
