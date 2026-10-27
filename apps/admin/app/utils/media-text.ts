import type { MediaFailure, MediaGroup, MediaProcessing } from '@toascribe/shared'

import { statusLabel } from './content-text.ts'
import type { MessageT } from './users-messages.ts'

// The words of the media library (M1.2; WordPress' nb_NO translation, checked by the researcher), each asked for with a literal key so
// the root i18n test sees it in use.

/** The type filter's names (WordPress: «Bilder», «Lyd», «Video», «Dokumenter», «Regneark», «Arkiver»), and plain text. */
export function groupLabel(t: MessageT, group: MediaGroup): string {
  switch (group) {
    case 'image':
      return t('media.groups.image')
    case 'audio':
      return t('media.groups.audio')
    case 'video':
      return t('media.groups.video')
    case 'document':
      return t('media.groups.document')
    case 'spreadsheet':
      return t('media.groups.spreadsheet')
    case 'archive':
      return t('media.groups.archive')
    case 'text':
      return t('media.groups.text')
    default:
      return group satisfies never
  }
}

export function processingLabel(t: MessageT, processing: MediaProcessing): string | undefined {
  switch (processing) {
    case 'pending':
      return t('media.processing.pending')
    case 'failed':
      return t('media.processing.failed')
    case 'ready':
      return undefined
    default:
      return processing satisfies never
  }
}

/** Why the worker could not make the sizes, from its code (MEDIA_FAILURES). */
export function failureText(t: MessageT, failure: MediaFailure): string {
  switch (failure) {
    case 'too_many_pixels':
      return t('media.processing.reasons.tooManyPixels')
    case 'unreadable_image':
      return t('media.processing.reasons.unreadable')
    case 'missing_file':
      return t('media.processing.reasons.missingFile')
    case 'worker_stopped':
      return t('media.processing.reasons.workerStopped')
    case 'unknown':
      return t('media.processing.reasons.unknown')
    default:
      return failure satisfies never
  }
}

/** The text for an error code of the media API, or undefined to fall back to the shared messages. */
export function mediaErrorText(t: MessageT, code: string | undefined): string | undefined {
  switch (code) {
    case 'file_too_large':
      return t('media.errors.fileTooLarge')
    case 'unsupported_type':
      return t('media.errors.unsupportedType')
    case 'type_mismatch':
      return t('media.errors.typeMismatch')
    case 'empty_file':
      return t('media.errors.emptyFile')
    case 'unreadable_image':
      return t('media.errors.unreadableImage')
    case 'image_too_large':
      return t('media.errors.imageTooLarge')
    case 'invalid_folder':
      return t('media.errors.invalidFolder')
    case 'invalid_attached_to':
      return t('media.errors.invalidAttachedTo')
    case 'folder_exists':
      return t('media.errors.folderExists')
    case 'fetch_failed':
      return t('media.errors.fetchFailed')
    case 'not_editable':
      return t('media.errors.notEditable')
    case 'media_busy':
      return t('media.errors.busy')
    case 'invalid_edit':
      return t('media.errors.invalidEdit')
    case 'above_upload_cap':
      return t('media.errors.aboveUploadCap')
    case 'aborted':
      return t('media.errors.aborted')
    default:
      return undefined
  }
}

/** Bytes as WordPress writes them in nb_NO: «64 MB», «1,5 MB», «820 kB». */
export function formatBytes(bytes: number, locale = 'nb-NO'): string {
  const units = ['B', 'kB', 'MB', 'GB'] as const
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${units[unit] ?? 'B'}`
}

const CONTENT_STATUSES = ['draft', 'pending', 'future', 'publish', 'private'] as const
type ShownStatus = (typeof CONTENT_STATUSES)[number]

const isShownStatus = (status: string): status is ShownStatus =>
  (CONTENT_STATUSES as readonly string[]).includes(status)

/** The status of an item in «Brukes på»; a status the lists do not name (the bin) as WordPress' «Papirkurv». */
export function usageStatus(t: MessageT, status: string): string {
  if (isShownStatus(status)) return statusLabel(t, status)
  return status === 'trash' ? t('media.details.inTrash') : status
}
