import type { BuiltInTaxonomy } from '@toascribe/shared'

import type { MessageT } from './users-messages.ts'

// The words of the category and tag screens that depend on the taxonomy (WordPress' nb_NO translation), each asked for with a literal
// key so the root i18n test sees it in use.

export function termWords(t: MessageT, taxonomy: BuiltInTaxonomy) {
  return taxonomy === 'category'
    ? {
        title: t('terms.categories.title'),
        add: t('terms.categories.add'),
        edit: t('terms.categories.edit'),
        search: t('terms.categories.search'),
        caption: t('terms.categories.caption'),
        empty: t('terms.categories.none'),
        added: t('terms.categories.added'),
        updated: t('terms.categories.updated'),
        deleted: t('terms.categories.deleted'),
        confirmTitle: t('terms.categories.confirmTitle'),
        denied: t('terms.categories.denied'),
      }
    : {
        title: t('terms.tags.title'),
        add: t('terms.tags.add'),
        edit: t('terms.tags.edit'),
        search: t('terms.tags.search'),
        caption: t('terms.tags.caption'),
        empty: t('terms.tags.none'),
        added: t('terms.tags.added'),
        updated: t('terms.tags.updated'),
        deleted: t('terms.tags.deleted'),
        confirmTitle: t('terms.tags.confirmTitle'),
        denied: t('terms.tags.denied'),
      }
}

/** The text for an error code of the terms API, or undefined to fall back to the shared messages. */
export function termErrorText(t: MessageT, code: string | undefined): string | undefined {
  switch (code) {
    case 'term_exists':
      return t('terms.errors.exists')
    case 'invalid_parent':
      return t('terms.errors.invalidParent')
    case 'default_term':
      return t('terms.errors.defaultTerm')
    case 'not_found':
      return t('terms.errors.notFound')
    default:
      return undefined
  }
}
