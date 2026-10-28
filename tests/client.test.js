import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SOURCE = readFileSync(path.join(ROOT, 'client.js'), 'utf8')

const MARKER = 'data-dsh-hide-clock'
const STYLE_MARKER = 'data-dsh-hide-clock-style'
const STORAGE_KEY = 'dsh-hide-clock'
const MOBILE_QUERY = '(max-width: 768px)'
const RULE_START = '[data-dsh-hide-clock] [data-clock="start"] > span:first-child { display: none !important; }'
const RULE_END = '[data-dsh-hide-clock] [data-clock="end"] > span:last-child > span:last-child { display: none !important; }'

/** Minimal attribute-bearing element used for `documentElement` and `<style>`. */
function element(tagName) {
  const attributes = new Map()
  return {
    tagName,
    textContent: '',
    parentNode: null,
    attributes,
    setAttribute(name, value) { attributes.set(name, String(value)) },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null },
    removeAttribute(name) { attributes.delete(name) },
    hasAttribute(name) { return attributes.has(name) },
    remove() { if (this.parentNode !== null) this.parentNode.removeChild(this) },
  }
}

function createHead() {
  const head = {
    children: [],
    appendChild(node) {
      node.parentNode = head
      head.children.push(node)
      return node
    },
    removeChild(node) {
      const index = head.children.indexOf(node)
      if (index !== -1) head.children.splice(index, 1)
      node.parentNode = null
      return node
    },
  }
  return head
}

function createStorage(initial = {}, options = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem(key) {
      if (options.throwOnRead === true) {
        const error = new Error('SecurityError: simulated')
        error.name = 'SecurityError'
        throw error
      }
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      if (options.throwOnWrite === true) {
        const error = new Error('QuotaExceededError: simulated')
        error.name = 'QuotaExceededError'
        throw error
      }
      map.set(key, String(value))
    },
    removeItem(key) { map.delete(key) },
  }
}

function createMedia({ matches = false } = {}) {
  const listeners = new Set()
  const calls = []
  const media = {
    matches,
    media: '',
    calls,
    listeners,
    addEventListener(type, listener) { if (type === 'change') listeners.add(listener) },
    removeEventListener(type, listener) { if (type === 'change') listeners.delete(listener) },
    setMatches(next) {
      media.matches = next
      for (const listener of [...listeners]) listener({ matches: next })
    },
  }
  return media
}

function createWindow(media, storage, { withMedia = true } = {}) {
  const loads = []
  const window = {
    localStorage: storage,
    loads,
    __ModuleLoader__: {
      load(definition) { loads.push(definition) },
    },
  }
  if (withMedia) {
    window.matchMedia = (query) => {
      media.calls.push(query)
      media.media = query
      return media
    }
  }
  return window
}

function loadPlugin(window, document) {
  // `document` must be a global in the same realm as `client.js`: its apply
  // closure resolves free identifiers against that realm, not the test realm.
  const context = vm.createContext({ window, document, console: { warn() {} } })
  vm.runInContext(SOURCE, context)
  assert.equal(window.loads.length, 1, 'client.js must register exactly one module')
  const definition = window.loads[0]
  assert.equal(definition.id, 'dsh-hide-clock')
  const react = {
    createElement(type, props, ...children) { return { type, props, children } },
    useSyncExternalStore() { throw new Error('settings row is not rendered in these tests') },
  }
  return definition.factory((id) => {
    if (id === 'react') return react
    throw new Error(`unexpected require(${JSON.stringify(id)})`)
  })
}

/**
 * Fake Cordis context that mirrors the real slot rules: `slots.inject` is bound
 * to the fiber through `ctx.effect`, and a list slot rejects a duplicate id
 * (packages/client/ui-slots/src/index.ts).
 */
