<script setup lang="ts">
// «Hurtigutkast» (M1.8, K-033; WordPress' Quick Draft): a title and some text saved as a draft post, and the account's own three
// newest drafts. The text becomes paragraphs as the editor reads pasted text (an empty line starts a new one). For accounts that can
// write posts (`edit_posts`); the api checks it again.
import { textToParagraphs } from '@toascribe/blocks'

const { t, locale } = useI18n()
const auth = useAuth()
const contentApi = useContentApi()

const accountId = computed(() =>
  auth.session.value.status === 'authenticated' ? auth.session.value.account.id : undefined,
)

const { data: drafts, refresh } = await useAsyncData(
  'dashboard:drafts',
  async () =>
    accountId.value === undefined
      ? null
      : contentApi.list({
          type: 'post',
          status: 'draft',
          author: accountId.value,
          orderby: 'modified',
          order: 'desc',
          per_page: 3,
        }),
  { watch: [accountId] },
)

const state = reactive({ title: '', content: '' })
const saving = ref(false)
const failure = ref<string>()
const empty = ref(false)
const saved = ref<{ id: string; title: string }>()

async function save(): Promise<void> {
  failure.value = undefined
  saved.value = undefined
  empty.value = state.title.trim() === '' && state.content.trim() === ''
  if (empty.value) return
  saving.value = true
  try {
    const item = await contentApi.create({
      type: 'post',
      status: 'draft',
      title: state.title.trim(),
      blocks: textToParagraphs(state.content),
    })
    saved.value = { id: item.id, title: item.title }
    state.title = ''
    state.content = ''
    await refresh()
  } catch (caught) {
    failure.value = describeApiError(caught, t)
  } finally {
    saving.value = false
  }
}

const format = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, {
      dateStyle: 'medium',
      timeZone: drafts.value?.timeZone ?? 'UTC',
    }),
)
</script>

<template>
  <UCard as="section" aria-labelledby="quick-draft-heading">
    <template #header>
      <h2 id="quick-draft-heading" class="text-lg font-semibold text-highlighted">
        {{ $t('dashboard.quickDraft.heading') }}
      </h2>
    </template>

    <form class="flex flex-col gap-4" novalidate @submit.prevent="save">
      <UFormField name="quick-draft-title" :label="$t('dashboard.quickDraft.title')">
        <UInput id="quick-draft-title" v-model="state.title" size="lg" class="w-full" maxlength="500" />
      </UFormField>
      <UFormField
        name="quick-draft-content"
        :label="$t('dashboard.quickDraft.content')"
        :error="empty ? $t('dashboard.quickDraft.empty') : undefined"
      >
        <UTextarea
          id="quick-draft-content"
          v-model="state.content"
          :placeholder="$t('dashboard.quickDraft.placeholder')"
          :rows="4"
          autoresize
          size="lg"
          class="w-full"
        />
      </UFormField>
      <div>
        <UButton type="submit" size="lg" class="min-h-11" :loading="saving">
          {{ $t('dashboard.quickDraft.save') }}
        </UButton>
      </div>
      <p v-if="failure" role="alert" class="font-medium text-error">
        {{ $t('dashboard.quickDraft.failed') }} {{ failure }}
      </p>
      <p v-if="saved" role="status" class="text-base text-default">
        {{ $t('dashboard.quickDraft.saved') }}
        <ULink :to="`/posts/${saved.id}`" class="text-primary underline underline-offset-4 hover:no-underline">
          {{ $t('dashboard.quickDraft.edit') }}
        </ULink>
      </p>
    </form>

    <section v-if="drafts && drafts.items.length > 0" aria-labelledby="quick-draft-list" class="mt-6">
      <h3 id="quick-draft-list" class="text-base font-semibold text-highlighted">
        {{ $t('dashboard.quickDraft.yourDrafts') }}
      </h3>
      <ul class="mt-1 flex flex-col">
        <li v-for="item in drafts.items" :key="item.id" class="flex flex-wrap items-center gap-x-3">
          <ULink
            :to="`/posts/${item.id}`"
            class="inline-flex min-h-11 items-center text-primary underline underline-offset-4 hover:no-underline lg:min-h-8"
          >
            {{ item.title === '' ? $t('dashboard.activity.untitled') : item.title }}
          </ULink>
          <span class="text-sm text-toned">{{ format.format(new Date(item.modifiedAt)) }}</span>
        </li>
      </ul>
      <ULink
        :to="{ path: '/posts', query: { status: 'draft' } }"
        class="inline-flex min-h-11 items-center text-primary underline underline-offset-4 hover:no-underline lg:min-h-8"
      >
        {{ $t('dashboard.quickDraft.allDrafts') }}
      </ULink>
    </section>
  </UCard>
</template>
