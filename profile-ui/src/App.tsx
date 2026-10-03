import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { mockJob } from './data/mockJob'
import type { ApplicationField, FieldSource } from './types/application'
import { getProfileValueForField, mapProfileToApplicationFields } from './utils/profileMapper'
import { getExtensionPageUrl, getProfileState, saveProfile } from '../../shared/profile/profileStorage.mjs'
import type { AccessibilityPreferences, Education, Experience, UserProfile } from '../../shared/types/profile'
import { parseVoiceCommand } from '../../shared/voice/voiceCommandParser.mjs'
import type { VoiceCommand } from '../../shared/voice/voiceCommandParser.mjs'
import { speakText, stopSpeaking } from '../../shared/voice/speak.mjs'
import { useVoiceControl } from './hooks/useVoiceControl'
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

const emptyProfile: UserProfile = {
  name: '',
  email: '',
  phone: '',
  location: '',
  skills: [],
  education: [],
  experience: [],
  accessibilityPreferences: {
    highContrast: false,
    reducedMotion: false,
    largeText: false,
  },
}

const hasValue = (value?: string) => Boolean(value && value.trim())

function Modal({ title, children, onClose }: ModalProps) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="modal ui-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-header"><h2 id="modal-title">{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}>Close</button></div>
        {children}
      </section>
    </div>
  )
}

