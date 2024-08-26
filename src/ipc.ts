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

export namespace IPC {
  export type EventData = {
    channel: string
    args: any[]
  }

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

  function receive(id: string, channel: string, callback: (...args: any[]) => void) {
    return system.afterEvents.scriptEventReceive.subscribe(event => {
      if (event.id === id) {
        const data = JSON.parse(event.message) as EventData
        if (data.channel === channel) {
          callback(...data.args)
        }
      }
    })
  }

  function emit(id: string, channel: string, ...args: any[]) {
    const data: EventData = {
      channel: channel,
      args: args
    }
    system.run(() => {
      world.getDimension('overworld').runCommand(`scriptevent ${id} ${JSON.stringify(data)}`)
    })
  }

}

export default IPC