function createCtx() {
  const disposers = []
  const effects = []
  const locales = []
  const slots = []
  const registeredIds = new Set()

  const ctx = {
    effect(fn, label) {
      const dispose = fn()
      effects.push(label)
      disposers.push(dispose)
      return dispose
    },
    locale: {
      register(namespace, language, dictionary) {
        const record = { namespace, language, dictionary, disposed: false }
        locales.push(record)
        return () => { record.disposed = true }
      },
    },
    slots: {
      inject(name, callback) {
        const slot = { name, callback, registration: null }
        slots.push(slot)
        // Real slots bind the contribution to the calling fiber's lifetime.
        ctx.effect(() => callback(), `slot:${name}`)
      },
      register(options, Component) {
        const slot = slots[slots.length - 1]
        assert.ok(slot !== undefined, 'slots.register must run inside slots.inject')
        if (registeredIds.has(options.id)) {
          throw new Error(`list slot "${options.name}" already has an entry with id "${options.id}"`)
        }
        registeredIds.add(options.id)
        const registration = { options, Component, disposed: false }
        slot.registration = registration
        return () => {
          registration.disposed = true
          registeredIds.delete(options.id)
        }
      },
    },
  }

  ctx.disposers = disposers
  ctx.effects = effects
  ctx.locales = locales
  ctx.slotEntries = slots
  return { ctx, disposers, effects, locales, slots }
}

function setup({ storage = {}, matches = false, applies = 1, noMedia = false, throwOnRead = false } = {}) {
  const media = createMedia({ matches })
  const store = createStorage(storage, { throwOnRead })
  const document = {
    documentElement: element('html'),
    head: createHead(),
    createElement(tagName) { return element(tagName) },
  }
  const window = createWindow(media, store, { withMedia: !noMedia })
  const plugin = loadPlugin(window, document)
  const bundles = []
  for (let index = 0; index < applies; index += 1) {
    const bundle = createCtx()
    plugin.apply(bundle.ctx)
    bundles.push(bundle)
  }
  return { window, document, media, store, plugin, bundles, ctx: bundles[0].ctx }
}

function applyTo(env) {
  const bundle = createCtx()
  env.plugin.apply(bundle.ctx)
  env.bundles.push(bundle)
  return bundle
}

function styleEl(env) {
  return env.document.head.children.find(node => node.hasAttribute(STYLE_MARKER))
}

function registrationOf(env) {
  const slot = env.ctx.slotEntries[0]
  assert.ok(slot !== undefined, 'settings slot was never injected')
  assert.ok(slot.registration !== undefined, 'settings row must be registered during apply')
  return slot.registration
}

function disposeAll(bundle) {
  for (const dispose of bundle.disposers) {
    if (typeof dispose === 'function') dispose()
  }
}

test('registers one client module and exposes the declared plugin surface', () => {
  const env = setup()
  assert.equal(env.window.loads.length, 1)
  assert.deepEqual([...env.plugin.inject], ['slots', 'locale'])
  assert.equal(env.plugin.name, 'dsh-hide-clock')
  assert.equal(typeof env.plugin.apply, 'function')
})

test('injects exactly the two [data-clock] CSS rules', () => {
  const env = setup()
  const style = styleEl(env)
  assert.ok(style !== undefined, 'a <style> tagged with the style marker must be appended to <head>')
  const rules = style.textContent.split('\n').filter(line => line.length > 0)
  assert.equal(rules.length, 2)
  assert.equal(rules[0], RULE_START)
  assert.equal(rules[1], RULE_END)
  for (const rule of rules) assert.match(rule, /display: none !important;/)
})

test('hides by default when stored state is absent', () => {
  const env = setup()
  assert.equal(env.document.documentElement.hasAttribute(MARKER), true)
})

test('falls back to defaults for dirty localStorage values', () => {
  const cases = ['not json', '[]', 'null', '{"hidden":"yes","mobileOnly":1}', '{"hidden":null}']
  for (const raw of cases) {
    const env = setup({ storage: { [STORAGE_KEY]: raw } })
    const injected = registrationOf(env).options.inject()
    assert.deepEqual({ ...injected.get() }, { hidden: true, mobileOnly: false }, `raw=${raw}`)
    assert.equal(env.document.documentElement.hasAttribute(MARKER), true, `raw=${raw}`)
  }
})

