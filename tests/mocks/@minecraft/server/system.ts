import { vi } from 'vitest'
import type {
  ScriptEventCommandMessageAfterEvent,
  ScriptEventMessageFilterOptions,
  ScriptEventSource
} from '@minecraft/server'
import { EventSignal } from '../../../util/event_signal'

const scriptEvent = new EventSignal<ScriptEventCommandMessageAfterEvent>()

export const system = {
  afterEvents: {
    scriptEventReceive: {
      subscribe: vi.fn(
        (callback: (arg0: ScriptEventCommandMessageAfterEvent) => void, _?: ScriptEventMessageFilterOptions) => {
          scriptEvent.subscribe(callback)
        }
      )
    }
  },
  sendScriptEvent: vi.fn((id: string, message: string) => {
    scriptEvent.emit({
      id,
      message,
      sourceType: "Server" as ScriptEventSource
    })
  }),
  runJob: vi.fn((generator: Generator<void, void, void>) => {
    let result = generator.next()
    while (!result.done) {
      result = generator.next()
    }
  })
}