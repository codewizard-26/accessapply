import type { UserProfile } from '../types/profile'

export const mockProfile: UserProfile = {
  name: 'Alex Johnson',
  email: 'alex@example.com',
  phone: '9876543210',
  location: 'Mumbai, India',
  skills: ['React', 'TypeScript', 'Node.js', 'Tailwind CSS'],
  education: [
    {
      id: 'edu-1',
      institution: 'Example University',
      degree: 'B.Tech',
      field: 'Computer Science',
      startYear: 2022,
      endYear: 2026,
    },
  ],
  experience: [
    {
      id: 'exp-1',
      company: 'Example Technologies',
      role: 'Frontend Developer Intern',
      description: 'Built React-based web interfaces.',
      startDate: '2025-06',
      endDate: '2025-12',
    },
  ],
  resume: 'alex-johnson-resume.pdf',
  github: 'https://github.com/example',
  linkedin: 'https://linkedin.com/in/example',
  accessibilityPreferences: {
    highContrast: false,
    reducedMotion: false,
    largeText: false,
  },
}
