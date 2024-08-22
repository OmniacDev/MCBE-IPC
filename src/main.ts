import * as server from '@minecraft/server'

export namespace IPC {
  export type InvokeEventData = {
    channel: string
    args: any[]
  }

  export type HandleEventData = {
    channel: string
    args: any[]
  }

  export type SendEventData = {
    channel: string
    args: any[]
  }

  /** Sends an `invoke` message through IPC, and expects a result asynchronously. */
  export function invoke(channel: string, ...args: any[]): Promise<any> {
    const data: InvokeEventData = {
      channel: channel,
      args: args
    }
    server.world.getDimension('overworld').runCommand(`/scriptevent ipc:invoke ${JSON.stringify(data)}`)
    return new Promise(resolve => {
      const event_listener = server.system.afterEvents.scriptEventReceive.subscribe(event => {
        if (event.id === 'ipc:handle') {
          const handle_data = JSON.parse(event.message) as HandleEventData
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
        const invoke_data = JSON.parse(event.message) as InvokeEventData
        if (invoke_data.channel === channel) {
          const args = listener(invoke_data.args)
          const data: HandleEventData = {
            channel: channel,
            args: args
          }
          server.world.getDimension('overworld').runCommand(`/scriptevent ipc:handle ${JSON.stringify(data)}`)
        }
      }
    })
  }

  /** Sends a message with `args` to `channel` */
  export function send(channel: string, ...args: any[]): void {
    const data: SendEventData = {
      channel: channel,
      args: args
    }
    server.world.getDimension('overworld').runCommand(`/scriptevent ipc:send ${JSON.stringify(data)}`)
  }

  /** Listens to `channel`. When a new message arrives, `listener` will be called with `listener(args)`. */
  export function on(channel: string, listener: (...args: any[]) => void) {
    server.system.afterEvents.scriptEventReceive.subscribe(event => {
      if (event.id === 'ipc:send') {
        const send_data = JSON.parse(event.message) as SendEventData
        if (send_data.channel === channel) {
          listener(send_data.args)
        }
      }
    })
  }

  /** Listens to `channel` once. When a new message arrives, `listener` will be called with `listener(args)`, and then removed. */
  export function once(channel: string, listener: (...args: any[]) => void) {
    const event_listener = server.system.afterEvents.scriptEventReceive.subscribe(event => {
      if (event.id === 'ipc:send') {
        const send_data = JSON.parse(event.message) as SendEventData
        if (send_data.channel === channel) {
          listener(send_data.args)
          server.system.afterEvents.scriptEventReceive.unsubscribe(event_listener)
        }
      }
    })
  }
}

export default IPC
