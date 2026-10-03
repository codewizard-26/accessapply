export interface AccessibilityPreferences {
  voiceEnabled: boolean;
  textToSpeechEnabled: boolean;
  simplifiedText: boolean;
  keyboardNavigation: boolean;
  assistanceLevel: "guide" | "assist" | "act";
  highContrast?: boolean | undefined;
  reducedMotion?: boolean | undefined;
  largeText?: boolean | undefined;
}

export interface Education {
  id?: string | undefined;
  institution: string;
  degree: string;
  field?: string | undefined;
  startYear?: number | undefined;
  endYear?: number | undefined;
}

export interface Experience {
  id?: string | undefined;
  company: string;
  role: string;
  description?: string | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
}

export interface UserProfile {
  name: string;
  email: string;
  phone?: string | undefined;
  location?: string | undefined;
  skills: string[];
  education?: Education[] | undefined;
  experience?: Experience[] | undefined;
  resume?: string | undefined;
  resumeUrl?: string | undefined;
  github?: string | undefined;
  githubUrl?: string | undefined;
  linkedin?: string | undefined;
  linkedinUrl?: string | undefined;
  links?: { linkedin?: string | undefined; github?: string | undefined } | undefined;
  accessibility?: AccessibilityPreferences | undefined;
  accessibilityPreferences?: AccessibilityPreferences | undefined;
}
