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

interface Header {
  id: number
  size: number
}

namespace Header {
  export function toString(header: Header): string {
    return JSON.stringify(header)
  }
  export function fromString(string: string): Header {
    return JSON.parse(string) as Header
  }
}

interface Contents {
  id: number
  index: number
  data: string
}

namespace Contents {
  export type Packed = [number, number, string]
  export function toString(contents: Contents): string {
    return JSON.stringify(toPacked(contents))
  }
  export function fromString(string: string): Contents {
    return fromPacked(JSON.parse(string) as Packed)
  }

  function toPacked(contents: Contents): Packed {
    return [contents.id, contents.index, contents.data]
  }

  function fromPacked(packed: Packed): Contents {
    return { id: packed[0], index: packed[1], data: packed[2] }
  }
}

const MAX_STR_LENGTH = 1024
let ID = 0

function fragment(data: string): Contents[] {
  const fragments = data.length > MAX_STR_LENGTH ? data.match(new RegExp(`.{1,${MAX_STR_LENGTH}}`, 'g')) || [] : [data]
  return fragments.map((fragment, index) => {
    return { id: ID, index: index, data: fragment }
  })
}

function receive(id: string, channel: string, callback: (...args: any[]) => void) {
  // create temp buffer for received chunks
  // expect header, when received, create array and move temp chunks into it
  // when final fragment arrives, validate map

  const buffer = new Map<number, { header: Header | undefined; contents: Contents[] }>()

  function tryResolve(fragment: { header: Header | undefined; contents: Contents[] }) {
    if (
      fragment.contents.filter(content => content !== null || typeof content !== 'undefined').length ===
      fragment.contents.length
    ) {
      // no undefined, array is completed
      const full_str = fragment.contents
        .map(contents => {
          return contents.data
        })
        .join('')

      callback(...JSON.parse(full_str))
    }
  }

  return system.afterEvents.scriptEventReceive.subscribe(event => {
    if (event.id === `${id}:${channel}`) {
      const obj = JSON.parse(event.message)
      if (Array.isArray(obj)) {
        const contents: Contents = Contents.fromString(event.message)

        if (!buffer.has(contents.id)) {
          buffer.set(contents.id, { header: undefined, contents: [] })
        }

        const fragment = buffer.get(contents.id)
        if (fragment !== undefined) {
          fragment.contents[contents.index] = contents

          if (fragment.header !== undefined) {
            tryResolve(fragment)
          }
        }
      } else if (typeof obj === 'object') {
        const header: Header = Header.fromString(event.message)

        if (!buffer.has(header.id)) {
          buffer.set(header.id, { header: undefined, contents: [] })
        }

        const fragment = buffer.get(header.id)
        if (fragment !== undefined) {
          fragment.header = header
          fragment.contents.length = header.size
          tryResolve(fragment)
        }
      }
    }
  })
}

function emit(id: string, channel: string, ...args: any[]) {
  const strings: string[] = []
  // fragment args
  const contents: Contents[] = fragment(JSON.stringify(args))
  // create header
  const header: Header = {
    id: ID,
    size: contents.length
  }
  // stringify header & fragments
  strings.push(Header.toString(header))
  contents.map(content => {
    strings.push(Contents.toString(content))
  })

  // send each fragment
  system.run(() => {
    strings.forEach(string => {
      world.getDimension('overworld').runCommand(`scriptevent ${id}:${channel} ${string}`)
    })
  })

  // increment ID
  ID++
}

export namespace IPC {
  /** Sends an `invoke` message through IPC, and expects a result asynchronously. */
  export function invoke(channel: string, ...args: any[]): Promise<any> {
    emit('ipc:invoke', channel, args)
    return new Promise(resolve => {
      const listener = receive('ipc:handle', channel, (...args) => {
        resolve(args)
        system.afterEvents.scriptEventReceive.unsubscribe(listener)
      })
    })
  }

  /** Adds a handler for an `invoke` IPC. This handler will be called whenever `invoke(channel, ...args)` is called */
  export function handle(channel: string, listener: (...args: any[]) => any) {
    receive('ipc:invoke', channel, (...args) => {
      const result = listener(...args)
      emit('ipc:handle', channel, result)
    })
  }

  /** Sends a message with `args` to `channel` */
  export function send(channel: string, ...args: any[]): void {
    emit('ipc:send', channel, args)
  }

  /** Listens to `channel`. When a new message arrives, `listener` will be called with `listener(args)`. */
  export function on(channel: string, listener: (...args: any[]) => void) {
    receive('ipc:send', channel, listener)
  }

  /** Listens to `channel` once. When a new message arrives, `listener` will be called with `listener(args)`, and then removed. */
  export function once(channel: string, listener: (...args: any[]) => void) {
    const event = receive('ipc:send', channel, (...args) => {
      listener(...args)
      system.afterEvents.scriptEventReceive.unsubscribe(event)
    })
  }
}

export default IPC
