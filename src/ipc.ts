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

import * as server from '@minecraft/server'

export namespace IPC {
  export type EventData = {
    channel: string
    args: any[]
  }

  /** Sends an `invoke` message through IPC, and expects a result asynchronously. */
  export function invoke(channel: string, ...args: any[]): Promise<any> {
    const data: EventData = {
      channel: channel,
      args: args
    }
    server.world.getDimension('overworld').runCommand(`scriptevent ipc:invoke ${JSON.stringify(data)}`)
    return new Promise(resolve => {
      const event_listener = server.system.afterEvents.scriptEventReceive.subscribe(event => {
        if (event.id === 'ipc:handle') {
          const handle_data = JSON.parse(event.message) as EventData
          if (handle_data.channel === channel) {
            resolve(handle_data.args)
            server.system.afterEvents.scriptEventReceive.unsubscribe(event_listener)
          }
        }
      })
    })
  }

  /** Adds a handler for an `invoke` IPC. This handler will be called whenever `invoke(channel, ...args)` is called */
  export function handle(channel: string, listener: (...args: any[]) => any) {
    server.system.afterEvents.scriptEventReceive.subscribe(event => {
      if (event.id === 'ipc:invoke') {
        const invoke_data = JSON.parse(event.message) as EventData
        if (invoke_data.channel === channel) {
          const args = listener(...invoke_data.args)
          const data: EventData = {
            channel: channel,
            args: args
          }
          server.system.run(() => {
            server.world.getDimension('overworld').runCommand(`scriptevent ipc:handle ${JSON.stringify(data)}`)
          })
        }
      }
    })
  }

  /** Sends a message with `args` to `channel` */
  export function send(channel: string, ...args: any[]): void {
    const data: EventData = {
      channel: channel,
      args: args
    }
    server.system.run(() => {
      server.world.getDimension('overworld').runCommand(`scriptevent ipc:send ${JSON.stringify(data)}`)
    })
  }

  /** Listens to `channel`. When a new message arrives, `listener` will be called with `listener(args)`. */
  export function on(channel: string, listener: (...args: any[]) => void) {
    server.system.afterEvents.scriptEventReceive.subscribe(event => {
      if (event.id === 'ipc:send') {
        const send_data = JSON.parse(event.message) as EventData
        if (send_data.channel === channel) {
          listener(...send_data.args)
        }
      }
    })
  }

  /** Listens to `channel` once. When a new message arrives, `listener` will be called with `listener(args)`, and then removed. */
  export function once(channel: string, listener: (...args: any[]) => void) {
    const event_listener = server.system.afterEvents.scriptEventReceive.subscribe(event => {
      if (event.id === 'ipc:send') {
        const send_data = JSON.parse(event.message) as EventData
        if (send_data.channel === channel) {
          listener(...send_data.args)
          server.system.afterEvents.scriptEventReceive.unsubscribe(event_listener)
        }
      }
    })
  }
}

export default IPC
