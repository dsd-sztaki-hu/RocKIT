export type CedarProfileLanguage = 'en' | 'hu';

export function toCedarProfileLanguage(locale: string | undefined): CedarProfileLanguage {
  const language = locale?.trim().toLowerCase().split(/[-_]/, 1)[0];
  return language === 'hu' ? 'hu' : 'en';
}
