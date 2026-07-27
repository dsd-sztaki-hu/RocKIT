export type RecrateLanguage = 'en' | 'hu'

export function toRecrateLanguage(locale: string | undefined): RecrateLanguage {
  const language = locale?.trim().toLowerCase().split(/[-_]/, 1)[0]
  return language === 'hu' ? 'hu' : 'en'
}