test('honours a valid partial stored state', () => {
  const env = setup({ storage: { [STORAGE_KEY]: '{"hidden":false}' } })
  const injected = registrationOf(env).options.inject()
  assert.deepEqual({ ...injected.get() }, { hidden: false, mobileOnly: false })
  assert.equal(env.document.documentElement.hasAttribute(MARKER), false)
})

test('the hide switch toggles the marker and persists the state', () => {
  const env = setup()
  const injected = registrationOf(env).options.inject()
  injected.setHidden(false)
  assert.equal(env.document.documentElement.hasAttribute(MARKER), false)
  assert.equal(env.store.getItem(STORAGE_KEY), '{"hidden":false,"mobileOnly":false}')
  injected.setHidden(true)
  assert.equal(env.document.documentElement.hasAttribute(MARKER), true)
  assert.equal(env.store.getItem(STORAGE_KEY), '{"hidden":true,"mobileOnly":false}')
})

test('mobile-only mode hides on mobile and leaves desktop alone', () => {
  const env = setup({ matches: false })
  const injected = registrationOf(env).options.inject()
  injected.setMobileOnly(true)
  assert.equal(env.document.documentElement.hasAttribute(MARKER), false, 'desktop must stay visible')
  assert.equal(env.media.listeners.size, 1, 'a change listener must be registered once')

  env.media.setMatches(true)
  assert.equal(env.document.documentElement.hasAttribute(MARKER), true, 'mobile must hide')

  env.media.setMatches(false)
  assert.equal(env.document.documentElement.hasAttribute(MARKER), false, 'back to desktop must show')

  injected.setHidden(false)
  env.media.setMatches(true)
  assert.equal(env.document.documentElement.hasAttribute(MARKER), false, 'disabled switch always shows')
})

test('subscribers are notified on change and can unsubscribe', () => {
  const env = setup()
  const injected = registrationOf(env).options.inject()
  let calls = 0
  const unsubscribe = injected.subscribe(() => { calls += 1 })
  injected.setHidden(false)
  assert.equal(calls, 1)
  injected.setMobileOnly(true)
  assert.equal(calls, 2)
  unsubscribe()
  injected.setHidden(true)
  assert.equal(calls, 2)
})

test('dispose removes the style, marker, media listener, locale dictionaries and settings row', () => {
  const env = setup()
  const registration = registrationOf(env)
  assert.equal(registration.options.id, 'hide-clock')
  assert.equal(env.ctx.disposers.length >= 4, true, 'instance, two dictionaries and the slot contribution are effects')

  disposeAll(env.ctx)
  assert.equal(env.document.head.children.length, 0)
  assert.equal(env.document.documentElement.hasAttribute(MARKER), false)
  assert.equal(env.media.listeners.size, 0)
  assert.equal(env.ctx.locales.length, 2)
  for (const record of env.ctx.locales) assert.equal(record.disposed, true)
  assert.equal(registration.disposed, true, 'the settings row must leave with its fiber')
})

test('registers locale dictionaries and one settings row', () => {
  const env = setup()
  assert.deepEqual(env.media.calls, [MOBILE_QUERY])

  const registration = registrationOf(env)
  assert.equal(env.ctx.slotEntries[0].name, 'settings.general.item')
  assert.equal(registration.options.name, 'settings.general.item')
  assert.equal(registration.options.id, 'hide-clock')
  assert.equal(registration.options.locale, 'dsh-hide-clock')
  assert.equal(typeof registration.options.inject, 'function')
  assert.equal(typeof registration.Component, 'function')

  const languages = env.ctx.locales.map(record => record.language).sort()
  assert.deepEqual(languages, ['en', 'zh'])
  for (const record of env.ctx.locales) assert.equal(record.namespace, 'dsh-hide-clock')
  const enKeys = Object.keys(env.ctx.locales.find(record => record.language === 'en').dictionary).sort()
  const zhKeys = Object.keys(env.ctx.locales.find(record => record.language === 'zh').dictionary).sort()
  assert.deepEqual(enKeys, zhKeys)
  assert.equal(enKeys.length > 0, true)
})

