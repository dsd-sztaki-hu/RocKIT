import { nls } from '@theia/core/lib/common/nls'

export type LocalizableValidationError = {
  error?: string
  error_hu?: string
}

export function isHungarianLocale(): boolean {
  const languageId =
    nls.localization?.languageId ?? nls.locale ?? nls.defaultLocale
  return languageId.toLowerCase().startsWith('hu')
}

export function localizeValidationErrorMessage(
  error: LocalizableValidationError,
): string | undefined {
  if (isHungarianLocale() && error.error_hu?.trim()) {
    return error.error_hu
  }
  return error.error
}

export function localizeRoCrateEntityType(entityType: string): string {
  if (!isHungarianLocale()) {
    return entityType
  }

  const typeName = entityType.split(/[\/#]/).pop()?.trim() ?? entityType
  if (typeName === 'Dataset') {
    return nls.localize('rockit/validation/dataset', 'Dataset')
  }
  if (typeName === 'File') {
    return nls.localize('rockit/validation/file', 'File')
  }
  return entityType
}
