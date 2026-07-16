import { toCedarProfileLanguage } from './cedar-profile-language';

describe('toCedarProfileLanguage', () => {
  it.each(['hu', 'HU', 'hu-HU', 'hu_HU'])(
    'maps %s to Hungarian',
    (locale) => {
      expect(toCedarProfileLanguage(locale)).toBe('hu');
    },
  );

  it.each([undefined, '', 'en', 'en-US', 'de'])(
    'maps %s to the English fallback',
    (locale) => {
      expect(toCedarProfileLanguage(locale)).toBe('en');
    },
  );
});
