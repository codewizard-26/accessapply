import { useState } from 'react'
import { mockAgentService } from '../services/mockAgent'
import type { AgentRequest, AgentResponse, AgentService, AgentStatus } from '../types/agent'

// Mock implementation used until the backend agent is connected.
export function useAgent(agentService: AgentService = mockAgentService) {
  const [status, setStatus] = useState<AgentStatus>('ready')
  const [response, setResponse] = useState<AgentResponse | null>(null)

  const submitCommand = async (request: AgentRequest) => {
    if (!request.command.trim()) {
      setStatus('waiting')
      return null
    }

    setStatus('processing')
    setResponse(null)

    const chromeApi = (globalThis as unknown as { chrome?: { runtime?: { sendMessage?: (msg: unknown, cb?: (res: any) => void) => void } } }).chrome
    if (chromeApi?.runtime?.sendMessage) {
      try {
        const bgRes = await new Promise<any>((resolve) => {
          chromeApi.runtime!.sendMessage!(
            { type: 'START_TASK', command: request.command.trim() },
            (res: any) => resolve(res),
          )
        })
        if (bgRes && bgRes.ok) {
          const successResponse: AgentResponse = {
            message: `Agent started: "${request.command.trim()}". AccessApply is now running on your active tab.`,
            status: 'success',
          }
          setResponse(successResponse)
          setStatus('completed')
          return successResponse
        }
      } catch {
        // Fall back to agent service
      }
    }

    try {
      const nextResponse = await agentService.execute({ ...request, command: request.command.trim() })
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