test('fake slot registry rejects a duplicate row id like the real list slot does', () => {
  const env = setup()
  const { ctx } = env
  // The plugin already owns "hide-clock" in this ctx: a second registration with
  // the same id must fail exactly like packages/client/ui-slots/src/index.ts does.
  assert.throws(
    () => ctx.slots.inject('settings.general.item', () => ctx.slots.register({
      name: 'settings.general.item', id: 'hide-clock', order: 50,
    }, () => null)),
    /already has an entry with id "hide-clock"/,
  )
  const before = ctx.slotEntries.length
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'another-row', order: 50,
  }, () => null))
  assert.equal(ctx.slotEntries.length, before + 1)
  assert.equal(ctx.slotEntries[before].registration.options.id, 'another-row')
})

test('a duplicate apply is ignored: one style, one listener, one settings row', () => {
  const env = setup({ applies: 2 })
  assert.equal(env.document.head.children.length, 1, 'style must not be duplicated')
  assert.equal(env.media.listeners.size, 1, 'media listener must not be duplicated')
  assert.equal(env.media.calls.length, 1, 'matchMedia must be consulted once')
  assert.equal(env.bundles[0].slots.length, 1)
  assert.equal(env.bundles[1].slots.length, 0, 'second apply must not register another row')
  assert.equal(env.bundles[1].disposers.length, 0, 'second apply must not own any effect')

  disposeAll(env.bundles[0])
  assert.equal(env.document.head.children.length, 0)
  assert.equal(env.media.listeners.size, 0)
  assert.equal(env.document.documentElement.hasAttribute(MARKER), false)
})

test('apply after dispose recreates the instance (loader dispose-then-apply)', () => {
  const env = setup()
  const injected = registrationOf(env).options.inject()
  injected.setHidden(false)
  disposeAll(env.ctx)
  assert.equal(env.document.head.children.length, 0)

  applyTo(env)
  assert.equal(env.document.head.children.length, 1)
  assert.equal(env.media.listeners.size, 1)
  const rebound = registrationOf(env)
  assert.equal(rebound.options.id, 'hide-clock')
  assert.deepEqual({ ...rebound.options.inject().get() }, { hidden: false, mobileOnly: false }, 'fresh instance reads the persisted state')
  assert.equal(env.document.documentElement.hasAttribute(MARKER), false)
})

test('missing matchMedia behaves as desktop and never throws', () => {
  const env = setup({ noMedia: true })
  assert.equal(env.media.calls.length, 0)
  assert.equal(env.document.documentElement.hasAttribute(MARKER), true, 'default hide still applies')
  const injected = registrationOf(env).options.inject()
  assert.doesNotThrow(() => { injected.setMobileOnly(true) })
  assert.equal(env.document.documentElement.hasAttribute(MARKER), false, 'no matchMedia means desktop')
})

test('storage read blocked by SecurityError falls back to in-memory defaults', () => {
  const env = setup({ throwOnRead: true })
  assert.equal(env.document.documentElement.hasAttribute(MARKER), true)
  const injected = registrationOf(env).options.inject()
  assert.deepEqual({ ...injected.get() }, { hidden: true, mobileOnly: false })
  assert.doesNotThrow(() => { injected.setHidden(false) })
  assert.equal(env.document.documentElement.hasAttribute(MARKER), false)
})

test('a failing storage write does not break the live toggle', () => {
  const env = setup()
  env.store.setItem = () => {
    const error = new Error('QuotaExceededError: simulated')
    error.name = 'QuotaExceededError'
    throw error
  }
  const injected = registrationOf(env).options.inject()
  assert.doesNotThrow(() => { injected.setHidden(false) })
  assert.equal(env.document.documentElement.hasAttribute(MARKER), false)
})
