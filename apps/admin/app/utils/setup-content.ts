// The names of the default content the install makes, for the wizard's «what will be created» step. They are the names in
// packages/db/src/default-content/strings.ts (WordPress' own, bokmål from its nb_NO translation, English for any other
// language); a test compares the two, so they cannot drift apart.

export interface DefaultContentNames {
  post: string
  page: string
  privacyPage: string
  category: string
}

const NB: DefaultContentNames = {
  post: 'Hei, verden!',
  page: 'Testside',
  privacyPage: 'Personvernerklæring',
  category: 'Ukategorisert',
}

const EN: DefaultContentNames = {
  post: 'Hello world!',
  page: 'Sample Page',
  privacyPage: 'Privacy Policy',
  category: 'Uncategorized',
}

/** Only `nb` has a text of its own; every other language gets WordPress' English. */
export function defaultContentNames(locale: string): DefaultContentNames {
  return locale === 'nb' ? NB : EN
}
