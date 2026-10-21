import type { FormInputEvents } from '@nuxt/ui'

/**
 * When a form checks its fields. Nuxt UI checks on blur by default, and that is a trap on a short form: leaving a field
 * writes its error under it, the submit button moves down, and the click or tap that made the field lose focus lands on the
 * place where the button was and does nothing. The same happens when an error goes away at that moment. So nothing is
 * checked until the first submit; after a failed one the fields are checked while they are typed in (`input`, with
 * `eager-validation` on each field, because Nuxt UI otherwise waits for the first blur), so a person fixing a mistake sees it
 * go away before the button is pressed, and never because of the press. (workflows §13: errors only after a reasonable
 * chance to answer.)
 *
 * Use `validateOn` as `:validate-on` of the form, `eager-validation` on its `UFormField`s, and call `failed()` from its `@error`.
 */
export function useSubmitValidation() {
  const attempted = ref(false)
  const validateOn = computed<FormInputEvents[]>(() => (attempted.value ? ['input'] : []))
  return {
    validateOn,
    failed: () => {
      attempted.value = true
    },
  }
}
