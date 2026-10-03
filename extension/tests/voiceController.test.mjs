import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { VoiceController } from '../../shared/voice/VoiceController.mjs'

let instances

class FakeRecognition {
  constructor() {
    this.starts = 0
    this.stops = 0
    this.aborts = 0
    instances.push(this)
  }

  start() {
    this.starts += 1
  }

  stop() {
    this.stops += 1
  }

  abort() {
    this.aborts += 1
  }
}

function createController(onTranscript = () => {}) {
  instances = []
  globalThis.SpeechRecognition = FakeRecognition
  const states = []
  const controller = new VoiceController({
    onTranscript,
    onStateChange: (state) => states.push(state),
  })
  return { controller, states }
}

afterEach(() => {
  delete globalThis.SpeechRecognition
  delete globalThis.webkitSpeechRecognition
})

test('starts one continuous recognizer and processes final results', async () => {
  const received = []
  const { controller, states } = createController((transcript) => received.push(transcript))
  controller.start()
  controller.start()

  assert.equal(instances.length, 1)
  assert.equal(instances[0].continuous, true)
  assert.equal(instances[0].interimResults, false)
  instances[0].onstart()
  instances[0].onresult({
    resultIndex: 0,
    results: [{ isFinal: true, 0: { transcript: 'Add React to my skills' } }],
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(received, ['Add React to my skills'])
  assert.equal(instances[0].stops, 1)
  assert.equal(states.some(({ state }) => state === 'processing'), true)
  controller.stop()
  assert.equal(instances[0].aborts, 1)
})

test('reuses its recognizer after normal termination', async () => {
  const { controller } = createController()
  controller.start()
  instances[0].onstart()
  instances[0].onend()
  await new Promise((resolve) => setTimeout(resolve, 450))

  assert.equal(instances.length, 1)
  assert.equal(instances[0].starts, 2)
  controller.destroy()
})

test('microphone denial stops automatic retries and exposes permission guidance', () => {
  const { controller, states } = createController()
  controller.start()
  instances[0].onerror({ error: 'not-allowed' })
  instances[0].onend()

  assert.equal(controller.enabled, false)
  assert.equal(states.at(-1).state, 'permission-required')
  assert.match(states.at(-1).message, /Allow microphone access/)
  assert.equal(instances[0].starts, 1)
  controller.destroy()
})

test('network failures stop automatic retries and expose retry guidance', () => {
  const { controller, states } = createController()
  controller.start()
  instances[0].onerror({ error: 'network' })
  instances[0].onend()

  assert.equal(controller.enabled, false)
  assert.equal(states.at(-1).state, 'error')
  assert.match(states.at(-1).message, /Check your connection/)
  assert.equal(instances[0].starts, 1)
  controller.destroy()
})

test('disabling voice aborts recognition and cancels pending restarts', async () => {
  const { controller } = createController()
  controller.start()
  instances[0].onstart()
  instances[0].onend()
  controller.stop()
  await new Promise((resolve) => setTimeout(resolve, 450))

  assert.equal(instances[0].starts, 1)
  assert.equal(instances[0].aborts, 1)
  assert.equal(controller.enabled, false)
})

test('unsupported browsers report an explicit voice error without constructing a recognizer', () => {
  delete globalThis.SpeechRecognition
  const states = []
  const controller = new VoiceController({
    onTranscript: () => {},
    onStateChange: (state) => states.push(state),
  })
  controller.start()

  assert.equal(states.at(-1).state, 'error')
  assert.match(states.at(-1).message, /not supported/)
  controller.destroy()
})
