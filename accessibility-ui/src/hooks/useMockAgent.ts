import { useState } from 'react'
import { mockAgentCommand } from '../services/mockAgent'
import type { AgentResponse, AgentStatus } from '../types/agent'

export function useMockAgent() {
  const [status, setStatus] = useState<AgentStatus>('ready')
  const [response, setResponse] = useState<AgentResponse | null>(null)

  const submitCommand = async (command: string) => {
    if (!command.trim()) {
      setStatus('waiting')
      return null
    }

    setStatus('processing')
    setResponse(null)

    try {
      const nextResponse = await mockAgentCommand(command.trim())
      setResponse(nextResponse)
      setStatus(nextResponse.status === 'success' ? 'completed' : 'error')
      return nextResponse
    } catch {
      const errorResponse: AgentResponse = {
        message: 'We could not process that request. Please try again.',
        status: 'error',
      }
      setResponse(errorResponse)
      setStatus('error')
      return errorResponse
    }
  }

  return { response, status, submitCommand }
}
