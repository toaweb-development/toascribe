<script setup lang="ts">
import type { MeResponse } from '@toascribe/shared'

// «Profilbilde» (M1.8, K-015): an image from the media library, saved as soon as it is chosen or removed, like the personal choices
// above. Without one the initials are shown (or Gravatar's picture, when «Personvern» allows it). The image must be one anyone may
// see: it is shown on the site and to every other account.
const props = defineProps<{ me: MeResponse }>()
const emit = defineEmits<{ saved: [me: MeResponse] }>()

const { t } = useI18n()
const meApi = useMeApi()
const avatarId = ref<string | null>(props.me.profile.avatarId)
const saving = ref(false)
const message = ref('')
const failure = ref<string>()

watch(avatarId, async (next, before) => {
  if (next === props.me.profile.avatarId) return
  saving.value = true
  message.value = ''
  failure.value = undefined
  try {
    const saved = await meApi.updateProfile({ avatarId: next })
    emit('saved', saved)
    message.value = next === null ? t('profile.avatar.removed') : t('profile.avatar.saved')
  } catch (caught) {
    failure.value =
      caught instanceof ApiRequestError && caught.code === 'invalid_media'
        ? t('profile.avatar.notPublic')
        : describeApiError(caught, t)
    avatarId.value = before
  } finally {
    saving.value = false
  }
})
</script>

<template>
  <ProfileSection id="avatar" :title="$t('profile.avatar.title')">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-start">
      <UAvatar :src="me.avatarUrl ?? undefined" :alt="me.displayName" size="3xl" />
      <div class="flex min-w-0 flex-1 flex-col gap-3" :aria-busy="saving">
        <ContentFeaturedImage
          v-model="avatarId"
          :label="$t('profile.avatar.label')"
          :help="$t('profile.avatar.help')"
        />
        <p role="status" class="text-sm text-default">{{ message }}</p>
        <UAlert v-if="failure" color="error" variant="subtle" role="alert" :title="failure" />
      </div>
    </div>
  </ProfileSection>
</template>
