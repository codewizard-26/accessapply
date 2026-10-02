import { useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type AssistanceMode = 'guide' | 'assist' | 'act'
type Page = 'assistant' | 'history' | 'accessibility'

const modes: Array<{ id: AssistanceMode; label: string; description: string }> = [
  { id: 'guide', label: 'Guide me', description: 'Explain the page and keep every decision with you.' },
  { id: 'assist', label: 'Assist me', description: 'Reduce repetitive work with navigation and guidance.' },
  { id: 'act', label: 'Act for me', description: 'Perform permitted actions after keeping you informed.' },
]

function getMockResponse(command: string) {
  const normalizedCommand = command.toLowerCase()
  if (normalizedCommand.includes('requirement')) return 'Here are the main requirements: React, TypeScript, REST APIs, and two or more years of experience.'
  if (normalizedCommand.includes('explain')) return 'This page appears to be a job application. I can help you review the role, find the application steps, or explain any field.'
  if (normalizedCommand.includes('guide')) return 'I can guide you one step at a time. Tell me which part of the application you would like to work on first.'
  return 'I can help explain this page, read the job requirements, or guide you through the next step.'
}

function App() {
  const [activePage, setActivePage] = useState<Page>('assistant')
  const [mode, setMode] = useState<AssistanceMode>('guide')
  const [command, setCommand] = useState('')
  const [response, setResponse] = useState('')
  const [status, setStatus] = useState('Ready')

  const submitCommand = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedCommand = command.trim()
    if (!trimmedCommand) {
      setStatus('Waiting for a command')
      return
    }
    setStatus('Processing')
    setResponse('')
    window.setTimeout(() => {
      setResponse(getMockResponse(trimmedCommand))
      setStatus('Action completed')
    }, 450)
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div><p className="eyebrow">Accessibility assistant</p><h1>AccessApply</h1></div>
        <p className="status" aria-live="polite"><span className="status-mark" aria-hidden="true" /><span>{status}</span></p>
      </header>

      <nav className="main-nav" aria-label="Main navigation">
        {(['assistant', 'history', 'accessibility'] as Page[]).map((page) => (
          <button className={activePage === page ? 'nav-button active' : 'nav-button'} key={page} type="button" aria-current={activePage === page ? 'page' : undefined} onClick={() => setActivePage(page)}>
            {page === 'assistant' ? 'Assistant' : page === 'history' ? 'History' : 'Accessibility'}
          </button>
        ))}
      </nav>

      <main className="main-content">
        {activePage === 'assistant' ? <>
          <section aria-labelledby="assistant-title"><p className="section-kicker">Current page</p><h2 id="assistant-title">How can I help?</h2><p className="intro">Ask for an explanation, a summary, or guidance through the next step.</p></section>

          <fieldset className="mode-picker"><legend>Assistance mode</legend><div className="mode-list">
            {modes.map((option) => <label className={mode === option.id ? 'mode-option selected' : 'mode-option'} key={option.id}>
              <input type="radio" name="assistance-mode" value={option.id} checked={mode === option.id} onChange={() => setMode(option.id)} />
              <span><strong>{option.label}</strong><small>{option.description}</small></span>
            </label>)}
          </div></fieldset>

          <form className="command-form" onSubmit={submitCommand}><label htmlFor="command">Your request</label>
            <textarea id="command" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Try: Read the requirements of this job." rows={3} />
            <div className="command-actions"><button className="secondary-button" type="button" onClick={() => setStatus('Listening')}>Voice command</button><button className="primary-button" type="submit">Send request</button></div>
          </form>

          <section className="response-panel" aria-labelledby="response-title" aria-live="polite"><div className="panel-heading"><div><p className="section-kicker">Agent response</p><h2 id="response-title">What I found</h2></div>{response && <span className="response-state">Ready to read</span>}</div>
            {status === 'Processing' ? <p className="response-message">Processing your request...</p> : response ? <p className="response-message">{response}</p> : <p className="response-message muted">Your response will appear here. You stay in control of every action.</p>}
          </section>
        </> : <section aria-labelledby="placeholder-title" className="placeholder-panel"><p className="section-kicker">{activePage === 'history' ? 'Recent activity' : 'Your preferences'}</p><h2 id="placeholder-title">{activePage === 'history' ? 'History is coming next' : 'Accessibility settings are coming next'}</h2><p className="intro">This first slice keeps the assistant experience focused. The next step will add this view without changing the navigation.</p></section>}
      </main>
    </div>
  )
}

export default App
