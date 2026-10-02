export interface UserProfile {
  name: string;
  email: string;
  phone?: string;

  location?: string;

  skills: string[];

  education?: {
    institution: string;
    degree: string;
    field?: string;
    startYear?: number;
    endYear?: number;
  }[];

  experience?: {
    company: string;
    role: string;
    startDate?: string;
    endDate?: string;
    description?: string;
  }[];

  resumeUrl?: string;

  githubUrl?: string;
  linkedinUrl?: string;

  accessibility: AccessibilityPreferences;
}

export interface AccessibilityPreferences {
  voiceEnabled: boolean;
  textToSpeechEnabled: boolean;
  simplifiedText: boolean;
  keyboardNavigation: boolean;

  assistanceLevel: "guide" | "assist" | "act";
}