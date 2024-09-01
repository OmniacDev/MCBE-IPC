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

const MAX_STR_LENGTH = 1024
let ID = 0

function fragment(channel: string, data: string): Payload[] {
  const fragments = data.length > MAX_STR_LENGTH ? data.match(new RegExp(`.{1,${MAX_STR_LENGTH}}`, 'g')) || [] : [data]
  return fragments.map((fragment, index) => {
    if (fragments.length > 1 && index === fragments.length - 1) {
      return { channel: channel, id: ID, data: fragment, index: index, final: true }
    } else if (fragments.length > 1) {
      return { channel: channel, id: ID, data: fragment, index: index }
    } else {
      return { channel: channel, id: ID, data: fragment }
    }
  })
}

function receive(id: string, channel: string, callback: (args: any[]) => void) {
  const buffer = new Map<number, { size: number | undefined; payloads: (Payload | undefined)[] }>()
  function tryResolve(fragment: { size: number | undefined; payloads: (Payload | undefined)[] }) {
    if (
      fragment.payloads.length > 0 &&
      fragment.payloads.filter(content => content !== null && content !== undefined).length === fragment.size
    ) {
      const full_str = fragment.payloads.map(contents => contents?.data).join('')

      callback(JSON.parse(full_str))
    }
  }
  return system.afterEvents.scriptEventReceive.subscribe(
    event => {
      if (event.id === `ipc:${id}`) {
        const payload = JSON.parse(decodeURI(event.message)) as Payload.Packed
        if (payload[0] === channel) {
          const contents: Payload = Payload.fromPacked(payload)
          if (!buffer.has(contents.id)) {
            buffer.set(contents.id, { size: undefined, payloads: [] })
          }

          const fragment = buffer.get(contents.id)
          if (fragment !== undefined) {
            if (contents.final && contents.index !== undefined) {
              fragment.size = contents.index + 1
            } else if (contents.index === undefined && !(contents.final ?? false)) {
              fragment.size = 1
            }
            fragment.payloads[contents.index ?? 0] = contents

            if (fragment.size !== undefined) {
              tryResolve(fragment)
            }
          }
        }
      }
    },
    { namespaces: ['ipc'] }
  )
}

function emit(id: string, channel: string, args: any[]) {
  const strings: string[] = []
  const payloads: Payload[] = fragment(channel, JSON.stringify(args))
  payloads.forEach(payload => strings.push(Payload.toString(payload)))
  function* send(strings: string[]) {
    for (const string of strings) {
      world.getDimension('overworld').runCommand(`scriptevent ipc:${id} ${encodeURI(string)}`)
      yield
    }
  }
  system.runJob(send(strings))
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
