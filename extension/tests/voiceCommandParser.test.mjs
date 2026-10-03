import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseVoiceCommand } from '../../shared/voice/voiceCommandParser.mjs'

test('parses a spoken profile introduction into explicit fields and skills', () => {
  assert.deepEqual(parseVoiceCommand('My name is Rahul Sharma. My email is rahul@example.com. I live in Mumbai. I know React and Python.'), [
    { type: 'SET_PROFILE_FIELD', field: 'name', value: 'Rahul Sharma' },
    { type: 'SET_PROFILE_FIELD', field: 'email', value: 'rahul@example.com' },
    { type: 'SET_PROFILE_FIELD', field: 'location', value: 'Mumbai' },
    { type: 'ADD_SKILL', value: 'React' },
    { type: 'ADD_SKILL', value: 'Python' },
  ])
})

test('normalizes clearly spoken email and numeric phone digits without inferring missing digits', () => {
  assert.deepEqual(parseVoiceCommand('My email is rahul at example dot com.'), [
    { type: 'SET_PROFILE_FIELD', field: 'email', value: 'rahul@example.com' },
  ])
  assert.deepEqual(parseVoiceCommand('My phone number is nine eight seven six five.'), [
    { type: 'SET_PROFILE_FIELD', field: 'phone', value: '98765' },
  ])
})

test('parses skill additions and removals', () => {
  assert.deepEqual(parseVoiceCommand('Add React and Python to my skills.'), [
    { type: 'ADD_SKILL', value: 'React' },
    { type: 'ADD_SKILL', value: 'Python' },
  ])
  assert.deepEqual(parseVoiceCommand('Remove Java from my skills.'), [
    { type: 'REMOVE_SKILL', value: 'Java' },
  ])
  assert.deepEqual(parseVoiceCommand('I know React and react and Python.'), [
    { type: 'ADD_SKILL', value: 'React' },
    { type: 'ADD_SKILL', value: 'Python' },
  ])
})

test('parses navigation, confirmation, help, stop, and high-impact actions distinctly', () => {
  assert.deepEqual(parseVoiceCommand('Save my profile.'), [{ type: 'SAVE_PROFILE' }])
  assert.deepEqual(parseVoiceCommand('Edit my profile.'), [{ type: 'EDIT_PROFILE' }])
  assert.deepEqual(parseVoiceCommand('Next.'), [{ type: 'NEXT' }])
  assert.deepEqual(parseVoiceCommand('Previous.'), [{ type: 'PREVIOUS' }])
  assert.deepEqual(parseVoiceCommand('Yes.'), [{ type: 'CONFIRM' }])
  assert.deepEqual(parseVoiceCommand('Help.'), [{ type: 'HELP' }])
  assert.deepEqual(parseVoiceCommand('Stop reading.'), [{ type: 'STOP' }])
  assert.deepEqual(parseVoiceCommand('Submit the application.'), [
    { type: 'CONSEQUENTIAL_ACTION', action: 'application submission' },
  ])
})

test('parses voice preference and application answer commands', () => {
  assert.deepEqual(parseVoiceCommand('Turn off voice control.'), [{ type: 'SET_VOICE_CONTROL', enabled: false }])
  assert.deepEqual(parseVoiceCommand('Set work authorization to Citizen.'), [
    { type: 'SET_APPLICATION_FIELD', field: 'workauthorization', value: 'Citizen' },
  ])
})
