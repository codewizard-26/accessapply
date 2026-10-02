export type AccessibilityPreferences = {
  highContrast: boolean
  reducedMotion: boolean
  largeText: boolean
}

export type Education = {
  id: string
  institution: string
  degree: string
  field: string
  startYear: number
  endYear?: number
}

export type Experience = {
  id: string
  company: string
  role: string
  description: string
  startDate: string
  endDate?: string
}

export type UserProfile = {
  name: string
  email: string
  phone: string
  location: string
  skills: string[]
  education: Education[]
  experience: Experience[]
  resume?: string
  github?: string
  linkedin?: string
  accessibilityPreferences: AccessibilityPreferences
}
