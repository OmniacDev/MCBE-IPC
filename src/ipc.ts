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
  const MAX_STR_LENGTH = 1280
  let ID = 0

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
    export function toString(c: Payload): string {
      return JSON.stringify(toPacked(c))
    }
    export function fromString(s: string): Payload {
      return fromPacked(JSON.parse(s) as Packed)
    }

    export function toPacked(c: Payload): Packed {
      if (c.final !== undefined && c.index !== undefined) {
        return [c.channel, c.id, c.data, c.index, c.final ? 1 : 0]
      } else if (c.index !== undefined) {
        return [c.channel, c.id, c.data, c.index]
      } else {
        return [c.channel, c.id, c.data]
      }
    }

    export function fromPacked(p: Packed): Payload {
      if (p[4] !== undefined && p[3] !== undefined) {
        return { channel: p[0], id: p[1], data: p[2], index: p[3], final: p[4] === 1 }
      } else if (p[3] !== undefined) {
        return { channel: p[0], id: p[1], data: p[2], index: p[3] }
      } else {
        return { channel: p[0], id: p[1], data: p[2] }
      }
    }
  }

  function listen(event_id: string, channel: string, callback: (args: any[]) => void) {
    const buffer = new Map<number, { size: number | undefined; payloads: (Payload | undefined)[] }>()
    return system.afterEvents.scriptEventReceive.subscribe(
      event => {
        if (event.id === `ipc:${event_id}`) {
          const p: Payload.Packed = JSON.parse(decodeURI(event.message))
          if (p[0] === channel) {
            const payload: Payload = Payload.fromPacked(p)
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
                  fragment.payloads.filter(content => content !== null && content !== undefined).length ===
                    fragment.size
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
    const str_fragments: string[] = JSON.stringify(args).match(new RegExp(`.{1,${MAX_STR_LENGTH}}`, 'g')) ?? []
    const payload_strings = str_fragments
      .map((fragment, index) => {
        if (str_fragments.length > 1) {
          if (index === str_fragments.length - 1) {
            return { channel: channel, id: ID, data: fragment, index: index, final: true }
          }
          return { channel: channel, id: ID, data: fragment, index: index }
        }
        return { channel: channel, id: ID, data: fragment }
      })
      .map(payload => Payload.toString(payload))
    system.runJob(
      (function* () {
        for (const string of payload_strings) {
          world.getDimension('overworld').runCommand(`scriptevent ipc:${event_id} ${encodeURI(string)}`)
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
    listen('send', channel, args => {
      listener(...args)
    })
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
