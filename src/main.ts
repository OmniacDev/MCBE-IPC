import * as server from '@minecraft/server'

export namespace IPC {
  export type InvokeData = {
    channel: string
    args: any[]
  }

  export type HandleData = {
    channel: string
    args: any[]
  }

  export function invoke(channel: string, ...args: any[]): Promise<any> {
    const data: InvokeData = {
      channel: channel,
      args: args
    }
    server.world.getDimension('overworld').runCommand(`/scriptevent ipc:invoke ${JSON.stringify(data)}`)
    return new Promise(resolve => {
      server.system.afterEvents.scriptEventReceive.subscribe(event => {
        if (event.id === 'ipc:handle') {
          const handle_data = JSON.parse(event.message) as HandleData
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
        const invoke_data = JSON.parse(event.message) as InvokeData
        if (invoke_data.channel === channel) {
          const args = listener(invoke_data.args)
          const data: HandleData = {
            channel: channel,
            args: args
          }
          server.world.getDimension('overworld').runCommand(`/scriptevent ipc:handle ${JSON.stringify(data)}`)
        }
      }
    })
  }
}

export default IPC
