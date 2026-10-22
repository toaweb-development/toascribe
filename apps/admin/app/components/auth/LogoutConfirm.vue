<script setup lang="ts">
// wp-login.php?action=logout asks first («Du forsøker å logge ut …»): a link in a mail or a prefetch must not end a session.
// The call is a POST with the CSRF token.
const emit = defineEmits<{ loggedOut: [] }>()

const { t } = useI18n()
const auth = useAuth()
const siteName = useSiteName()

const submitting = ref(false)
const error = ref<string>()
const failures = ref(0)

async function logout() {
  submitting.value = true
  error.value = undefined
  try {
    await auth.logout()
    emit('loggedOut')
  } catch (caught) {
    if (caught instanceof ApiRequestError && caught.status === 401) {
      emit('loggedOut') // already gone, which is what was asked for
      return
    }
    error.value = describeApiError(caught, t)
    failures.value += 1
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <p class="text-base text-default">{{ $t('auth.logout.question', { site: siteName }) }}</p>
    <AuthMessage v-if="error" :key="failures" kind="error" focus>{{ error }}</AuthMessage>
    <div class="flex flex-col gap-2">
      <UButton size="xl" block class="min-h-11" :loading="submitting" @click="logout">{{
        $t('auth.logout.submit')
      }}</UButton>
      <UButton to="/" color="neutral" variant="outline" size="xl" block class="min-h-11">{{
        $t('auth.logout.cancel')
      }}</UButton>
    </div>
  </div>
</template>
