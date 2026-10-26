import type { ValidationIssue } from '@toascribe/blocks'

/**
 * The editor's words for blocks: a block type's name and what a validation issue means, in the admin's language. The keys are
 * written out (not built from the type), so the i18n test finds every one of them.
 */
export function useBlockText() {
  const { t } = useI18n()

  const titles: Readonly<Record<string, () => string>> = {
    'core/paragraph': () => t('blocks.paragraph'),
    'core/image': () => t('blocks.image'),
    'core/columns': () => t('blocks.columns'),
    'core/column': () => t('blocks.column'),
  }

  const issues: Readonly<Record<ValidationIssue['code'], () => string>> = {
    invalid_shape: () => t('editorPrototype.issues.invalidShape'),
    invalid_id: () => t('editorPrototype.issues.invalidId'),
    duplicate_id: () => t('editorPrototype.issues.duplicateId'),
    unknown_block: () => t('editorPrototype.issues.unknownBlock'),
    unsupported_version: () => t('editorPrototype.issues.unsupportedVersion'),
    not_allowed_here: () => t('editorPrototype.issues.notAllowedHere'),
    unknown_attribute: () => t('editorPrototype.issues.unknownAttribute'),
    invalid_attribute: () => t('editorPrototype.issues.invalidAttribute'),
    child_count: () => t('editorPrototype.issues.childCount'),
    too_large: () => t('editorPrototype.issues.tooLarge'),
    alt_required: () => t('editorPrototype.issues.altRequired'),
  }

  const isKnown = (code: string): code is ValidationIssue['code'] => Object.hasOwn(issues, code)

  return {
    /** The name of a block type («Avsnitt»), or the type itself for one the admin does not know. */
    title: (type: string): string => titles[type]?.() ?? type,
    /** What an issue means. A code the editor does not know (from a newer api) gets the general text. */
    issue: (code: string): string => (isKnown(code) ? issues[code] : issues.invalid_attribute)(),
  }
}
