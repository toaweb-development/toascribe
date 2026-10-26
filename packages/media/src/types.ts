// The file types the media library takes (K-125): WordPress' `wp_get_mime_types()` as `get_allowed_mime_types()` filters it, with
// these left out (PLAN «Besluttet»: «uten SVG», and the brief: the type is checked from the content):
// - svg (not in WordPress' list either), exe and swf (WordPress removes them always), htm/html and js (WordPress removes them
//   without `unfiltered_html`; toascribe removes them for everyone: a file is a download, never a page or a script), class (Java
//   bytecode);
// - the formats that have no signature to check the content against: wp/wpd, ra/ram, asx/wax/wmx/wm.
// Each entry says which signatures (file-type's names) its content may have; a text type has none and is checked as text.

/** The groups of the library's type filter, as WordPress' («Bilder», «Lyd», «Video», «Dokumenter») plus archives and text. */
export const MEDIA_GROUPS = ['image', 'audio', 'video', 'document', 'spreadsheet', 'archive', 'text'] as const
export type MediaGroup = (typeof MEDIA_GROUPS)[number]

export interface MediaTypeEntry {
  readonly mime: string
  readonly group: MediaGroup
  /** file-type's `ext` values the content may be detected as; empty for text, which has no signature. */
  readonly signatures: readonly string[]
}

const t = (mime: string, group: MediaGroup, signatures: readonly string[]): MediaTypeEntry => ({
  mime,
  group,
  signatures,
})

// file-type tells Word, Excel and PowerPoint files apart by their parts (and reports a macro-enabled or template one as the base type);
// a plain ZIP renamed .docx is not one of them. The formats it has no signature for (iWork, XPS, the rarer ODF ones) are taken as ZIP.
const OOXML_WORD = ['docx']
const OOXML_SHEET = ['xlsx']
const OOXML_SLIDES = ['pptx']
const OLE = ['cfb']

