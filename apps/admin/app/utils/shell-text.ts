// Texts the api names by key. The menu items and the notices come from the api with an i18n key as their label (never the text:
// an extension adds its own item and its own message file). Each key the core registers is asked for here with a literal
// translate call, so the root test (test/i18n-strings.test.ts) sees that the message is in use, and a key the catalogue does not
// have falls back to a plain sentence instead of printing the key or logging a warning for every render.

/** vue-i18n's `t` and `te`, as far as they are used here. */
export interface Translator {
  t: (key: string, named?: Record<string, string | number | boolean | null>) => string
  te: (key: string) => boolean
}

/** The label of a menu item or sub-item. */
export function menuLabel({ t, te }: Translator, key: string): string {
  switch (key) {
    case 'menu.dashboard':
      return t('menu.dashboard')
    case 'menu.dashboardHome':
      return t('menu.dashboardHome')
    case 'menu.posts':
      return t('menu.posts')
    case 'menu.postsAll':
      return t('menu.postsAll')
    case 'menu.postsNew':
      return t('menu.postsNew')
    case 'menu.postsCategories':
      return t('menu.postsCategories')
    case 'menu.postsTags':
      return t('menu.postsTags')
    case 'menu.media':
      return t('menu.media')
    case 'menu.mediaLibrary':
      return t('menu.mediaLibrary')
    case 'menu.mediaNew':
      return t('menu.mediaNew')
    case 'menu.pages':
      return t('menu.pages')
    case 'menu.pagesAll':
      return t('menu.pagesAll')
    case 'menu.pagesNew':
      return t('menu.pagesNew')
    case 'menu.users':
      return t('menu.users')
    case 'menu.usersAll':
      return t('menu.usersAll')
    case 'menu.usersProfile':
      return t('menu.usersProfile')
    case 'menu.profile':
      return t('menu.profile')
    case 'menu.settings':
      return t('menu.settings')
    case 'menu.appearance':
      return t('menu.appearance')
    case 'menu.appearanceMenus':
      return t('menu.appearanceMenus')
    case 'menu.appearanceCustomize':
      return t('menu.appearanceCustomize')
    case 'menu.appearanceGlobalSets':
      return t('menu.appearanceGlobalSets')
    case 'menu.settingsGeneral':
      return t('menu.settingsGeneral')
    case 'menu.settingsWriting':
      return t('menu.settingsWriting')
    case 'menu.settingsReading':
      return t('menu.settingsReading')
    case 'menu.settingsMedia':
      return t('menu.settingsMedia')
    case 'menu.settingsPermalinks':
      return t('menu.settingsPermalinks')
    case 'menu.settingsPrivacy':
      return t('menu.settingsPrivacy')
    default:
      return te(key) ? t(key) : t('menu.unknown')
  }
}

/** The text of a notice, with the values the api gave it (`{address}`). */
export function noticeText(
  { t, te }: Translator,
  key: string,
  data: Record<string, string | number | boolean | null>,
): string {
  switch (key) {
    case 'notices.emailNotVerified':
      return t('notices.emailNotVerified', data)
    case 'notices.proxyNotTrusted':
      return t('notices.proxyNotTrusted', data)
    case 'notices.setupEmailSkipped':
      return t('notices.setupEmailSkipped', data)
    default:
      return te(key) ? t(key, data) : t('notices.unknown')
  }
}

/** The word a screen reader hears before a notice, because its colour and icon say it only to the eye. */
export function noticeLevelLabel({ t }: Translator, level: 'error' | 'warning' | 'success' | 'info'): string {
  switch (level) {
    case 'error':
      return t('dashboard.notices.level.error')
    case 'warning':
      return t('dashboard.notices.level.warning')
    case 'success':
      return t('dashboard.notices.level.success')
    case 'info':
      return t('dashboard.notices.level.info')
  }
}
