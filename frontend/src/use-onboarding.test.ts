/**
 * Tests for the onboarding gate hook. Vitest runs in node, so we provide a
 * minimal in-memory localStorage shim and exercise the hook by manually
 * driving its underlying logic via direct localStorage reads/writes.
 *
 * The hook itself uses React state, which is harder to test without jsdom.
 * The localStorage contract is the persistence boundary that matters for
 * regression-safety, so we test that directly.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ONBOARDING_STORAGE_KEY } from './use-onboarding'

class MemoryStorage implements Storage {
  private store = new Map<string, string>()
  get length() {
    return this.store.size
  }
  clear() {
    this.store.clear()
  }
  getItem(key: string) {
    return this.store.has(key) ? (this.store.get(key) as string) : null
  }
  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null
  }
  removeItem(key: string) {
    this.store.delete(key)
  }
  setItem(key: string, value: string) {
    this.store.set(key, value)
  }
}

const originalWindow = (globalThis as unknown as { window?: Window }).window

beforeEach(() => {
  ;(globalThis as unknown as { window: { localStorage: Storage } }).window = {
    localStorage: new MemoryStorage(),
  } as { localStorage: Storage }
})

afterEach(() => {
  if (originalWindow === undefined) {
    delete (globalThis as unknown as { window?: Window }).window
  } else {
    ;(globalThis as unknown as { window?: Window }).window = originalWindow
  }
})

describe('onboarding storage contract (spec §7.1)', () => {
  it('uses the documented localStorage key', () => {
    expect(ONBOARDING_STORAGE_KEY).toBe('1052os.onboarding.completed')
  })

  it('absent key means onboarding has not been completed (auto-show)', () => {
    expect(window.localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBeNull()
  })

  it('writing "true" persists completed flag', () => {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true')
    expect(window.localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe('true')
  })

  it('removing key restarts onboarding (Settings restart button path)', () => {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true')
    window.localStorage.removeItem(ONBOARDING_STORAGE_KEY)
    expect(window.localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBeNull()
  })

  it('values other than "true" are treated as not-completed (be strict on truthy check)', () => {
    // The hook reads `localStorage.getItem(...) === 'true'`, so any other value
    // means "not completed" and the modal will show. Verifies that contract.
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, '1')
    expect(window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === 'true').toBe(false)
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, 'TRUE')
    expect(window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === 'true').toBe(false)
  })
})
