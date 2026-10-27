<script setup lang="ts">
// The form of a password-protected item (K-067; PLAN «Regler» 4). The password goes to the api, which sets a cookie for ten days
// when it is right; the item is then read again with it. Only the form is ever drawn before that: the api sends no text.

const props = defineProps<{ contentId: string }>()
const { t } = useI18n()
const publicApi = usePublicApi()
const refresh = useScribeRefresh()
const id = useId()
const password = ref('')
const busy = ref(false)
const message = ref('')

async function submit() {
  if (password.value === '' || busy.value) return
  busy.value = true
  message.value = ''
  try {
    await publicApi.unlock(props.contentId, password.value)
    password.value = ''
    await refresh()
  } catch (error) {
    message.value =
      error instanceof ApiRequestError && error.status === 429
        ? t('scribe.password.wait')
        : error instanceof ApiRequestError && error.code === 'wrong_password'
          ? t('scribe.password.wrong')
          : t('scribe.password.failed')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="scribe-password" @submit.prevent="submit">
    <p>{{ t('scribe.password.intro') }}</p>
    <label :for="id">{{ t('scribe.password.label') }}</label>
    <input :id="id" v-model="password" type="password" name="password" autocomplete="off" required maxlength="255" />
    <button type="submit" :disabled="busy">{{ t('scribe.password.submit') }}</button>
    <p class="scribe-password-message" role="status">{{ message }}</p>
  </form>
</template>
