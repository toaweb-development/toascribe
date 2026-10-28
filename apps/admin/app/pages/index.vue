<script setup lang="ts">
// The dashboard, «Kontrollpanel» (WordPress' wp-admin/index.php): notices, the welcome panel, «I korte trekk», and since M1.8
// (K-033) «Aktivitet» and «Hurtigutkast» for accounts that write posts and «Nettstedshelse-status» for administrators. Each part
// loads and fails by itself, so one that cannot load does not take the others with it.
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t } = useI18n()
const auth = useAuth()
useSeoMeta({ title: () => t('dashboard.title') })

const can = (capability: string) =>
  auth.session.value.status === 'authenticated' && auth.session.value.account.capabilities.includes(capability)
const writes = computed(() => can('edit_posts'))
const manages = computed(() => can('manage_options'))
</script>

<template>
  <UDashboardPanel id="dashboard">
    <template #header>
      <UDashboardNavbar :title="$t('dashboard.title')" />
    </template>

    <template #body>
      <!-- One block: the panel body is a flex column, and a card in it would shrink and clip its text. -->
      <div class="flex flex-col gap-4 sm:gap-6">
        <DashboardNotices />
        <DashboardWelcome />
        <div class="grid grid-cols-1 items-start gap-4 sm:gap-6 xl:grid-cols-2">
          <div class="flex flex-col gap-4 sm:gap-6">
            <DashboardGlance />
            <DashboardHealth v-if="manages" />
            <DashboardActivity v-if="writes" />
          </div>
          <div v-if="writes" class="flex flex-col gap-4 sm:gap-6">
            <DashboardQuickDraft />
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
