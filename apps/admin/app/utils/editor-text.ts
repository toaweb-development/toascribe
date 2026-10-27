import type { InserterCategory } from './editor-blocks.ts'
import type { MessageT } from './users-messages.ts'

// The editor's words that come from a value (a spacer's size, an inserter category). The keys are written out, so the i18n test finds
// every one of them.

export function spacerSizeLabel(t: MessageT, size: string): string {
  switch (size) {
    case 'small':
      return t('editor.spacer.small')
    case 'large':
      return t('editor.spacer.large')
    case 'x-large':
      return t('editor.spacer.xLarge')
    default:
      return t('editor.spacer.medium')
  }
}

export function categoryLabel(t: MessageT, category: InserterCategory): string {
  switch (category) {
    case 'text':
      return t('editor.inserter.text')
    case 'media':
      return t('editor.inserter.media')
    case 'design':
      return t('editor.inserter.design')
    case 'widgets':
      return t('editor.inserter.widgets')
    default:
      return category satisfies never
  }
}
