// What every settings screen does the same way (M1.5): only for `manage_options` (403 on the server otherwise), the values read once,
// a form that starts from them, and «Lagre endringer» that sends only what changed. The screen gives its form's fields and how to
// read and write its group.
export function useSettingsScreen<S extends Record<string, unknown>, A extends { settings: S }>(options: {
  readonly key: string
  readonly load: () => Promise<A>
  readonly save: (changes: Partial<S>) => Promise<A>
}) {
  const auth = useAuth()
  const { t } = useI18n()
  const mayManage = computed(
    () =>
      auth.session.value.status === 'authenticated' &&
      auth.session.value.account.capabilities.includes('manage_options'),
  )
  if (import.meta.server && !mayManage.value) {
    const event = useRequestEvent()
    if (event) setResponseStatus(event, 403)
  }
  const { data, error, refresh } = useAsyncData(options.key, async () => (mayManage.value ? options.load() : null))
  const form = ref({}) as Ref<S>
  watch(
    data,
    (loaded) => {
      if (loaded) form.value = structuredClone(toRaw(loaded.settings))
    },
    { immediate: true },
  )

  const saving = ref(false)
  const report = ref<string>()
  const failure = ref<string>()

  /** Sends what differs from the stored values, plus `extra` (a field that is not a stored value, such as a new address). */
  async function save(extra: Record<string, unknown> = {}): Promise<boolean> {
    const before = data.value?.settings
    if (!before || saving.value) return false
    const changes = Object.fromEntries(
      Object.entries(form.value).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key])),
    ) as Partial<S>
    const request = { ...changes, ...extra } as Partial<S>
    report.value = undefined
    failure.value = undefined
    if (Object.keys(request).length === 0) {
      report.value = t('settings.saved')
      return true
    }
    saving.value = true
    try {
      data.value = await options.save(request)
      report.value = t('settings.saved')
      return true
    } catch (caught) {
      failure.value = describeApiError(caught, t)
      return false
    } finally {
      saving.value = false
    }
  }

  return { mayManage, data, error, refresh, form, save, saving, report, failure }
}
