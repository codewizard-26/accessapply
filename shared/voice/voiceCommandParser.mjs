const profileFields = [
  ['name', /(?:my name is|set my name to|change my name to)\s+(.+?)(?=\s*(?:[,;.]|and my (?:email|phone|location|github|linkedin)|my (?:email|phone|location|github|linkedin)|i live in|i know)\b|$)/i],
  ['email', /(?:my email(?: address)? is|set my email(?: address)? to|change my email(?: address)? to)\s+([^\s,;]+(?:\s+at\s+[^\s,;]+(?:\s+dot\s+[^\s,;]+)*)?)/i],
  ['phone', /(?:my phone(?: number)? is|set my phone(?: number)? to|change my phone(?: number)? to)\s+([\d\s()+.-]+|(?:zero|one|two|three|four|five|six|seven|eight|nine)(?:\s+(?:zero|one|two|three|four|five|six|seven|eight|nine))*)/i],
  ['location', /(?:i live in|my location is|set my location to|change my location to)\s+(.+?)(?=\s*(?:[,;.]|and my (?:email|phone|location|github|linkedin)|my (?:email|phone|location|github|linkedin)|i know|i have)\b|$)/i],
  ['github', /(?:my github(?: url)? is|set my github(?: url)? to|change my github(?: url)? to)\s+(\S+)/i],
  ['linkedin', /(?:my linkedin(?: url)? is|set my linkedin(?: url)? to|change my linkedin(?: url)? to)\s+(\S+)/i],
]

function cleanValue(value) {
  return value.trim().replace(/[.,;]+$/, '').trim()
}

function normalizeEmail(value) {
  return cleanValue(value)
    .replace(/\s+at\s+/gi, '@')
    .replace(/\s+dot\s+/gi, '.')
}

function normalizePhone(value) {
  const digits = value.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine)\b/gi, (word) => {
    const digitWords = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
    return String(digitWords.indexOf(word.toLowerCase()))
  })
  return digits.replace(/\D/g, '')
}

function addProfileFieldCommands(text, commands) {
  for (const [field, pattern] of profileFields) {
    const match = text.match(pattern)
    if (!match?.[1]) continue
    let value = cleanValue(match[1])
    if (field === 'email') value = normalizeEmail(value)
    if (field === 'phone') value = normalizePhone(value)
    if (value) commands.push({ type: 'SET_PROFILE_FIELD', field, value })
  }

  const knownSkillsMatch = text.match(/(?:i know|my skills include)\s+(.+?)(?=\s+(?:my (?:name|email|phone|location)|i live|my github|my linkedin)\b|[.!?]|$)/i)
  const addSkills = (values) => {
    const seen = new Set()
    for (const skill of values.map(cleanValue).filter(Boolean)) {
      const normalized = skill.toLowerCase()
      if (seen.has(normalized)) continue
      seen.add(normalized)
      commands.push({ type: 'ADD_SKILL', value: skill })
    }
  }
  if (knownSkillsMatch?.[1]) {
    const skills = cleanValue(knownSkillsMatch[1])
      .replace(/\s+and\s+/gi, ',')
      .split(',')
    addSkills(skills)
  } else {
    const addSkillMatch = text.match(/\badd\s+(.+?)\s+to\s+(?:my )?skills?\b/i)
    if (addSkillMatch?.[1]) {
      addSkills(addSkillMatch[1].split(/\s+and\s+|,/i))
    }
  }

  const removeSkillMatch = text.match(/\bremove\s+(.+?)\s+from\s+(?:my )?skills?\b/i)
  if (removeSkillMatch?.[1]) {
    for (const skill of removeSkillMatch[1].split(/\s+and\s+|,/i).map(cleanValue).filter(Boolean)) {
      commands.push({ type: 'REMOVE_SKILL', value: skill })
    }
  }

  const applicationFieldMatch = text.match(/^(?:set|change)\s+(?:my\s+)?(work authorization|visa sponsorship|cover letter)\s+to\s+(.+)$/i)
  if (applicationFieldMatch?.[1] && applicationFieldMatch[2]) {
    commands.push({
      type: 'SET_APPLICATION_FIELD',
      field: applicationFieldMatch[1].toLowerCase().replace(/\s+/g, ''),
      value: cleanValue(applicationFieldMatch[2]),
    })
  }
}

export function parseVoiceCommand(transcript) {
  const text = transcript.trim().replace(/\s+/g, ' ')
  const normalized = text.toLowerCase().replace(/[.!?]+$/, '').trim()
  if (!normalized) return [{ type: 'UNKNOWN' }]

  const commands = []
  addProfileFieldCommands(text, commands)
  if (commands.length) return commands

  if (/^(stop|stop reading|cancel speech|never mind|nevermind)$/.test(normalized)) return [{ type: 'STOP' }]
  if (/^cancel$/.test(normalized)) return [{ type: 'CANCEL' }]
  if (/^(help|what can i say|voice help)$/.test(normalized)) return [{ type: 'HELP' }]
  if (/^(turn off|disable|stop) voice control$/.test(normalized)) return [{ type: 'SET_VOICE_CONTROL', enabled: false }]
  if (/^(turn on|enable|start) voice control$/.test(normalized)) return [{ type: 'SET_VOICE_CONTROL', enabled: true }]
  if (/^(yes|confirm|that's right|that is right)$/.test(normalized)) return [{ type: 'CONFIRM' }]
  if (/^(no|change it|that's wrong|that is wrong)$/.test(normalized)) return [{ type: 'REJECT' }]
  if (/^(save|save my|save the) (my )?profile$/.test(normalized) || normalized === 'save profile') return [{ type: 'SAVE_PROFILE' }]
  if (/^(edit|change|open) (my )?profile$/.test(normalized)) return [{ type: 'EDIT_PROFILE' }]
  if (/^(review|review my) (application|my application)$/.test(normalized) || normalized === 'review application') return [{ type: 'NAVIGATE', destination: 'review' }]
  if (/^(show|open|go to) application$/.test(normalized)) return [{ type: 'NAVIGATE', destination: 'application' }]
  if (/^(go to|show|open) profile$/.test(normalized)) return [{ type: 'NAVIGATE', destination: 'profile' }]
  if (/^(go back|back|previous)$/.test(normalized)) return [{ type: 'PREVIOUS' }]
  if (/^(next|continue|next page|next job)$/.test(normalized)) return [{ type: 'NEXT' }]
  if (/^(read|read this|read this page|what is on this page)$/.test(normalized)) return [{ type: 'READ_PAGE' }]
  if (/^read (this )?field$/.test(normalized)) return [{ type: 'READ_FIELD' }]
  if (/^(read|show|tell me) (the )?missing information$/.test(normalized)) return [{ type: 'READ_MISSING' }]
  if (/^(fill|fill in) my profile( information)?$/.test(normalized)) return [{ type: 'EDIT_PROFILE' }]
  if (/^(submit|apply|apply for) (the )?application$/.test(normalized)) return [{ type: 'CONSEQUENTIAL_ACTION', action: 'application submission' }]
  if (/^(delete|clear) (my )?profile$/.test(normalized)) return [{ type: 'CONSEQUENTIAL_ACTION', action: 'profile deletion' }]
  if (/^read the requirements$/.test(normalized)) return [{ type: 'ASSISTANT_REQUEST', command: text }]
  return [{ type: 'UNKNOWN' }]
}
