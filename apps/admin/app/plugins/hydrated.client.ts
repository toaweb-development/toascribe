// `<html data-hydrated>` once the browser has taken over the server's page. Until then a field typed into is drawn again from the
// app's state and loses what was typed; the end-to-end tests wait for this mark before they type (e2e/helpers/screens.ts).
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('app:suspense:resolve', () => {
    document.documentElement.dataset['hydrated'] = 'true'
  })
})
