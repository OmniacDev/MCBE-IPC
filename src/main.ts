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

  export function invoke(channel: string, ...args: any[]): Promise<any> {
    const data: InvokeEventData = {
      channel: channel,
      args: args
    }
    server.world.getDimension('overworld').runCommand(`/scriptevent ipc:invoke ${JSON.stringify(data)}`)
    return new Promise(resolve => {
      server.system.afterEvents.scriptEventReceive.subscribe(event => {
        if (event.id === 'ipc:handle') {
          const handle_data = JSON.parse(event.message) as HandleEventData
          if (handle_data.channel === channel) {
            resolve(handle_data.args)
          }
        }
      })
    })
  }

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

  export function send(channel: string, ...args: any[]): void {
    const data: SendEventData = {
      channel: channel,
      args: args
    }
    server.world.getDimension('overworld').runCommand(`/scriptevent ipc:send ${JSON.stringify(data)}`)
  }

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
}

export default IPC
