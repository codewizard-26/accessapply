import { useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { mockJob } from './data/mockJob'
import { mockProfile } from './data/mockProfile'
import type { ApplicationField, FieldSource } from './types/application'
import type { AccessibilityPreferences, Education, Experience, UserProfile } from './types/profile'
import { getProfileValueForField, mapProfileToApplicationFields } from './utils/profileMapper'
import './App.css'

type View = 'profile' | 'application' | 'review'
type EditMode = 'personal' | 'links' | 'education' | 'experience' | null

type ModalProps = {
  title: string
  children: ReactNode
  onClose: () => void
}

const emptyEducation: Omit<Education, 'id'> = {
  institution: '', degree: '', field: '', startYear: new Date().getFullYear(), endYear: undefined,
}

const emptyExperience: Omit<Experience, 'id'> = {
  company: '', role: '', description: '', startDate: '', endDate: undefined,
}

const hasValue = (value?: string) => Boolean(value && value.trim())

function Modal({ title, children, onClose }: ModalProps) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-header"><h2 id="modal-title">{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}>Close</button></div>
        {children}
      </section>
    </div>
  )
}

function Section({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return <section className="profile-section"><div className="section-heading"><div><p className="eyebrow">Profile</p><h2>{title}</h2>{description && <p className="section-description">{description}</p>}</div>{action}</div>{children}</section>
}

function Field({ label, value, onChange, type = 'text', required = false, placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; placeholder?: string }) {
  return <label className="field"><span>{label}{required && <span aria-hidden="true"> *</span>}</span><input type={type} value={value} required={required} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>
}

function JobSummary() {
  return (
    <section className="profile-section job-summary-panel" aria-labelledby="job-summary-title">
      <div>
        <p className="eyebrow">Job</p>
        <h2 id="job-summary-title">{mockJob.title}</h2>
      </div>
      <div className="job-summary-details">
        <span>{mockJob.company}</span>
        <span>{mockJob.location}</span>
        <span>{mockJob.employmentType}</span>
      </div>
      <p className="job-summary-description">{mockJob.description}</p>
    </section>
  )
}

function FieldSourceBadge({ source }: { source: FieldSource }) {
  const labels: Record<FieldSource, string> = {
    profile: 'From your profile',
    user: 'Your answer',
    missing: 'Information required from you',
  }

  return <span className={`source-badge source-${source}`}>{labels[source]}</span>
}

function ApplicationProgress({ value, completed, total }: { value: number; completed: number; total: number }) {
  return (
    <div className="progress-block" aria-live="polite">
      <div className="progress-label-row">
        <p className="eyebrow">Application progress</p>
        <strong>{value}%</strong>
      </div>
      <div className="progress-bar" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label="Application progress">
        <span style={{ width: `${value}%` }} />
      </div>
      <p className="progress-caption">{completed} of {total} required fields completed</p>
    </div>
  )
}

function MissingInformation({ fields, onSelectField }: { fields: ApplicationField[]; onSelectField: (fieldId: string) => void }) {
  if (!fields.length) {
    return (
      <div className="missing-panel complete">
        <p>Everything looks complete.</p>
      </div>
    )
  }

  return (
    <div className="missing-panel">
      <p className="missing-title">Information required from you</p>
      <p className="missing-copy">{fields.length} field{fields.length === 1 ? '' : 's'} need your attention.</p>
      <ul className="missing-list">
        {fields.map((field) => (
          <li key={field.id}>
            <button type="button" className="missing-item" onClick={() => onSelectField(field.id)}>{field.label}</button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ReviewSection({ title, items }: { title: string; items: Array<{ label: string; value?: string }> }) {
  return (
    <div className="review-section">
      <h3>{title}</h3>
      <dl className="review-list">
        {items.map((item) => (
          <div key={item.label} className="review-row">
            <dt>{item.label}</dt>
            <dd>{item.value && item.value.trim() ? item.value : 'Not provided'}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function App() {
  const [view, setView] = useState<View>('profile')
  const [profile, setProfile] = useState<UserProfile>(mockProfile)
  const [applicationFields, setApplicationFields] = useState<ApplicationField[]>(() => mapProfileToApplicationFields(mockProfile))
  const [reviewConfirmed, setReviewConfirmed] = useState(false)
  const [editMode, setEditMode] = useState<EditMode>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [personalDraft, setPersonalDraft] = useState({ name: profile.name, email: profile.email, phone: profile.phone, location: profile.location })
  const [linksDraft, setLinksDraft] = useState({ github: profile.github ?? '', linkedin: profile.linkedin ?? '' })
  const [educationDraft, setEducationDraft] = useState(emptyEducation)
  const [experienceDraft, setExperienceDraft] = useState(emptyExperience)
  const [skillDraft, setSkillDraft] = useState('')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const fieldRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const requiredFields = useMemo(() => applicationFields.filter((field) => field.required), [applicationFields])
  const requiredMissing = useMemo(() => requiredFields.filter((field) => !hasValue(field.value)), [requiredFields])
  const completedRequired = requiredFields.length - requiredMissing.length
  const progressValue = requiredFields.length ? Math.round((completedRequired / requiredFields.length) * 100) : 100

  const updateApplicationField = (fieldId: string, nextValue: string) => {
    setApplicationFields((current) => current.map((field) => {
      if (field.id !== fieldId) {
        return field
      }

      const trimmedValue = nextValue.trim()
      const profileValue = getProfileValueForField(profile, fieldId)?.trim()

      if (!trimmedValue) {
        return { ...field, value: '', source: 'missing' }
      }

      if (profileValue && trimmedValue === profileValue) {
        return { ...field, value: trimmedValue, source: 'profile' }
      }

      return { ...field, value: trimmedValue, source: 'user' }
    }))
  }

  const showNotice = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2800)
  }

  const selectView = (nextView: View) => {
    if (nextView === 'application' && view === 'profile') {
      setApplicationFields(mapProfileToApplicationFields(profile))
    }
    setReviewConfirmed(false)
    setView(nextView)
  }

  const openPersonalEdit = () => {
    setPersonalDraft({ name: profile.name, email: profile.email, phone: profile.phone, location: profile.location })
    setFormError('')
    setEditMode('personal')
  }

  const savePersonal = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!personalDraft.name.trim() || !/^\S+@\S+\.\S+$/.test(personalDraft.email)) {
      setFormError('Enter a name and a valid email address.')
      return
    }

    setProfile((current) => ({ ...current, ...personalDraft }))
    setEditMode(null)
    showNotice('Personal information updated successfully.')
  }

  const openLinksEdit = () => {
    setLinksDraft({ github: profile.github ?? '', linkedin: profile.linkedin ?? '' })
    setFormError('')
    setEditMode('links')
  }

  const saveLinks = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const links = [linksDraft.github, linksDraft.linkedin].filter(Boolean)
    if (links.some((link) => !/^https?:\/\//i.test(link))) {
      setFormError('Links should begin with http:// or https://.')
      return
    }

    setProfile((current) => ({ ...current, github: linksDraft.github || undefined, linkedin: linksDraft.linkedin || undefined }))
    setEditMode(null)
    showNotice('Social links updated successfully.')
  }

  const openEducationEdit = (education?: Education) => {
    setEditingId(education?.id ?? null)
    setEducationDraft(education ? { institution: education.institution, degree: education.degree, field: education.field, startYear: education.startYear, endYear: education.endYear } : emptyEducation)
    setFormError('')
    setEditMode('education')
  }

  const saveEducation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!educationDraft.institution.trim() || !educationDraft.degree.trim()) {
      setFormError('Institution and degree are required.')
      return
    }

    const education: Education = { ...educationDraft, id: editingId ?? `edu-${Date.now()}` }
    setProfile((current) => ({ ...current, education: editingId ? current.education.map((item) => item.id === editingId ? education : item) : [...current.education, education] }))
    setEditMode(null)
    showNotice('Education updated successfully.')
  }

  const openExperienceEdit = (experience?: Experience) => {
    setEditingId(experience?.id ?? null)
    setExperienceDraft(experience ? { company: experience.company, role: experience.role, description: experience.description, startDate: experience.startDate, endDate: experience.endDate } : emptyExperience)
    setFormError('')
    setEditMode('experience')
  }

  const saveExperience = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!experienceDraft.company.trim() || !experienceDraft.role.trim()) {
      setFormError('Company and role are required.')
      return
    }

    const experience: Experience = { ...experienceDraft, id: editingId ?? `exp-${Date.now()}` }
    setProfile((current) => ({ ...current, experience: editingId ? current.experience.map((item) => item.id === editingId ? experience : item) : [...current.experience, experience] }))
    setEditMode(null)
    showNotice('Experience updated successfully.')
  }

  const addSkill = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const skill = skillDraft.trim()
    if (!skill) return
    if (profile.skills.some((item) => item.toLowerCase() === skill.toLowerCase())) {
      setFormError('That skill is already in your profile.')
      return
    }

    setProfile((current) => ({ ...current, skills: [...current.skills, skill] }))
    setSkillDraft('')
    setFormError('')
    showNotice('Skill added.')
  }

  const updatePreference = (key: keyof AccessibilityPreferences) => {
    setProfile((current) => ({ ...current, accessibilityPreferences: { ...current.accessibilityPreferences, [key]: !current.accessibilityPreferences[key] } }))
    showNotice('Accessibility preference updated.')
  }

  const handleResume = (file: File | undefined) => {
    if (file) {
      setProfile((current) => ({ ...current, resume: file.name }))
      showNotice('Resume selected.')
    }
  }

  const handleJumpToField = (fieldId: string) => {
    fieldRefs.current[fieldId]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setView('application')
  }

  const personalFields = applicationFields.filter((field) => ['fullName', 'email', 'phone', 'location'].includes(field.id))
  const professionalFields = applicationFields.filter((field) => ['yearsOfExperience', 'skills', 'education', 'github', 'linkedin'].includes(field.id))
  const userProvidedFields = applicationFields.filter((field) => field.source === 'user' && hasValue(field.value))

  const renderApplicationField = (field: ApplicationField) => {
    const value = field.value ?? ''
    const isMissing = !hasValue(value)
    const badgeSource: FieldSource = field.source ?? 'missing'

    return (
      <div key={field.id} ref={(node) => { fieldRefs.current[field.id] = node }} className={`application-field ${isMissing && field.required ? 'is-missing' : ''}`}>
        <div className="application-field-header">
          <label htmlFor={field.id}>{field.label}{field.required && <span aria-hidden="true"> *</span>}</label>
          <FieldSourceBadge source={badgeSource} />
        </div>

        {field.type === 'select' ? (
          <select id={field.id} value={value} onChange={(event) => updateApplicationField(field.id, event.target.value)}>
            <option value="">{field.placeholder ?? 'Select an option'}</option>
            {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        ) : field.type === 'textarea' ? (
          <textarea id={field.id} value={value} placeholder={field.placeholder} onChange={(event) => updateApplicationField(field.id, event.target.value)} rows={4} />
        ) : (
          <input id={field.id} type={field.type} value={value} placeholder={field.placeholder} onChange={(event) => updateApplicationField(field.id, event.target.value)} />
        )}

        {isMissing && field.required ? <p className="field-hint error">This information is required.</p> : isMissing ? <p className="field-hint">Optional information.</p> : field.source === 'profile' ? <p className="field-hint">Populated from your profile.</p> : <p className="field-hint">Your answer.</p>}
      </div>
    )
  }

  return (
    <div className="profile-app">
      <header className="profile-header">
        <div>
          <p className="eyebrow">AccessApply profile</p>
          <h1>My Profile</h1>
          <p>Manage your information for faster job applications.</p>
        </div>
        <nav className="top-nav" aria-label="Application navigation">
          <button type="button" className={view === 'profile' ? 'nav-button active' : 'nav-button'} onClick={() => selectView('profile')}>Profile</button>
          <button type="button" className={view === 'application' ? 'nav-button active' : 'nav-button'} onClick={() => selectView('application')}>Application</button>
          <button type="button" className={view === 'review' ? 'nav-button active' : 'nav-button'} onClick={() => selectView('review')}>Review</button>
        </nav>
      </header>

      {view === 'profile' && (
        <>
          <main className="profile-content">
            {notice && <div className="notice" role="status">{notice}</div>}
            <section className="summary-panel" aria-labelledby="profile-summary-title"><div className="avatar" aria-hidden="true">AJ</div><div><p className="eyebrow">Profile summary</p><h2 id="profile-summary-title">{profile.name}</h2><p className="summary-role">Frontend Developer</p><div className="summary-details"><span>{profile.email}</span><span>{profile.phone}</span><span>{profile.location}</span></div></div></section>

            <Section title="Personal information" description="The contact details used when preparing applications." action={<button type="button" className="secondary-button" onClick={openPersonalEdit}>Edit</button>}>
              <div className="detail-grid"><div><span className="detail-label">Full name</span><strong>{profile.name}</strong></div><div><span className="detail-label">Email</span><strong>{profile.email}</strong></div><div><span className="detail-label">Phone</span><strong>{profile.phone}</strong></div><div><span className="detail-label">Location</span><strong>{profile.location}</strong></div></div>
            </Section>

            <Section title="Skills" description="Keep your strongest skills ready for applications." >
              <div className="skill-list">{profile.skills.map((skill) => <span className="skill-chip" key={skill}>{skill}<button type="button" aria-label={`Remove ${skill}`} onClick={() => { setProfile((current) => ({ ...current, skills: current.skills.filter((item) => item !== skill) })); showNotice(`${skill} removed.`) }}>×</button></span>)}</div>
              <form className="inline-form" onSubmit={addSkill}><label htmlFor="new-skill">Add a skill</label><div><input id="new-skill" value={skillDraft} onChange={(event) => setSkillDraft(event.target.value)} placeholder="e.g. React" /><button className="secondary-button" type="submit">Add skill</button></div></form>{formError && <p className="form-error" role="alert">{formError}</p>}
            </Section>

            <Section title="Education" description="Your academic background." action={<button type="button" className="secondary-button" onClick={() => openEducationEdit()}>Add education</button>}>
              {profile.education.length ? profile.education.map((education) => <article className="item-row" key={education.id}><div><h3>{education.degree} — {education.field}</h3><p>{education.institution}</p><span>{education.startYear} — {education.endYear ?? 'Present'}</span></div><div className="item-actions"><button type="button" className="text-button" onClick={() => openEducationEdit(education)}>Edit</button><button type="button" className="text-button danger" onClick={() => { setProfile((current) => ({ ...current, education: current.education.filter((item) => item.id !== education.id) })); showNotice('Education removed.') }}>Delete</button></div></article>) : <EmptyState label="No education added yet." action="Add education" onClick={() => openEducationEdit()} />}
            </Section>

            <Section title="Experience" description="Your professional experience." action={<button type="button" className="secondary-button" onClick={() => openExperienceEdit()}>Add experience</button>}>
              {profile.experience.length ? profile.experience.map((experience) => <article className="item-row" key={experience.id}><div><h3>{experience.role}</h3><p>{experience.company}</p><span>{experience.startDate || 'Start date'} — {experience.endDate || 'Present'}</span><p className="item-description">{experience.description}</p></div><div className="item-actions"><button type="button" className="text-button" onClick={() => openExperienceEdit(experience)}>Edit</button><button type="button" className="text-button danger" onClick={() => { setProfile((current) => ({ ...current, experience: current.experience.filter((item) => item.id !== experience.id) })); showNotice('Experience removed.') }}>Delete</button></div></article>) : <EmptyState label="No experience added yet." action="Add experience" onClick={() => openExperienceEdit()} />}
            </Section>

            <Section title="Resume" description="Keep a current resume available for applications.">
              <div className="resume-row">{profile.resume ? <><span className="file-icon" aria-hidden="true">PDF</span><strong>{profile.resume}</strong><button type="button" className="text-button danger" onClick={() => { setProfile((current) => ({ ...current, resume: undefined })); showNotice('Resume removed.') }}>Remove</button></> : <EmptyState label="No resume added yet." action="Choose resume" onClick={() => document.getElementById('resume-input')?.click()} />}</div>
              <label className="file-button">{profile.resume ? 'Replace resume' : 'Choose resume'}<input id="resume-input" type="file" accept=".pdf,.doc,.docx" onChange={(event) => handleResume(event.target.files?.[0])} /></label>
            </Section>

            <Section title="Social links" description="Connect your professional profiles." action={<button type="button" className="secondary-button" onClick={openLinksEdit}>Edit links</button>}>
              <div className="links-grid"><div><span className="detail-label">GitHub</span>{profile.github ? <a href={profile.github} target="_blank" rel="noreferrer">{profile.github}</a> : <span className="muted">Not added</span>}</div><div><span className="detail-label">LinkedIn</span>{profile.linkedin ? <a href={profile.linkedin} target="_blank" rel="noreferrer">{profile.linkedin}</a> : <span className="muted">Not added</span>}</div></div>
            </Section>

            <Section title="Accessibility preferences" description="Save the settings that help you work comfortably.">
              <div className="preference-list">{([['highContrast', 'High contrast', 'Increase contrast for easier reading.'], ['reducedMotion', 'Reduced motion', 'Reduce non-essential movement.'], ['largeText', 'Large text', 'Use larger text where supported.']] as Array<[keyof AccessibilityPreferences, string, string]>).map(([key, label, description]) => <label className="preference-row" key={key}><span><strong>{label}</strong><small>{description}</small></span><span className="setting-control"><input type="checkbox" checked={profile.accessibilityPreferences[key]} onChange={() => updatePreference(key)} /><span>{profile.accessibilityPreferences[key] ? 'On' : 'Off'}</span></span></label>)}</div>
            </Section>
          </main>

          {editMode === 'personal' && <Modal title="Edit personal information" onClose={() => setEditMode(null)}><form className="modal-form" onSubmit={savePersonal}><Field label="Full name" value={personalDraft.name} onChange={(value) => setPersonalDraft({ ...personalDraft, name: value })} required /><Field label="Email" type="email" value={personalDraft.email} onChange={(value) => setPersonalDraft({ ...personalDraft, email: value })} required /><Field label="Phone" value={personalDraft.phone} onChange={(value) => setPersonalDraft({ ...personalDraft, phone: value })} /><Field label="Location" value={personalDraft.location} onChange={(value) => setPersonalDraft({ ...personalDraft, location: value })} /><ModalActions onCancel={() => setEditMode(null)} />{formError && <p className="form-error" role="alert">{formError}</p>}</form></Modal>}
          {editMode === 'links' && <Modal title="Edit social links" onClose={() => setEditMode(null)}><form className="modal-form" onSubmit={saveLinks}><Field label="GitHub URL" type="url" value={linksDraft.github} onChange={(value) => setLinksDraft({ ...linksDraft, github: value })} placeholder="https://github.com/username" /><Field label="LinkedIn URL" type="url" value={linksDraft.linkedin} onChange={(value) => setLinksDraft({ ...linksDraft, linkedin: value })} placeholder="https://linkedin.com/in/username" /><ModalActions onCancel={() => setEditMode(null)} />{formError && <p className="form-error" role="alert">{formError}</p>}</form></Modal>}
          {editMode === 'education' && <Modal title={editingId ? 'Edit education' : 'Add education'} onClose={() => setEditMode(null)}><form className="modal-form" onSubmit={saveEducation}><Field label="Institution" value={educationDraft.institution} onChange={(value) => setEducationDraft({ ...educationDraft, institution: value })} required /><Field label="Degree" value={educationDraft.degree} onChange={(value) => setEducationDraft({ ...educationDraft, degree: value })} required /><Field label="Field of study" value={educationDraft.field} onChange={(value) => setEducationDraft({ ...educationDraft, field: value })} /><div className="two-fields"><Field label="Start year" type="number" value={String(educationDraft.startYear)} onChange={(value) => setEducationDraft({ ...educationDraft, startYear: Number(value) })} /><Field label="End year" type="number" value={educationDraft.endYear ? String(educationDraft.endYear) : ''} onChange={(value) => setEducationDraft({ ...educationDraft, endYear: value ? Number(value) : undefined })} /></div><ModalActions onCancel={() => setEditMode(null)} />{formError && <p className="form-error" role="alert">{formError}</p>}</form></Modal>}
          {editMode === 'experience' && <Modal title={editingId ? 'Edit experience' : 'Add experience'} onClose={() => setEditMode(null)}><form className="modal-form" onSubmit={saveExperience}><Field label="Company" value={experienceDraft.company} onChange={(value) => setExperienceDraft({ ...experienceDraft, company: value })} required /><Field label="Role" value={experienceDraft.role} onChange={(value) => setExperienceDraft({ ...experienceDraft, role: value })} required /><label className="field"><span>Description</span><textarea value={experienceDraft.description} onChange={(event) => setExperienceDraft({ ...experienceDraft, description: event.target.value })} rows={4} /></label><div className="two-fields"><Field label="Start date" type="month" value={experienceDraft.startDate} onChange={(value) => setExperienceDraft({ ...experienceDraft, startDate: value })} /><Field label="End date" type="month" value={experienceDraft.endDate ?? ''} onChange={(value) => setExperienceDraft({ ...experienceDraft, endDate: value || undefined })} /></div><ModalActions onCancel={() => setEditMode(null)} />{formError && <p className="form-error" role="alert">{formError}</p>}</form></Modal>}
        </>
      )}

      {view === 'application' && (
        <main className="profile-content">
          {notice && <div className="notice" role="status">{notice}</div>}
          <JobSummary />
          <ApplicationProgress value={progressValue} completed={completedRequired} total={requiredFields.length} />
          <MissingInformation fields={requiredMissing} onSelectField={handleJumpToField} />

          <section className="profile-section application-form-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Application</p>
                <h2>Application details</h2>
              </div>
              <button type="button" className="primary-button" onClick={() => setView('review')}>Review application</button>
            </div>

            <div className="application-field-list">
              {applicationFields.map((field) => renderApplicationField(field))}
            </div>
          </section>
        </main>
      )}

      {view === 'review' && (
        <main className="profile-content review-page">
          {notice && <div className="notice" role="status">{notice}</div>}
          <JobSummary />

          <section className="profile-section review-panel">
            <div className="section-heading review-heading">
              <div>
                <p className="eyebrow">Review</p>
                <h2>Application review</h2>
              </div>
            </div>

            <ReviewSection title="Personal information" items={personalFields.map((field) => ({ label: field.label, value: field.value }))} />
            <ReviewSection title="Professional information" items={professionalFields.map((field) => ({ label: field.label, value: field.value }))} />

            <div className="review-section">
              <h3>User-provided answers</h3>
              {userProvidedFields.length ? (
                <ul className="review-answer-list">
                  {userProvidedFields.map((field) => (
                    <li key={field.id}><strong>{field.label}</strong><span>{field.value}</span></li>
                  ))}
                </ul>
              ) : (
                <p className="review-empty">No user-provided answers yet.</p>
              )}
            </div>

            <div className="review-section">
              <h3>Missing information</h3>
              {requiredMissing.length ? (
                <ul className="missing-review-list">
                  {requiredMissing.map((field) => <li key={field.id}>{field.label}</li>)}
                </ul>
              ) : (
                <p className="review-empty">No missing required information.</p>
              )}
            </div>

            <div className="review-confirmation">
              <label className="confirmation-check">
                <input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)} />
                <span>I have reviewed my application information.</span>
              </label>

              <div className="review-actions">
                <button type="button" className="secondary-button" onClick={() => setView('application')}>Back to Application</button>
                <button type="button" className="primary-button" onClick={() => { if (!requiredMissing.length) { setReviewConfirmed(true) } }} disabled={requiredMissing.length > 0 || !reviewConfirmed}>
                  Review Complete
                </button>
              </div>

              {requiredMissing.length > 0 && <p className="form-error" role="alert">Please complete all required fields before marking the review complete.</p>}
              {reviewConfirmed && <p className="confirmation-success">Application review complete. No submission was made.</p>}
            </div>
          </section>
        </main>
      )}
    </div>
  )
}

function EmptyState({ label, action, onClick }: { label: string; action: string; onClick: () => void }) {
  return <div className="empty-state"><p>{label}</p><button type="button" className="text-button" onClick={onClick}>{action}</button></div>
}

function ModalActions({ onCancel }: { onCancel: () => void }) {
  return <div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button><button type="submit" className="primary-button">Save changes</button></div>
}

export default App
