import type { PermissionIssueCode, ValidationIssue } from '@toascribe/blocks'

/**
 * The editor's words for blocks: a block type's name and what a validation issue means, in the admin's language. The keys are
 * written out (not built from the type), so the i18n test finds every one of them.
 */
export function useBlockText() {
  const { t } = useI18n()

  const titles: Readonly<Record<string, () => string>> = {
    'core/paragraph': () => t('blocks.paragraph'),
    'core/heading': () => t('blocks.heading'),
    'core/list': () => t('blocks.list'),
    'core/list-item': () => t('blocks.listItem'),
    'core/quote': () => t('blocks.quote'),
    'core/code': () => t('blocks.code'),
    'core/preformatted': () => t('blocks.preformatted'),
    'core/table': () => t('blocks.table'),
    'core/image': () => t('blocks.image'),
    'core/gallery': () => t('blocks.gallery'),
    'core/buttons': () => t('blocks.buttons'),
    'core/button': () => t('blocks.button'),
    'core/columns': () => t('blocks.columns'),
    'core/column': () => t('blocks.column'),
    'core/group': () => t('blocks.group'),
    'core/separator': () => t('blocks.separator'),
    'core/spacer': () => t('blocks.spacer'),
    'core/more': () => t('blocks.more'),
    'core/nextpage': () => t('blocks.nextpage'),
    'core/html': () => t('blocks.html'),
    'core/query': () => t('blocks.query'),
  }

  const issues: Readonly<Record<ValidationIssue['code'] | PermissionIssueCode, () => string>> = {
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
    capability_required: () => t('editorPrototype.issues.capabilityRequired'),
    wrong_content_type: () => t('editorPrototype.issues.wrongContentType'),
  }

  const isKnown = (code: string): code is ValidationIssue['code'] | PermissionIssueCode => Object.hasOwn(issues, code)

  return {
    /** The name of a block type («Avsnitt»), or the type itself for one the admin does not know. */
    title: (type: string): string => titles[type]?.() ?? type,
    /** What an issue means. A code the editor does not know (from a newer api) gets the general text. */
    issue: (code: string): string => (isKnown(code) ? issues[code] : issues.invalid_attribute)(),
  }
}