function Section({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return <section className="profile-section ui-card"><div className="section-heading"><div><p className="eyebrow">Profile</p><h2>{title}</h2>{description && <p className="section-description">{description}</p>}</div>{action}</div>{children}</section>
}

function Field({ label, value, onChange, type = 'text', required = false, placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; placeholder?: string }) {
  return <label className="field"><span>{label}{required && <span aria-hidden="true"> *</span>}</span><input type={type} value={value} required={required} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>
}

function JobSummary() {
  return (
    <section className="profile-section ui-card job-summary-panel" aria-labelledby="job-summary-title">
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
    <div className="progress-block ui-card" aria-live="polite">
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
      <div className="missing-panel ui-card complete">
        <p>Everything looks complete.</p>
      </div>
    )
  }

  return (
    <div className="missing-panel ui-card">
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
  const [profile, setProfile] = useState<UserProfile>(emptyProfile)
  const [applicationFields, setApplicationFields] = useState<ApplicationField[]>(() => mapProfileToApplicationFields(emptyProfile))
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState('')
  const [isOnboarding, setIsOnboarding] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [reviewConfirmed, setReviewConfirmed] = useState(false)
  const [editMode, setEditMode] = useState<EditMode>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [personalDraft, setPersonalDraft] = useState({ name: '', email: '', phone: '', location: '' })
  const [linksDraft, setLinksDraft] = useState({ github: profile.github ?? '', linkedin: profile.linkedin ?? '' })
  const [educationDraft, setEducationDraft] = useState(emptyEducation)
  const [experienceDraft, setExperienceDraft] = useState(emptyExperience)
  const [skillDraft, setSkillDraft] = useState('')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [voiceFeedback, setVoiceFeedback] = useState('')
  const [speechFeedback, setSpeechFeedback] = useState('')
  const [pendingConfirmation, setPendingConfirmation] = useState<{ field: 'email' | 'phone' | 'github' | 'linkedin'; value: string } | null>(null)
  const fieldRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const pendingConfirmationRef = useRef(pendingConfirmation)
  const setVoiceControlEnabledRef = useRef<((enabled: boolean) => Promise<boolean>) | null>(null)

  useEffect(() => {
    pendingConfirmationRef.current = pendingConfirmation
  }, [pendingConfirmation])

  useEffect(() => {
    let isActive = true
    getProfileState()
      .then((state) => {
        if (!isActive) return
        const savedProfile = state?.profile
        const nextProfile = savedProfile ?? emptyProfile
        setProfile(nextProfile)
        setApplicationFields(mapProfileToApplicationFields(nextProfile))
        setIsOnboarding(state?.profileCompleted !== true)
        setLoadState('ready')
      })
      .catch((error: unknown) => {
        if (!isActive) return
        setLoadError(error instanceof Error ? error.message : 'The saved profile could not be loaded.')
        setLoadState('error')
      })

    return () => {
      isActive = false
    }
  }, [])

  const requiredFields = useMemo(() => applicationFields.filter((field) => field.required), [applicationFields])
  const requiredMissing = useMemo(() => requiredFields.filter((field) => !hasValue(field.value)), [requiredFields])
  const userProvidedFields = applicationFields.filter((field) => field.source === 'user' && hasValue(field.value))
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

  const saveCurrentProfile = async () => {
    setSaveError('')
    setIsSaving(true)
    try {
      await saveProfile(profile)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save your profile. Please try again.')
      setIsSaving(false)
      return
    }

    setIsOnboarding(false)
    speakVoiceFeedback('Your profile has been saved. Opening the AccessApply assistant.')
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 1200))
      window.location.replace(getExtensionPageUrl('accessibility-ui/index.html'))
    } catch (error) {
      setIsSaving(false)
      setSaveError(error instanceof Error
        ? `Your profile was saved, but AccessApply could not return to the assistant: ${error.message}`
        : 'Your profile was saved, but AccessApply could not return to the assistant.')
    }
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
    showNotice('Personal information updated. Save your profile to keep these changes.')
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
    showNotice('Social links updated. Save your profile to keep these changes.')
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
    showNotice('Education updated. Save your profile to keep these changes.')
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
    showNotice('Experience updated. Save your profile to keep these changes.')
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
    showNotice('Skill added. Save your profile to keep this change.')
  }

  const updatePreference = (key: keyof AccessibilityPreferences) => {
    setProfile((current) => ({ ...current, accessibilityPreferences: { ...current.accessibilityPreferences, [key]: !current.accessibilityPreferences[key] } }))
    showNotice('Accessibility preference updated. Save your profile to keep this change.')
  }

  const handleResume = (file: File | undefined) => {
    if (file) {
      setProfile((current) => ({ ...current, resume: file.name }))
      showNotice('Resume selected. Save your profile to keep this change.')
    }
  }

  const handleJumpToField = (fieldId: string) => {
    fieldRefs.current[fieldId]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setView('application')
  }

  const speakVoiceFeedback = (message: string) => {
    setVoiceFeedback(message)
    speakText(message, setSpeechFeedback)
  }

  const applyProfileVoiceField = (field: 'name' | 'email' | 'phone' | 'location' | 'github' | 'linkedin', value: string) => {
    if ((field === 'email' && !/^\S+@\S+\.\S+$/.test(value)) || (field === 'phone' && value.replace(/\D/g, '').length < 7)) {
      speakVoiceFeedback(field === 'email'
        ? 'I could not confirm a complete email address. Please say the full email address again.'
        : 'I only heard part of your phone number. Please say the complete number again.')
      return
    }
    if ((field === 'github' || field === 'linkedin') && !/^https?:\/\//i.test(value)) {
      speakVoiceFeedback(`I need the complete ${field === 'github' ? 'GitHub' : 'LinkedIn'} web address, including https.`)
      return
    }
    if (field === 'email' || field === 'phone' || field === 'github' || field === 'linkedin') {
      setPendingConfirmation({ field, value })
      speakVoiceFeedback(`I heard your ${field === 'github' ? 'GitHub address' : field === 'linkedin' ? 'LinkedIn address' : field} as ${value}. Say yes to use it or no to say it again.`)
      return true
    }
    setProfile((current) => ({ ...current, [field]: value }))
    if (view === 'application') setApplicationFields(mapProfileToApplicationFields({ ...profile, [field]: value }))
    speakVoiceFeedback(`${field === 'name' ? 'Name' : 'Location'} updated. Review your profile and say save my profile when you are ready.`)
    return false
  }

  const handleVoiceCommands = async (commands: VoiceCommand[]) => {
    for (const command of commands) {
      if (command.type === 'STOP') {
        stopSpeaking()
        setSpeechFeedback('ready')
        setVoiceFeedback('Speech stopped.')
        continue
      }
      if (command.type === 'HELP') {
        speakVoiceFeedback('You can say: set my name, set my email, add a skill, save my profile, edit my profile, review my application, or stop.')
        continue
      }
      if (command.type === 'SET_VOICE_CONTROL') {
        const setEnabled = setVoiceControlEnabledRef.current
        const saved = setEnabled ? await setEnabled(command.enabled) : false
        if (saved && !command.enabled) {
          setVoiceFeedback('Voice control is off. Use the Voice Control toggle to turn it on again.')
          speakText('Voice control is off. Use the Voice Control toggle to turn it on again.', setSpeechFeedback)
        } else if (saved) {
          speakVoiceFeedback('Voice control is on.')
        }
        continue
      }
      if (command.type === 'CONFIRM') {
        const pending = pendingConfirmationRef.current
        if (!pending) {
          speakVoiceFeedback('There is nothing waiting for confirmation.')
          continue
        }
        setProfile((current) => ({ ...current, [pending.field]: pending.value }))
        setPendingConfirmation(null)
        speakVoiceFeedback(`Your ${pending.field} has been updated. Review your profile and say save my profile when ready.`)
        continue
      }
      if (command.type === 'REJECT') {
        if (pendingConfirmationRef.current) {
          setPendingConfirmation(null)
          speakVoiceFeedback('Okay. Please say the complete value again.')
        } else {
          speakVoiceFeedback('Okay. Nothing was changed.')
        }
        continue
      }
      if (command.type === 'SET_PROFILE_FIELD') {
        if (applyProfileVoiceField(command.field, command.value)) break
        continue
      }
      if (command.type === 'ADD_SKILL') {
        const duplicate = profile.skills.some((skill) => skill.toLowerCase() === command.value.toLowerCase())
        if (duplicate) {
          speakVoiceFeedback(`${command.value} is already in your skills.`)
        } else {
          setProfile((current) => ({ ...current, skills: [...current.skills, command.value] }))
          speakVoiceFeedback(`${command.value} added to your skills. Say save my profile when you are ready.`)
        }
        continue
      }
      if (command.type === 'REMOVE_SKILL') {
        const found = profile.skills.some((skill) => skill.toLowerCase() === command.value.toLowerCase())
        if (!found) speakVoiceFeedback(`${command.value} is not in your skills.`)
        else {
          setProfile((current) => ({ ...current, skills: current.skills.filter((skill) => skill.toLowerCase() !== command.value.toLowerCase()) }))
          speakVoiceFeedback(`${command.value} removed from your skills. Say save my profile to keep the change.`)
        }
        continue
      }
      if (command.type === 'SAVE_PROFILE') {
        await saveCurrentProfile()
        continue
      }
      if (command.type === 'EDIT_PROFILE') {
        setView('profile')
        setEditMode('personal')
        speakVoiceFeedback('Your profile is ready to edit.')
        continue
      }
      if (command.type === 'NAVIGATE') {
        selectView(command.destination)
        speakVoiceFeedback(`${command.destination} opened.`)
        continue
      }
      if (command.type === 'NEXT') {
        const nextView: View = view === 'profile' ? 'application' : 'review'
        if (isOnboarding) speakVoiceFeedback('Please save your profile before continuing.')
        else selectView(nextView)
        continue
      }
      if (command.type === 'CANCEL') {
        stopSpeaking()
        if (editMode) setEditMode(null)
        setPendingConfirmation(null)
        setVoiceFeedback('Cancelled.')
        continue
      }
      if (command.type === 'PREVIOUS') {
        if (editMode) setEditMode(null)
        else setView(view === 'review' ? 'application' : 'profile')
        speakVoiceFeedback('Going back.')
        continue
      }
      if (command.type === 'READ_PAGE') {
        const pageSummary = view === 'profile'
          ? `Profile page. Name ${profile.name || 'not provided'}. Email ${profile.email || 'not provided'}. ${profile.skills.length} skills.`
          : view === 'application'
            ? `Application page for ${mockJob.title} at ${mockJob.company}. ${requiredMissing.length} required fields need your attention.`
            : `Review page for ${mockJob.title}. ${userProvidedFields.length} user-provided answers.`
        speakVoiceFeedback(pageSummary)
        continue
      }
      if (command.type === 'READ_MISSING') {
        speakVoiceFeedback(requiredMissing.length
          ? `Information required from you: ${requiredMissing.map((field) => field.label).join(', ')}.`
          : 'No required application information is missing.')
        continue
      }
      if (command.type === 'READ_FIELD') {
        const activeElement = document.activeElement
        const activeLabel = activeElement instanceof HTMLElement && activeElement.id
          ? document.querySelector(`label[for="${CSS.escape(activeElement.id)}"]`)?.textContent?.trim()
          : null
        speakVoiceFeedback(activeLabel ? `${activeLabel}.` : 'Move keyboard focus to a field to hear its label.')
        continue
      }
      if (command.type === 'SET_APPLICATION_FIELD') {
        const fieldId: Record<typeof command.field, string> = {
          workauthorization: 'workAuthorization',
          visasponsorship: 'visaSponsorship',
          coverletter: 'coverLetter',
        }
        if (view !== 'application') {
          speakVoiceFeedback('Open the application page before changing an application answer.')
          continue
        }
        const applicationField = applicationFields.find((field) => field.id === fieldId[command.field])
        const matchedOption = applicationField?.options?.find((option) => option.toLowerCase() === command.value.toLowerCase())
        if (applicationField?.options && !matchedOption) {
          speakVoiceFeedback(`I could not match that answer. Options include ${applicationField.options.join(', ')}.`)
        } else {
          updateApplicationField(fieldId[command.field], matchedOption ?? command.value)
          speakVoiceFeedback(`${applicationField?.label ?? 'Application answer'} updated.`)
        }
        continue
      }
      if (command.type === 'CONSEQUENTIAL_ACTION') {
        speakVoiceFeedback(`I cannot perform ${command.action} from this screen. Nothing was submitted or deleted.`)
        continue
      }
      if (command.type === 'UNKNOWN') {
        speakVoiceFeedback('I did not understand. Say help to hear available commands.')
      }
    }
  }

  const handleVoiceTranscript = async (transcript: string) => {
    const commands = parseVoiceCommand(transcript)
    if (window.speechSynthesis?.speaking && commands.some((command) =>
      command.type !== 'STOP'
      && command.type !== 'CANCEL'
      && !(command.type === 'SET_VOICE_CONTROL' && !command.enabled))) return
    await handleVoiceCommands(commands)
  }
  const voiceControl = useVoiceControl(handleVoiceTranscript, loadState === 'ready')
  useEffect(() => {
    setVoiceControlEnabledRef.current = voiceControl.setEnabled
    return () => {
      setVoiceControlEnabledRef.current = null
    }
  }, [voiceControl.setEnabled])

  const personalFields = applicationFields.filter((field) => ['fullName', 'email', 'phone', 'location'].includes(field.id))
  const professionalFields = applicationFields.filter((field) => ['yearsOfExperience', 'skills', 'education', 'github', 'linkedin'].includes(field.id))

  const renderApplicationField = (field: ApplicationField) => {
    const value = field.value ?? ''
    const isMissing = !hasValue(value)
    const badgeSource: FieldSource = field.source ?? 'missing'

    return (
      <div key={field.id} ref={(node) => { fieldRefs.current[field.id] = node }} className={`application-field ui-card ${isMissing && field.required ? 'is-missing' : ''}`}>
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

  if (loadState === 'loading') {
    return <main className="app-status ui-card" role="status">Loading your saved profile…</main>
  }

  if (loadState === 'error') {
    return (
      <main className="app-status ui-card" aria-labelledby="profile-load-error-title">
        <h1 id="profile-load-error-title">Profile unavailable</h1>
        <p role="alert">{loadError}</p>
        <button type="button" className="primary-button" onClick={() => window.location.reload()}>Try again</button>
      </main>
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
        <div className="profile-header-actions">
          <nav className="top-nav" aria-label="Application navigation">
            <button type="button" className={view === 'profile' ? 'nav-button active' : 'nav-button'} onClick={() => selectView('profile')}>Profile</button>
            {!isOnboarding && <button type="button" className={view === 'application' ? 'nav-button active' : 'nav-button'} onClick={() => selectView('application')}>Application</button>}
            {!isOnboarding && <button type="button" className={view === 'review' ? 'nav-button active' : 'nav-button'} onClick={() => selectView('review')}>Review</button>}
          </nav>
          {view === 'profile' && <button type="button" className="primary-button" onClick={() => void saveCurrentProfile()} disabled={isSaving}>{isSaving ? 'Saving profile…' : isOnboarding ? 'Save profile and continue' : 'Save changes and return'}</button>}
          <button type="button" className="secondary-button voice-toggle" aria-pressed={voiceControl.enabled} disabled={!voiceControl.preferenceLoaded} onClick={() => void voiceControl.setEnabled(!voiceControl.enabled)}>
            Voice control: {voiceControl.preferenceLoaded ? voiceControl.enabled ? 'On' : 'Off' : 'Loading'}
          </button>
        </div>
      </header>

      <div className="voice-status" aria-live="polite" aria-atomic="true">
        <span>{voiceControl.voiceState.message}</span>
        {(voiceControl.voiceState.state === 'permission-required' || voiceControl.voiceState.state === 'error') && voiceControl.enabled && <button type="button" className="tertiary-button" onClick={voiceControl.retry}>Retry voice control</button>}
        {voiceControl.preferenceError && <span role="alert">{voiceControl.preferenceError}</span>}
        {voiceFeedback && <span>{voiceFeedback}</span>}
        {speechFeedback === 'unavailable' && <span>Audio responses are unavailable; status messages remain visible and screen-reader accessible.</span>}
      </div>
      <p className="voice-privacy-note voice-privacy-disclosure">Speech is processed by the browser speech service. AccessApply does not store microphone audio.</p>

      {view === 'profile' && (
        <>
          <main className="profile-content">
            {notice && <div className="notice" role="status">{notice}</div>}
            {saveError && <p className="form-error" role="alert">{saveError}</p>}
            {isOnboarding && <section className="onboarding-panel ui-card" aria-labelledby="onboarding-title"><div><p className="eyebrow">Welcome to AccessApply</p><h2 id="onboarding-title">Create your profile</h2><p>Add your name and a valid email address to get started. You can add skills, education, experience, and links now or update them later.</p><p className="voice-privacy-note">Voice control starts automatically when enabled. Chrome may ask for microphone permission; speech recognition is handled by your browser and AccessApply does not store audio recordings or raw transcripts.</p></div><button type="button" className="secondary-button" onClick={openPersonalEdit}>Enter personal information</button></section>}
            <section className="summary-panel ui-card" aria-labelledby="profile-summary-title"><div className="avatar" aria-hidden="true">{profile.name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'AA'}</div><div><p className="eyebrow">Profile summary</p><h2 id="profile-summary-title">{profile.name || 'Your profile'}</h2>{profile.name && <p className="summary-role">Saved profile information</p>}<div className="summary-details">{profile.email && <span>{profile.email}</span>}{profile.phone && <span>{profile.phone}</span>}{profile.location && <span>{profile.location}</span>}</div></div></section>

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
              <div className="preference-list">{([['highContrast', 'High contrast', 'Increase contrast for easier reading.'], ['reducedMotion', 'Reduced motion', 'Reduce non-essential movement.'], ['largeText', 'Large text', 'Use larger text where supported.']] as Array<[keyof AccessibilityPreferences, string, string]>).map(([key, label, description]) => <label className="preference-row ui-card" key={key}><span><strong>{label}</strong><small>{description}</small></span><span className="setting-control"><input type="checkbox" checked={profile.accessibilityPreferences[key]} onChange={() => updatePreference(key)} /><span>{profile.accessibilityPreferences[key] ? 'On' : 'Off'}</span></span></label>)}</div>
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

          <section className="profile-section ui-card application-form-panel">
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

          <section className="profile-section ui-card review-panel">
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
