import type { AgentRequest, AgentService } from '../types/agent'

const PROCESSING_DELAY = 450

function getMockMessage(command: string) {
  const normalizedCommand = command.toLowerCase()

  if (normalizedCommand.includes('requirement')) {
    return 'Here are the main requirements: React, TypeScript, REST APIs, and two or more years of experience.'
  }

  if (normalizedCommand.includes('explain')) {
    return 'This page appears to be a job application. I can help you review the role, find the application steps, or explain any field.'
  }

  if (normalizedCommand.includes('guide')) {
    return 'I can guide you one step at a time. Tell me which part of the application you would like to work on first.'
  }

  return 'I can help explain this page, read the job requirements, or guide you through the next step.'
}

export const mockAgentService: AgentService = {
  execute(request: AgentRequest) {
    return new Promise((resolve) => {
      window.setTimeout(() => {
        resolve({ message: getMockMessage(request.command), status: 'success' })
      }, PROCESSING_DELAY)
    })
  },
}
