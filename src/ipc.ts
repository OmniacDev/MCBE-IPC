/**
 * @license
 * MIT License
 *
 * Copyright (c) 2026 OmniacDev
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

import { ScriptEventSource, system } from '@minecraft/server';

namespace UTIL {
  export function generate_id(): string {
    const r = (Math.random() * 0x100000000) >>> 0;
    return r.toString(16).padStart(8, '0').toUpperCase();
  }
}

export namespace PROTO {
  export interface Serializer<T> {
    serialize(value: T, stream: Buffer): Generator<void, void, void>;
  }

  export interface Deserializer<T> {
    deserialize(stream: Buffer): Generator<void, T, void>;
  }

  type Guarded<T, Guard extends boolean> = Guard extends true
    ? { is(value: unknown): value is T }
    : { is?(value: unknown): value is T };

  namespace Guarded {
    export function is<T>(s: PROTO.Serializable<T, boolean>, value: unknown): value is T {
      return s.is?.(value) ?? false;
    }
  }

  export type Serializable<T, Guard extends boolean = false> = Serializer<T> & Deserializer<T> & Guarded<T, Guard>;

  export class Buffer {
    private _buffer: Uint8Array;
    private _data_view: DataView;
    private _length: number;
    private _offset: number;

    get end() {
      return this._length + this._offset;
    }

    get front() {
      return this._offset;
    }

    get data_view() {
      return this._data_view;
    }

    constructor(size: number = 256) {
      this._buffer = new Uint8Array(size);
      this._data_view = new DataView(this._buffer.buffer);
      this._length = 0;
      this._offset = 0;
    }

    reserve(amount: number): number {
      this.ensure_capacity(amount);

      const end = this.end;
      this._length += amount;
      return end;
    }

    consume(amount: number): number {
      if (amount > this._length) throw new Error('not enough bytes');

      const front = this.front;
      this._length -= amount;
      this._offset += amount;
      return front;
    }

    write(byte: number): void;
    write(bytes: Uint8Array): void;
    write(input: number | Uint8Array): void {
      if (typeof input === 'number') {
        const offset = this.reserve(1);
        this._buffer[offset] = input;
      } else {
        const offset = this.reserve(input.length);
        this._buffer.set(input, offset);
      }
    }

    read(): number;
    read(amount: number): Uint8Array;
    read(amount?: number): number | Uint8Array {
      if (amount === undefined) {
        const offset = this.consume(1);
        return this._buffer[offset];
      } else {
        const offset = this.consume(amount);
        return this._buffer.slice(offset, offset + amount);
      }
    }

    ensure_capacity(size: number) {
      if (this.end + size > this._buffer.length) {
        const larger_buffer = new Uint8Array((this.end + size) * 2);
        larger_buffer.set(this._buffer.subarray(this._offset, this.end), 0);
        this._buffer = larger_buffer;
        this._offset = 0;
        this._data_view = new DataView(this._buffer.buffer);
      }
    }

    static from_uint8array(array: Uint8Array) {
      const buffer = new Buffer();
      buffer._buffer = array;
      buffer._length = array.length;
      buffer._offset = 0;
      buffer._data_view = new DataView(array.buffer);
      return buffer;
    }

    to_uint8array() {
      return this._buffer.subarray(this._offset, this.end);
    }
  }

  export namespace MIPS {
    export function is_valid(str: string): boolean {
      return str.startsWith('(0x') && str.endsWith(')');
    }

    export function* serialize(stream: PROTO.Buffer): Generator<void, string, void> {
      const uint8array = stream.to_uint8array();

      let str = '(0x';
      for (let i = 0; i < uint8array.length; i++) {
        const hex = uint8array[i].toString(16).padStart(2, '0').toUpperCase();
        str += hex;
        yield;
      }
      str += ')';
      return str;
    }
    export function* deserialize(str: string): Generator<void, PROTO.Buffer, void> {
      if (is_valid(str)) {
        const buffer = new Buffer();
        const hex_str = str.slice(3, str.length - 1);
        for (let i = 0; i < hex_str.length; i++) {
          const hex = hex_str[i] + hex_str[++i];
          buffer.write(parseInt(hex, 16));
          yield;
        }
        return buffer;
      }
      return new Buffer();
    }
  }

  export const Void: PROTO.Serializable<void, true> = {
    is: (value: unknown): value is void => value === undefined,
    *serialize() {},
    *deserialize() {}
  };

  export const Null: PROTO.Serializable<null, true> = {
    is: (value: unknown): value is null => value === null,
    *serialize() {},
    *deserialize() {
      return null;
    }
  };

  export const Undefined: PROTO.Serializable<undefined, true> = {
    is: (value: unknown): value is undefined => value === undefined,
    *serialize() {},
    *deserialize() {
      return undefined;
    }
  };

  export const Int8: PROTO.Serializable<number, true> = {
    is: (value: unknown): value is number =>
      typeof value === 'number' && Number.isInteger(value) && value >= -128 && value <= 127,
    *serialize(value: number, stream: Buffer) {
      stream.data_view.setInt8(stream.reserve(1), value);
    },
    *deserialize(stream: Buffer): Generator<void, number, void> {
      return stream.data_view.getInt8(stream.consume(1));
    }
  };

  export const Int16: PROTO.Serializable<number, true> = {
    is: (value: unknown): value is number =>
      typeof value === 'number' && Number.isInteger(value) && value >= -32768 && value <= 32767,
    *serialize(value: number, stream: Buffer) {
      stream.data_view.setInt16(stream.reserve(2), value);
    },
    *deserialize(stream: Buffer): Generator<void, number, void> {
      return stream.data_view.getInt16(stream.consume(2));
    }
  };

  export const Int32: PROTO.Serializable<number, true> = {
    is: (value: unknown): value is number =>
      typeof value === 'number' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647,
    *serialize(value: number, stream: Buffer) {
      stream.data_view.setInt32(stream.reserve(4), value);
    },
    *deserialize(stream: Buffer): Generator<void, number, void> {
      return stream.data_view.getInt32(stream.consume(4));
    }
  };

  export const UInt8: PROTO.Serializable<number, true> = {
    is: (value: unknown): value is number =>
      typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255,
    *serialize(value: number, stream: Buffer) {
      stream.data_view.setUint8(stream.reserve(1), value);
    },
    *deserialize(stream: Buffer): Generator<void, number, void> {
      return stream.data_view.getUint8(stream.consume(1));
    }
  };

  export const UInt16: PROTO.Serializable<number, true> = {
    is: (value: unknown): value is number =>
      typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 65535,
    *serialize(value: number, stream: Buffer) {
      stream.data_view.setUint16(stream.reserve(2), value);
    },
    *deserialize(stream: Buffer): Generator<void, number, void> {
      return stream.data_view.getUint16(stream.consume(2));
    }
  };

  export const UInt32: PROTO.Serializable<number, true> = {
    is: (value: unknown): value is number =>
      typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4294967295,
    *serialize(value: number, stream: Buffer) {
      stream.data_view.setUint32(stream.reserve(4), value);
    },
    *deserialize(stream: Buffer): Generator<void, number, void> {
      return stream.data_view.getUint32(stream.consume(4));
    }
  };

  export const UVarInt32: PROTO.Serializable<number, true> = {
    is: (value: unknown): value is number =>
      typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4294967295,
    *serialize(value: number, stream: Buffer) {
      value >>>= 0;
      while (value >= 0x80) {
        stream.write((value & 0x7f) | 0x80);
        value >>>= 7;
        yield;
      }
      stream.write(value);
    },
    *deserialize(stream: Buffer): Generator<void, number, void> {
      let value = 0;
      for (let size = 0; size < 5; size++) {
        const byte = stream.read();
        value |= (byte & 0x7f) << (size * 7);
        yield;
        if ((byte & 0x80) == 0) break;
      }
      return value >>> 0;
    }
  };

  export const VarInt32: PROTO.Serializable<number, true> = {
    is: (value: unknown): value is number =>
      typeof value === 'number' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647,
    *serialize(value: number, stream: Buffer) {
      const zigzag = (value << 1) ^ (value >> 31);
      yield* PROTO.UVarInt32.serialize(zigzag, stream);
    },
    *deserialize(stream: Buffer): Generator<void, number, void> {
      const zigzag = yield* PROTO.UVarInt32.deserialize(stream);
      return (zigzag >>> 1) ^ -(zigzag & 1);
    }
  };

  export const Float32: PROTO.Serializable<number, true> = {
    is: (value: unknown): value is number => typeof value === 'number' && Math.fround(value) === value,
    *serialize(value: number, stream: Buffer): Generator<void, void, void> {
      stream.data_view.setFloat32(stream.reserve(4), value);
    },
    *deserialize(stream: Buffer): Generator<void, number, void> {
      return stream.data_view.getFloat32(stream.consume(4));
    }
  };

  export const Float64: PROTO.Serializable<number, true> = {
    is: (value: unknown): value is number => typeof value === 'number',
    *serialize(value: number, stream: Buffer): Generator<void, void, void> {
      stream.data_view.setFloat64(stream.reserve(8), value);
    },
    *deserialize(stream: Buffer): Generator<void, number, void> {
      return stream.data_view.getFloat64(stream.consume(8));
    }
  };

  export const String: PROTO.Serializable<string, true> = {
    is: (value: unknown): value is string => typeof value === 'string',
    *serialize(value: string, stream: Buffer): Generator<void, void, void> {
      yield* PROTO.UVarInt32.serialize(value.length, stream);
      for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        yield* PROTO.UVarInt32.serialize(code, stream);
      }
    },
    *deserialize(stream: Buffer): Generator<void, string, void> {
      const length = yield* PROTO.UVarInt32.deserialize(stream);
      let value = '';
      for (let i = 0; i < length; i++) {
        const code = yield* PROTO.UVarInt32.deserialize(stream);
        value += globalThis.String.fromCharCode(code);
      }
      return value;
    }
  };

  export const Boolean: PROTO.Serializable<boolean, true> = {
    is: (value: unknown): value is boolean => typeof value === 'boolean',
    *serialize(value: boolean, stream: Buffer): Generator<void, void, void> {
      stream.write(value ? 1 : 0);
    },
    *deserialize(stream: Buffer): Generator<void, boolean, void> {
      return stream.read() !== 0;
    }
  };

  export const UInt8Array: PROTO.Serializable<Uint8Array, true> = {
    is: (value: unknown): value is Uint8Array => value instanceof Uint8Array,
    *serialize(value: Uint8Array, stream: Buffer): Generator<void, void, void> {
      yield* PROTO.UVarInt32.serialize(value.length, stream);
      stream.write(value);
    },
    *deserialize(stream: Buffer): Generator<void, Uint8Array, void> {
      const length = yield* PROTO.UVarInt32.deserialize(stream);
      return stream.read(length);
    }
  };

  export const Date: PROTO.Serializable<Date, true> = {
    is: (value: unknown): value is Date => value instanceof globalThis.Date,
    *serialize(value: Date, stream: Buffer): Generator<void, void, void> {
      yield* PROTO.Float64.serialize(value.getTime(), stream);
    },
    *deserialize(stream: Buffer): Generator<void, Date, void> {
      return new globalThis.Date(yield* PROTO.Float64.deserialize(stream));
    }
  };

  export function Object<T extends object>(s: { [K in keyof T]: PROTO.Serializable<T[K], true> }): PROTO.Serializable<
    T,
    true
  >;
  export function Object<T extends object>(s: { [K in keyof T]: PROTO.Serializable<T[K]> }): PROTO.Serializable<T>;
  export function Object<T extends object, Guard extends boolean>(s: {
    [K in keyof T]: PROTO.Serializable<T[K], Guard>;
  }): PROTO.Serializable<T, Guard>;
  export function Object(s: Record<any, PROTO.Serializable<any>>): PROTO.Serializable<Record<any, any>> {
    return {
      is(value: unknown): value is Record<any, any> {
        return (
          !globalThis.Array.isArray(value) &&
          typeof value === 'object' &&
          value !== null &&
          globalThis.Object.entries(s).every(([k, v]) => k in value && Guarded.is(v, (value as Record<any, any>)[k]))
        );
      },
      *serialize(value: Record<any, any>, stream: Buffer): Generator<void, void, void> {
        for (const key in s) {
          yield* s[key].serialize(value[key], stream);
        }
      },
      *deserialize(stream: Buffer): Generator<void, Record<any, any>, void> {
        const result: Record<any, any> = {};
        for (const key in s) {
          result[key] = yield* s[key].deserialize(stream);
        }
        return result;
      }
    };
  }

  export function Array<T>(s: PROTO.Serializable<T, true>): PROTO.Serializable<T[], true>;
  export function Array<T>(s: PROTO.Serializable<T>): PROTO.Serializable<T[]>;
  export function Array<T, Guard extends boolean>(s: PROTO.Serializable<T, Guard>): PROTO.Serializable<T[], Guard>;
  export function Array(s: PROTO.Serializable<any>): PROTO.Serializable<any[]> {
    return {
      is(value: unknown): value is any[] {
        return globalThis.Array.isArray(value) && value.every(e => Guarded.is(s, e));
      },
      *serialize(value: any[], stream: Buffer): Generator<void, void, void> {
        yield* PROTO.UVarInt32.serialize(value.length, stream);
        for (const item of value) {
          yield* s.serialize(item, stream);
        }
      },
      *deserialize(stream: Buffer): Generator<void, any[], void> {
        const result: any[] = [];
        const length = yield* PROTO.UVarInt32.deserialize(stream);
        for (let i = 0; i < length; i++) {
          result[i] = yield* s.deserialize(stream);
        }
        return result;
      }
    };
  }

  export function Tuple<T extends any[]>(
    ...s: { [K in keyof T]: PROTO.Serializable<T[K], true> }
  ): PROTO.Serializable<T, true>;
  export function Tuple<T extends any[]>(...s: { [K in keyof T]: PROTO.Serializable<T[K]> }): PROTO.Serializable<T>;
  export function Tuple<T extends any[], Guard extends boolean>(
    ...s: { [K in keyof T]: PROTO.Serializable<T[K], Guard> }
  ): PROTO.Serializable<T, Guard>;
  export function Tuple(...s: PROTO.Serializable<any>[]): PROTO.Serializable<any[]> {
    return {
      is(value: unknown): value is any[] {
        return (
          globalThis.Array.isArray(value) && value.length === s.length && value.every((v, i) => Guarded.is(s[i], v))
        );
      },
      *serialize(value: any[], stream: Buffer): Generator<void, void, void> {
        for (let i = 0; i < s.length; i++) {
          yield* s[i].serialize(value[i], stream);
        }
      },
      *deserialize(stream: Buffer): Generator<void, any[], void> {
        const result: any[] = [];
        for (let i = 0; i < s.length; i++) {
          result[i] = yield* s[i].deserialize(stream);
        }
        return result;
      }
    };
  }

  export function Optional<T>(s: PROTO.Serializable<T, true>): PROTO.Serializable<T | undefined, true>;
  export function Optional<T>(s: PROTO.Serializable<T>): PROTO.Serializable<T | undefined>;
  export function Optional<T, Guard extends boolean>(
    s: PROTO.Serializable<T, Guard>
  ): PROTO.Serializable<T | undefined, Guard>;
  export function Optional(s: PROTO.Serializable<any>): PROTO.Serializable<any | undefined> {
    return {
      is(value: unknown): value is any | undefined {
        return value === undefined || Guarded.is(s, value);
      },
      *serialize(value: any | undefined, stream: Buffer): Generator<void, void, void> {
        const def = value !== undefined;
        yield* PROTO.Boolean.serialize(def, stream);
        if (def) yield* s.serialize(value, stream);
      },
      *deserialize(stream: Buffer): Generator<void, any | undefined, void> {
        const def = yield* PROTO.Boolean.deserialize(stream);
        if (def) return yield* s.deserialize(stream);
        return undefined;
      }
    };
  }

  export function Map<K, V>(
    kS: PROTO.Serializable<K, true>,
    vS: PROTO.Serializable<V, true>
  ): PROTO.Serializable<Map<K, V>, true>;
  export function Map<K, V>(kS: PROTO.Serializable<K>, vS: PROTO.Serializable<V>): PROTO.Serializable<Map<K, V>>;
  export function Map<K, V, Guard extends boolean>(
    kS: PROTO.Serializable<K, Guard>,
    vS: PROTO.Serializable<V, Guard>
  ): PROTO.Serializable<Map<K, V>, Guard>;
  export function Map(kS: PROTO.Serializable<any>, vS: PROTO.Serializable<any>): PROTO.Serializable<Map<any, any>> {
    return {
      is(value: unknown): value is Map<any, any> {
        if (!(value instanceof globalThis.Map)) return false;
        for (const [k, v] of value) {
          if (!Guarded.is(kS, k) || !Guarded.is(vS, v)) return false;
        }
        return true;
      },
      *serialize(value: Map<any, any>, stream: Buffer): Generator<void, void, void> {
        yield* PROTO.UVarInt32.serialize(value.size, stream);
        for (const [k, v] of value) {
          yield* kS.serialize(k, stream);
          yield* vS.serialize(v, stream);
        }
      },
      *deserialize(stream: Buffer): Generator<void, Map<any, any>, void> {
        const size = yield* PROTO.UVarInt32.deserialize(stream);
        const result = new globalThis.Map<any, any>();
        for (let i = 0; i < size; i++) {
          const k = yield* kS.deserialize(stream);
          const v = yield* vS.deserialize(stream);
          result.set(k, v);
        }
        return result;
      }
    };
  }

  export function Set<V>(s: PROTO.Serializable<V, true>): PROTO.Serializable<Set<V>, true>;
  export function Set<V>(s: PROTO.Serializable<V>): PROTO.Serializable<Set<V>>;
  export function Set<V, Guard extends boolean>(s: PROTO.Serializable<V, Guard>): PROTO.Serializable<Set<V>, Guard>;
  export function Set(s: PROTO.Serializable<any>): PROTO.Serializable<Set<any>> {
    return {
      is(value: unknown): value is Set<any> {
        if (!(value instanceof globalThis.Set)) return false;
        for (const v of value) {
          if (!Guarded.is(s, v)) return false;
        }
        return true;
      },
      *serialize(set: Set<any>, stream: Buffer): Generator<void, void, void> {
        yield* PROTO.UVarInt32.serialize(set.size, stream);
        for (const v of set) {
          yield* s.serialize(v, stream);
        }
      },
      *deserialize(stream: Buffer): Generator<void, Set<any>, void> {
        const size = yield* PROTO.UVarInt32.deserialize(stream);
        const result = new globalThis.Set<any>();
        for (let i = 0; i < size; i++) {
          const v = yield* s.deserialize(stream);
          result.add(v);
        }
        return result;
      }
    };
  }

  export function Record<V>(vS: PROTO.Serializable<V, true>): PROTO.Serializable<Record<string, V>, true>;
  export function Record<V>(vS: PROTO.Serializable<V>): PROTO.Serializable<Record<string, V>>;
  export function Record<V, Guard extends boolean>(
    vS: PROTO.Serializable<V, Guard>
  ): PROTO.Serializable<Record<string, V>, Guard>;
  export function Record(vS: PROTO.Serializable<any>): PROTO.Serializable<Record<string, any>> {
    return {
      is(value: unknown): value is Record<string, any> {
        return (
          !globalThis.Array.isArray(value) &&
          typeof value === 'object' &&
          value !== null &&
          globalThis.Object.values(value).every(v => Guarded.is(vS, v))
        );
      },
      *serialize(value: Record<string, any>, stream: Buffer): Generator<void, void, void> {
        const entries = globalThis.Object.entries(value);
        yield* PROTO.UVarInt32.serialize(entries.length, stream);
        for (const [k, v] of entries) {
          yield* PROTO.String.serialize(k, stream);
          yield* vS.serialize(v, stream);
        }
      },
      *deserialize(stream: Buffer): Generator<void, Record<string, any>, void> {
        const size = yield* PROTO.UVarInt32.deserialize(stream);
        const result: Record<string, any> = {};
        for (let i = 0; i < size; i++) {
          const k = yield* PROTO.String.deserialize(stream);
          result[k] = yield* vS.deserialize(stream);
        }
        return result;
      }
    };
  }

  export function Cached<V>(s: PROTO.Serializable<V, true>, depth?: number): PROTO.Serializable<V, true>;
  export function Cached<V>(s: PROTO.Serializable<V>, depth?: number): PROTO.Serializable<V>;
  export function Cached<V, Guard extends boolean>(
    s: PROTO.Serializable<V, Guard>,
    depth?: number
  ): PROTO.Serializable<V, Guard>;
  export function Cached(s: PROTO.Serializable<any>, depth: number = 16): PROTO.Serializable<any> {
    const cache = new globalThis.Map<any, Uint8Array>();
    return {
      get is() {
        return s.is;
      },
      *serialize(value: any, stream: PROTO.Buffer): Generator<void, void, void> {
        const hit = cache.get(value);
        if (hit !== undefined) {
          stream.write(hit);

          cache.delete(value);
          cache.set(value, hit);
        } else {
          const buffer = new PROTO.Buffer();
          yield* s.serialize(value, buffer);
          const bytes = buffer.to_uint8array();
          stream.write(bytes);

          cache.set(value, bytes);
          if (cache.size > depth) {
            const first = cache.keys().next().value;
            if (first !== undefined) cache.delete(first);
          }
        }
      },
      *deserialize(stream: PROTO.Buffer): Generator<void, any, void> {
        return yield* s.deserialize(stream);
      }
    };
  }

  export function Lazy<T, Guard extends boolean>(
    init: () => PROTO.Serializable<T, Guard>
  ): PROTO.Serializable<T, Guard> {
    let cached: PROTO.Serializable<any> | undefined = undefined;
    const inner = () => (cached ??= init());

    return {
      get is() {
        return inner().is;
      },
      get serialize() {
        return inner().serialize;
      },
      get deserialize() {
        return inner().deserialize;
      }
    } as PROTO.Serializable<T, Guard>;
  }

  export function Recursive<T, Guard extends boolean>(
    init: (self: PROTO.Serializable<T, Guard>) => PROTO.Serializable<T, Guard>
  ): PROTO.Serializable<T, Guard> {
    let target: PROTO.Serializable<T, Guard>;
    target = init(PROTO.Lazy<T, Guard>(() => target));
    return target;
  }

  export function Literal<T extends string | number | boolean>(value: T): PROTO.Serializable<T, true> {
    return {
      is: (v: unknown): v is T => v === value,
      *serialize() {},
      *deserialize() {
        return value;
      }
    };
  }

  export function Union<T extends readonly any[]>(
    ...variants: { [K in keyof T]: PROTO.Serializable<T[K], true> }
  ): PROTO.Serializable<T[number], true> {
    return {
      is(value: unknown): value is T {
        return variants.some(v => v.is(value));
      },
      *serialize(value: T, stream: Buffer): Generator<void, void, void> {
        const idx = variants.findIndex(v => v.is(value));
        if (idx === -1) throw new Error(`invalid variant value ${globalThis.String(value)}`);

        yield* PROTO.UVarInt32.serialize(idx, stream);
        yield* variants[idx].serialize(value, stream);
      },
      *deserialize(stream: Buffer): Generator<void, T, void> {
        const idx = yield* PROTO.UVarInt32.deserialize(stream);
        const variant = variants[idx];
        if (variant === undefined) throw new Error(`invalid variant index ${idx}`);

        return yield* variant.deserialize(stream);
      }
    };
  }

  export type Any = boolean | number | string | null | undefined | Array<Any> | Set<Any> | Map<Any, Any>;
  export const Any: PROTO.Serializable<Any, true> = PROTO.Recursive(self =>
    PROTO.Union(
      PROTO.Boolean,
      PROTO.UVarInt32, // unsinged var-int first, better for positive values
      PROTO.VarInt32, // then try signed var-int
      PROTO.Float32, // then try a f32
      PROTO.Float64, // then just use f64, this works with all JS numbers
      PROTO.String,
      PROTO.Null,
      PROTO.Undefined,
      PROTO.Array(self),
      PROTO.Set(self),
      PROTO.Map(self, self)
    )
  );

  export function Checked<T>(s: PROTO.Serializable<T, true>): PROTO.Serializable<T, true> {
    return {
      get is() {
        return s.is;
      },
      *serialize(value: T, stream: Buffer): Generator<void, void, void> {
        if (!s.is(value)) throw new Error(`invalid input value ${globalThis.String(value)}`);

        yield* s.serialize(value, stream);
      },
      *deserialize(stream: Buffer): Generator<void, T, void> {
        const value = yield* s.deserialize(stream);

        if (!s.is(value)) throw new Error(`invalid output value ${globalThis.String(value)}`);
        return value;
      }
    };
  }

  export function Transform<A, B>(
    base: PROTO.Serializable<A>,
    to: (value: B) => A,
    from: (value: A) => B,
    is: (value: unknown) => value is B
  ): PROTO.Serializable<B, true>;
  export function Transform<A, B>(
    base: PROTO.Serializable<A>,
    to: (value: B) => A,
    from: (value: A) => B
  ): PROTO.Serializable<B>;
  export function Transform(
    base: PROTO.Serializable<any>,
    to: (value: any) => any,
    from: (value: any) => any,
    is?: (value: unknown) => boolean
  ): PROTO.Serializable<any> {
    return {
      is: is as (value: unknown) => value is any,
      *serialize(value: any, stream: Buffer): Generator<void, void, void> {
        yield* base.serialize(to(value), stream);
      },
      *deserialize(stream: Buffer): Generator<void, any, void> {
        const a = yield* base.deserialize(stream);
        return from(a);
      }
    };
  }
}

export namespace NET {
  type Endpoint = string;

  type Meta = {
    guid: string;
    signature: string;
  };

  type Header = {
    meta: Meta;
    index: number;
    final: boolean;
  };

  type Listener = (header: Header, fragment: string) => Generator<void, void, void>;

  const Endpoint: PROTO.Serializable<Endpoint, true> = PROTO.Checked(PROTO.String);

  const Meta: PROTO.Serializable<Meta, true> = PROTO.Checked(
    PROTO.Object<Meta>({
      guid: PROTO.String,
      signature: PROTO.String
    })
  );

  const Header: PROTO.Serializable<Header, true> = PROTO.Checked(
    PROTO.Object<Header>({
      meta: Meta,
      index: PROTO.UVarInt32,
      final: PROTO.Boolean
    })
  );

  const LISTENERS: Map<Endpoint, Array<Listener>> = new Map<Endpoint, Array<Listener>>();

  export const SIGNATURE: string = 'mcbe-ipc:v3';
  export let FRAG_MAX: number = 2048;

  export function* serialize(buffer: PROTO.Buffer, max_size: number = Infinity): Generator<void, string[], void> {
    const uint8array = buffer.to_uint8array();
    const result: string[] = [];

    let acc_str: string = '';
    let acc_size: number = 0;
    for (let i = 0; i < uint8array.length; i++) {
      const char_code = uint8array[i] | (uint8array[++i] << 8);
      const utf16_size = char_code <= 0x7f ? 1 : char_code <= 0x7ff ? 2 : char_code <= 0xffff ? 3 : 4;
      const char_size = char_code > 0xff ? utf16_size : 2;
      if (acc_size + char_size > max_size) {
        result.push(acc_str);
        acc_str = '';
        acc_size = 0;
      }

      if (char_code > 0xff) {
        acc_str += String.fromCharCode(char_code);
        acc_size += utf16_size;
      } else {
        acc_str += char_code.toString(16).padStart(2, '0').toUpperCase();
        acc_size += 2;
      }
      yield;
    }
    result.push(acc_str);

    return result;
  }

  export function* deserialize(strings: string[]): Generator<void, PROTO.Buffer, void> {
    const buffer = new PROTO.Buffer();
    for (let i = 0; i < strings.length; i++) {
      const str = strings[i];
      for (let j = 0; j < str.length; j++) {
        const char_code = str.charCodeAt(j);
        if (char_code <= 0xff) {
          const hex = str[j] + str[++j];
          const hex_code = parseInt(hex, 16);
          buffer.write(hex_code & 0xff);
          buffer.write(hex_code >> 8);
        } else {
          buffer.write(char_code & 0xff);
          buffer.write(char_code >> 8);
        }
        yield;
      }
      yield;
    }
    return buffer;
  }

  system.afterEvents.scriptEventReceive.subscribe(event => {
    system.runJob(
      (function* () {
        if (event.sourceType !== ScriptEventSource.Server) return;

        const [serialized_endpoint, serialized_header] = event.id.split(':');

        if (!PROTO.MIPS.is_valid(serialized_endpoint)) return;

        const endpoint_stream: PROTO.Buffer = yield* PROTO.MIPS.deserialize(serialized_endpoint);
        const endpoint: Endpoint = yield* Endpoint.deserialize(endpoint_stream);

        const listeners = LISTENERS.get(endpoint);
        if (listeners !== undefined && PROTO.MIPS.is_valid(serialized_header)) {
          const header_stream: PROTO.Buffer = yield* PROTO.MIPS.deserialize(serialized_header);
          const header: Header = yield* Header.deserialize(header_stream);

          for (const listener of [...listeners]) {
            try {
              yield* listener(header, event.message);
            } catch (e) {
              console.error(`[MCBE-IPC] listener error while handling packet on "${endpoint}":`, e);
            }
          }
        }
      })()
    );
  });

  function register(endpoint: Endpoint, listener: Listener) {
    let listeners = LISTENERS.get(endpoint);
    if (listeners === undefined) {
      listeners = new Array<Listener>();
      LISTENERS.set(endpoint, listeners);
    }
    listeners.push(listener);

    return () => {
      const idx = listeners.indexOf(listener);
      if (idx !== -1) listeners.splice(idx, 1);

      if (listeners.length === 0) {
        LISTENERS.delete(endpoint);
      }
    };
  }

  export interface EmitOptions {
    metaOverride?: Partial<Meta>;
  }

  export function* emit<S>(
    endpoint: string,
    serializer: PROTO.Serializer<S>,
    value: NoInfer<S>,
    options?: EmitOptions
  ): Generator<void, void, void> {
    const guid = options?.metaOverride?.guid ?? UTIL.generate_id();
    const signature = options?.metaOverride?.signature ?? SIGNATURE;

    const endpoint_stream = new PROTO.Buffer();
    yield* Endpoint.serialize(endpoint, endpoint_stream);
    const serialized_endpoint = yield* PROTO.MIPS.serialize(endpoint_stream);

    const packet_stream = new PROTO.Buffer();
    yield* serializer.serialize(value, packet_stream);

    const serialized_packets = yield* serialize(packet_stream, FRAG_MAX);
    for (let i = 0; i < serialized_packets.length; i++) {
      const serialized_packet = serialized_packets[i];

      const header: Header = {
        meta: { guid, signature },
        index: i,
        final: i === serialized_packets.length - 1
      };

      const header_stream = new PROTO.Buffer();
      yield* Header.serialize(header, header_stream);
      const serialized_header = yield* PROTO.MIPS.serialize(header_stream);
      system.sendScriptEvent(`${serialized_endpoint}:${serialized_header}`, serialized_packet);
    }
  }

  export interface ListenOptions {
    filter?: (meta: Meta) => boolean;
  }

  export function listen<D>(
    endpoint: string,
    deserializer: PROTO.Deserializer<D>,
    callback: (value: NoInfer<D>, meta: Meta) => Generator<void, void, void>,
    options?: ListenOptions
  ) {
    const buffer: Map<string, { size: number; fragments: string[]; received: number }> = new Map();
    const listener: Listener = function* (header: Header, fragment: string): Generator<void, void, void> {
      let packet = buffer.get(header.meta.guid);
      if (packet === undefined) {
        if (options?.filter?.(header.meta) === false) return;

        packet = { size: -1, fragments: [], received: 0 };
        buffer.set(header.meta.guid, packet);
      }

      if (header.final) {
        packet.size = header.index + 1;
      }

      if (packet.fragments[header.index] === undefined) {
        packet.fragments[header.index] = fragment;
        packet.received++;
      } else {
        throw new Error(`received duplicate fragment ${header.index} for packet ${header.meta.guid}`);
      }

      if (packet.size !== -1 && packet.size === packet.received) {
        const stream = yield* deserialize(packet.fragments);
        const value = yield* deserializer.deserialize(stream);
        yield* callback(value, header.meta);

        buffer.delete(header.meta.guid);
      }
    };
    return register(endpoint, listener);
  }
}

export namespace IPC {
  /** Sends a message with `args` to `channel` */
  export function send<S>(channel: string, serializer: PROTO.Serializer<S>, value: NoInfer<S>): void {
    system.runJob(NET.emit(`ipc:${channel}:send`, serializer, value));
  }

  /** Sends an `invoke` message through IPC, and expects a result asynchronously. */
  export function invoke<S, D>(
    channel: string,
    serializer: PROTO.Serializer<S>,
    value: NoInfer<S>,
    deserializer: PROTO.Deserializer<D>
  ): Promise<NoInfer<D>> {
    const id = UTIL.generate_id();

    return new Promise(resolve => {
      const terminate = NET.listen(
        `ipc:${channel}:handle`,
        deserializer,
        function* (value, meta) {
          if (meta.signature.includes(`+correlation`) && meta.guid !== id) return;

          resolve(value);
          terminate();
        },
        {
          filter: meta => !meta.signature.includes(`+correlation`) || meta.guid === id
        }
      );
      system.runJob(
        NET.emit(`ipc:${channel}:invoke`, serializer, value, {
          metaOverride: {
            guid: id,
            signature: `${NET.SIGNATURE}+correlation`
          }
        })
      );
    });
  }

  /** Listens to `channel`. When a new message arrives, `listener` will be called with `listener(args)`. */
  export function on<D>(
    channel: string,
    deserializer: PROTO.Deserializer<D>,
    listener: (value: NoInfer<D>) => void
  ): () => void {
    return NET.listen(`ipc:${channel}:send`, deserializer, function* (value) {
      listener(value);
    });
  }

  /** Listens to `channel` once. When a new message arrives, `listener` will be called with `listener(args)`, and then removed. */
  export function once<D>(channel: string, deserializer: PROTO.Deserializer<D>, listener: (value: NoInfer<D>) => void) {
    const terminate = NET.listen(`ipc:${channel}:send`, deserializer, function* (value) {
      listener(value);
      terminate();
    });
    return terminate;
  }

  /** Adds a handler for an `invoke` IPC. This handler will be called whenever `invoke(channel, ...args)` is called */
  export function handle<D, S>(
    channel: string,
    deserializer: PROTO.Deserializer<D>,
    serializer: PROTO.Serializer<S>,
    listener: (value: NoInfer<D>) => NoInfer<S>
  ): () => void {
    return NET.listen(`ipc:${channel}:invoke`, deserializer, function* (value, meta) {
      const result = listener(value);
      yield* NET.emit(`ipc:${channel}:handle`, serializer, result, {
        metaOverride: meta.signature.includes(`+correlation`)
          ? {
              guid: meta.guid,
              signature: `${NET.SIGNATURE}+correlation`
            }
          : undefined
      });
    });
  }
}

export default IPC;
