import type { UserProfile } from '../types/profile'
import type { ApplicationField } from '../types/application'

export function getProfileValueForField(profile: UserProfile, fieldId: string): string | undefined {
  switch (fieldId) {
    case 'fullName':
      return profile.name?.trim() || undefined
    case 'email':
      return profile.email?.trim() || undefined
    case 'phone':
      return profile.phone?.trim() || undefined
    case 'location':
      return profile.location?.trim() || undefined
    case 'yearsOfExperience':
      if (!profile.experience?.length) {
        return undefined
      }
      return profile.experience.length > 1 ? '2 years' : '1 year'
    case 'skills':
      return profile.skills?.length ? profile.skills.join(', ') : undefined
    case 'education':
      return profile.education?.length
        ? profile.education.map((item) => `${item.degree} in ${item.field || item.degree} at ${item.institution}`).join(' | ')
        : undefined
    case 'github':
      return profile.github?.trim() || undefined
    case 'linkedin':
      return profile.linkedin?.trim() || undefined
    case 'workAuthorization':
    case 'visaSponsorship':
    case 'coverLetter':
      return undefined
    default:
      return undefined
  }
}

export function mapProfileToApplicationFields(profile: UserProfile): ApplicationField[] {
  const fields: ApplicationField[] = [
    { id: 'fullName', label: 'Full Name', type: 'text', required: true },
    { id: 'email', label: 'Email', type: 'text', required: true },
    { id: 'phone', label: 'Phone', type: 'text', required: false },
    { id: 'location', label: 'Location', type: 'text', required: false },
    { id: 'yearsOfExperience', label: 'Years of Experience', type: 'text', required: true },
    { id: 'skills', label: 'Skills', type: 'textarea', required: true },
    { id: 'education', label: 'Education', type: 'textarea', required: true },
    { id: 'github', label: 'GitHub', type: 'text', required: false },
    { id: 'linkedin', label: 'LinkedIn', type: 'text', required: false },
    { id: 'workAuthorization', label: 'Work Authorization', type: 'select', required: true, options: ['Citizen', 'Permanent Resident', 'Work Visa', 'Student Visa', 'Not authorized'], placeholder: 'Select an answer' },
    { id: 'visaSponsorship', label: 'Visa Sponsorship', type: 'select', required: true, options: ['Yes', 'No', 'Need to discuss'], placeholder: 'Select an answer' },
    { id: 'coverLetter', label: 'Cover Letter', type: 'textarea', required: false, placeholder: 'Share a short note if relevant' },
  ]

  return fields.map((field) => {
    const value = getProfileValueForField(profile, field.id)
    if (value) {
      return { ...field, value, source: 'profile' }
    }

    return { ...field, value: '', source: 'missing' }
  })
}
