export interface AccessibilityPreferences {
  highContrast: boolean
  reducedMotion: boolean
  largeText: boolean
}

export interface Education {
  id: string
  institution: string
  degree: string
  field: string
  startYear: number
  endYear?: number
}

export interface Experience {
  id: string
  company: string
  role: string
  description: string
  startDate: string
  endDate?: string
}

export interface UserProfile {
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
