export type ApplicationFieldType = 'text' | 'textarea' | 'select' | 'checkbox'

export type FieldSource = 'profile' | 'user' | 'missing'

export type ApplicationField = {
  id: string
  label: string
  type: ApplicationFieldType
  required: boolean
  value?: string
  source?: FieldSource
  options?: string[]
  placeholder?: string
}
