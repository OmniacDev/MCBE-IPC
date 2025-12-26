import { vi } from 'vitest'
import { ScriptEventSource, system } from './mocks/@minecraft/server'

vi.mock("@minecraft/server", () => ({
  system,
  ScriptEventSource
}))
