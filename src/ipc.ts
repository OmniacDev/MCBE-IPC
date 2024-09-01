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
  export function toString(contents: Payload): string {
    return JSON.stringify(toPacked(contents))
  }
  export function fromString(string: string): Payload {
    return fromPacked(JSON.parse(string) as Packed)
  }

  export function toPacked(contents: Payload): Packed {
    if (contents.final !== undefined && contents.index !== undefined) {
      return [contents.channel, contents.id, contents.data, contents.index, contents.final ? 1 : 0]
    } else if (contents.index !== undefined) {
      return [contents.channel, contents.id, contents.data, contents.index]
    } else {
      return [contents.channel, contents.id, contents.data]
    }
  }

  export function fromPacked(packed: Packed): Payload {
    if (packed[4] !== undefined && packed[3] !== undefined) {
      return { channel: packed[0], id: packed[1], data: packed[2], index: packed[3], final: packed[4] === 1 }
    } else if (packed[3] !== undefined) {
      return { channel: packed[0], id: packed[1], data: packed[2], index: packed[3] }
    } else {
      return { channel: packed[0], id: packed[1], data: packed[2] }
    }
  }
}

const MAX_STR_LENGTH = 1280
let ID = 0

function receive(event_id: string, channel: string, callback: (args: any[]) => void) {
  const buffer = new Map<number, { size: number | undefined; payloads: (Payload | undefined)[] }>()
  return system.afterEvents.scriptEventReceive.subscribe(
    event => {
      if (event.id === `ipc:${event_id}`) {
        const packed: Payload.Packed = JSON.parse(decodeURI(event.message))
        if (packed[0] === channel) {
          const payload: Payload = Payload.fromPacked(packed)
          const fragment = buffer.has(payload.id)
            ? buffer.get(payload.id)
            : buffer.set(payload.id, { size: undefined, payloads: [] }).get(payload.id)
          if (fragment !== undefined) {
            if (payload.final && payload.index !== undefined) {
              fragment.size = payload.index + 1
            } else if (payload.index === undefined && !(payload.final ?? false)) {
              fragment.size = 1
            }
            fragment.payloads[payload.index ?? 0] = payload
            if (fragment.size !== undefined) {
              if (
                fragment.payloads.length > 0 &&
                fragment.payloads.filter(content => content !== null && content !== undefined).length === fragment.size
              ) {
                const full_str = fragment.payloads.map(contents => contents?.data).join('')
                callback(JSON.parse(full_str))
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
  const data_str = JSON.stringify(args)
  const str_fragments =
    data_str.length > MAX_STR_LENGTH ? data_str.match(new RegExp(`.{1,${MAX_STR_LENGTH}}`, 'g')) || [] : [data_str]
  const payloads = str_fragments.map((fragment, index) => {
    if (str_fragments.length > 1 && index === str_fragments.length - 1) {
      return { channel: channel, id: ID, data: fragment, index: index, final: true }
    } else if (str_fragments.length > 1) {
      return { channel: channel, id: ID, data: fragment, index: index }
    } else {
      return { channel: channel, id: ID, data: fragment }
    }
  })
  const payload_strings = payloads.map(payload => Payload.toString(payload))
  function* send(strings: string[]) {
    for (const string of strings) {
      world.getDimension('overworld').runCommand(`scriptevent ipc:${event_id} ${encodeURI(string)}`)
      yield
    }
  }
  system.runJob(send(payload_strings))
  ID++
}

namespace IPC {
  /** Sends an `invoke` message through IPC, and expects a result asynchronously. */
  export function invoke(channel: string, ...args: any[]): Promise<any> {
    emit('invoke', channel, args)
    return new Promise(resolve => {
      const listener = receive('handle', channel, args => {
        resolve(args[0])
        system.afterEvents.scriptEventReceive.unsubscribe(listener)
      })
    })
  }

  /** Adds a handler for an `invoke` IPC. This handler will be called whenever `invoke(channel, ...args)` is called */
  export function handle(channel: string, listener: (...args: any[]) => any) {
    receive('invoke', channel, args => {
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
    receive('send', channel, args => {
      listener(...args)
    })
  }

  /** Listens to `channel` once. When a new message arrives, `listener` will be called with `listener(args)`, and then removed. */
  export function once(channel: string, listener: (...args: any[]) => void) {
    const event = receive('send', channel, args => {
      listener(...args)
      system.afterEvents.scriptEventReceive.unsubscribe(event)
    })
  }
}

export default IPC
