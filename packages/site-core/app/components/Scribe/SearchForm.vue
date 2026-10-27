<script setup lang="ts">
// The search form (PLAN «Regler» 4): a plain GET to `/?s=`, so it works without script.
const { t } = useI18n()
const { archive } = useContent()
const id = useId()
const value = computed(() => (archive.value?.type === 'search' ? archive.value.query : ''))
</script>

<template>
  <form class="scribe-search" role="search" action="/" method="get">
    <label :for="id">{{ t('scribe.search.label') }}</label>
    <input :id="id" type="search" name="s" :value="value" maxlength="200" />
    <button type="submit">{{ t('scribe.search.submit') }}</button>
  </form>
</template>
