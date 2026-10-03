import type { TranscriptEntry } from '../types/agent'

type TranscriptProps = {
  entries: TranscriptEntry[]
}

export function Transcript({ entries }: TranscriptProps) {
  if (entries.length === 0) return null

  return (
    <section className="transcript-panel ui-card" aria-labelledby="transcript-title">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Captions</p>
          <h2 id="transcript-title">Conversation</h2>
        </div>
      </div>
      <ol className="transcript-list">
        {entries.map((entry) => (
          <li className="transcript-entry" key={entry.id}>
            <strong>{entry.speaker === 'user' ? 'You' : 'Agent'}</strong>
            <p>{entry.message}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