/** Extension (lower case, without the dot) → the type. */
export const MEDIA_TYPES: Readonly<Record<string, MediaTypeEntry>> = {
  // Images
  jpg: t('image/jpeg', 'image', ['jpg']),
  jpeg: t('image/jpeg', 'image', ['jpg']),
  jpe: t('image/jpeg', 'image', ['jpg']),
  gif: t('image/gif', 'image', ['gif']),
  png: t('image/png', 'image', ['png']),
  bmp: t('image/bmp', 'image', ['bmp']),
  tif: t('image/tiff', 'image', ['tif']),
  tiff: t('image/tiff', 'image', ['tif']),
  webp: t('image/webp', 'image', ['webp']),
  avif: t('image/avif', 'image', ['avif']),
  ico: t('image/x-icon', 'image', ['ico', 'cur']),
  heic: t('image/heic', 'image', ['heic', 'heif', 'avif']),
  heif: t('image/heif', 'image', ['heic', 'heif', 'avif']),
  heics: t('image/heic-sequence', 'image', ['heic', 'heif']),
  heifs: t('image/heif-sequence', 'image', ['heic', 'heif']),
  // Video
  asf: t('video/x-ms-asf', 'video', ['asf']),
  wmv: t('video/x-ms-wmv', 'video', ['asf']),
  avi: t('video/avi', 'video', ['avi']),
  divx: t('video/divx', 'video', ['avi']),
  flv: t('video/x-flv', 'video', ['flv']),
  mov: t('video/quicktime', 'video', ['mov', 'mp4']),
  qt: t('video/quicktime', 'video', ['mov', 'mp4']),
  mpeg: t('video/mpeg', 'video', ['mpg']),
  mpg: t('video/mpeg', 'video', ['mpg']),
  mpe: t('video/mpeg', 'video', ['mpg']),
  mp4: t('video/mp4', 'video', ['mp4', 'm4v', 'mov']),
  m4v: t('video/mp4', 'video', ['mp4', 'm4v', 'mov']),
  ogv: t('video/ogg', 'video', ['ogv', 'ogg']),
  webm: t('video/webm', 'video', ['webm', 'mkv']),
  mkv: t('video/x-matroska', 'video', ['mkv', 'webm']),
  '3gp': t('video/3gpp', 'video', ['3gp', 'mp4']),
  '3gpp': t('video/3gpp', 'video', ['3gp', 'mp4']),
  '3g2': t('video/3gpp2', 'video', ['3g2', '3gp', 'mp4']),
  '3gp2': t('video/3gpp2', 'video', ['3g2', '3gp', 'mp4']),
  // Text (no signature: checked as UTF-8 text without control bytes)
  txt: t('text/plain', 'text', []),
  asc: t('text/plain', 'text', []),
  c: t('text/plain', 'text', []),
  cc: t('text/plain', 'text', []),
  h: t('text/plain', 'text', []),
  srt: t('text/plain', 'text', []),
  csv: t('text/csv', 'text', []),
  tsv: t('text/tab-separated-values', 'text', []),
  ics: t('text/calendar', 'text', []),
  rtx: t('text/richtext', 'text', []),
  css: t('text/css', 'text', []),
  vtt: t('text/vtt', 'text', []),
  dfxp: t('application/ttaf+xml', 'text', []),
  // Audio
  mp3: t('audio/mpeg', 'audio', ['mp3']),
  m4a: t('audio/mpeg', 'audio', ['m4a', 'mp4']),
  m4b: t('audio/mpeg', 'audio', ['m4b', 'm4a', 'mp4']),
  aac: t('audio/aac', 'audio', ['aac']),
  wav: t('audio/wav', 'audio', ['wav']),
  ogg: t('audio/ogg', 'audio', ['ogg', 'oga', 'opus']),
  oga: t('audio/ogg', 'audio', ['ogg', 'oga', 'opus']),
  flac: t('audio/flac', 'audio', ['flac']),
  mid: t('audio/midi', 'audio', ['mid']),
  midi: t('audio/midi', 'audio', ['mid']),
  wma: t('audio/x-ms-wma', 'audio', ['asf']),
  mka: t('audio/x-matroska', 'audio', ['mka', 'mkv', 'webm']),
  // Documents and archives
  rtf: t('application/rtf', 'document', ['rtf']),
  pdf: t('application/pdf', 'document', ['pdf']),
  tar: t('application/x-tar', 'archive', ['tar']),
  zip: t('application/zip', 'archive', ['zip']),
  gz: t('application/x-gzip', 'archive', ['gz']),
  gzip: t('application/x-gzip', 'archive', ['gz']),
  rar: t('application/rar', 'archive', ['rar']),
  '7z': t('application/x-7z-compressed', 'archive', ['7z']),
  psd: t('application/octet-stream', 'image', ['psd']),
  xcf: t('application/octet-stream', 'image', ['xcf']),
  doc: t('application/msword', 'document', OLE),
  pot: t('application/vnd.ms-powerpoint', 'document', OLE),
  pps: t('application/vnd.ms-powerpoint', 'document', OLE),
  ppt: t('application/vnd.ms-powerpoint', 'document', OLE),
  wri: t('application/vnd.ms-write', 'document', OLE),
  xla: t('application/vnd.ms-excel', 'spreadsheet', OLE),
  xls: t('application/vnd.ms-excel', 'spreadsheet', OLE),
  xlt: t('application/vnd.ms-excel', 'spreadsheet', OLE),
  xlw: t('application/vnd.ms-excel', 'spreadsheet', OLE),
  mdb: t('application/vnd.ms-access', 'document', OLE),
  mpp: t('application/vnd.ms-project', 'document', OLE),
  docx: t('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document', OOXML_WORD),
  docm: t('application/vnd.ms-word.document.macroEnabled.12', 'document', OOXML_WORD),
  dotx: t('application/vnd.openxmlformats-officedocument.wordprocessingml.template', 'document', OOXML_WORD),
  dotm: t('application/vnd.ms-word.template.macroEnabled.12', 'document', OOXML_WORD),
  xlsx: t('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'spreadsheet', OOXML_SHEET),
  xlsm: t('application/vnd.ms-excel.sheet.macroEnabled.12', 'spreadsheet', OOXML_SHEET),
  xlsb: t('application/vnd.ms-excel.sheet.binary.macroEnabled.12', 'spreadsheet', OOXML_SHEET),
  xltx: t('application/vnd.openxmlformats-officedocument.spreadsheetml.template', 'spreadsheet', OOXML_SHEET),
  xltm: t('application/vnd.ms-excel.template.macroEnabled.12', 'spreadsheet', OOXML_SHEET),
  xlam: t('application/vnd.ms-excel.addin.macroEnabled.12', 'spreadsheet', OOXML_SHEET),
  pptx: t('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'document', OOXML_SLIDES),
  pptm: t('application/vnd.ms-powerpoint.presentation.macroEnabled.12', 'document', OOXML_SLIDES),
  ppsx: t('application/vnd.openxmlformats-officedocument.presentationml.slideshow', 'document', OOXML_SLIDES),
  ppsm: t('application/vnd.ms-powerpoint.slideshow.macroEnabled.12', 'document', OOXML_SLIDES),
  potx: t('application/vnd.openxmlformats-officedocument.presentationml.template', 'document', OOXML_SLIDES),
  potm: t('application/vnd.ms-powerpoint.template.macroEnabled.12', 'document', OOXML_SLIDES),
  ppam: t('application/vnd.ms-powerpoint.addin.macroEnabled.12', 'document', OOXML_SLIDES),
  sldx: t('application/vnd.openxmlformats-officedocument.presentationml.slide', 'document', OOXML_SLIDES),
  sldm: t('application/vnd.ms-powerpoint.slide.macroEnabled.12', 'document', OOXML_SLIDES),
  onetoc: t('application/onenote', 'document', ['one', 'cfb']),
  onetoc2: t('application/onenote', 'document', ['one', 'cfb']),
  onetmp: t('application/onenote', 'document', ['one', 'cfb']),
  onepkg: t('application/onenote', 'document', ['cfb']),
  oxps: t('application/oxps', 'document', ['zip']),
  xps: t('application/vnd.ms-xpsdocument', 'document', ['zip']),
  odt: t('application/vnd.oasis.opendocument.text', 'document', ['odt']),
  odp: t('application/vnd.oasis.opendocument.presentation', 'document', ['odp']),
  ods: t('application/vnd.oasis.opendocument.spreadsheet', 'spreadsheet', ['ods']),
  odg: t('application/vnd.oasis.opendocument.graphics', 'document', ['odg', 'zip']),
  odc: t('application/vnd.oasis.opendocument.chart', 'document', ['odc', 'zip']),
  odb: t('application/vnd.oasis.opendocument.database', 'document', ['odb', 'zip']),
  odf: t('application/vnd.oasis.opendocument.formula', 'document', ['odf', 'zip']),
  key: t('application/vnd.apple.keynote', 'document', ['zip']),
  numbers: t('application/vnd.apple.numbers', 'spreadsheet', ['zip']),
  pages: t('application/vnd.apple.pages', 'document', ['zip']),
}

/** The images the worker makes sizes of (decoded by sharp's prebuilt libvips; HEIC with HEVC is not, so it is kept as a file). */
export const RESIZABLE_MIMES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/tiff',
])

/** The images a browser shows as they are (the original can be the «full» size when it is small enough). */
export const WEB_IMAGE_MIMES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
])

/** The extension of a file name, lower case and without the dot; empty when it has none. */
export function extensionOf(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
}

/** The groups a role may upload when the setting does not limit it: all. */
export function allowedExtensions(groups: readonly MediaGroup[] | undefined): string[] {
  return Object.entries(MEDIA_TYPES)
    .filter(([, entry]) => groups === undefined || groups.includes(entry.group))
    .map(([ext]) => ext)
}
