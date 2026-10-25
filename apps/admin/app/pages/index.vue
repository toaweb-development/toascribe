<script setup lang="ts">
// The dashboard, «Kontrollpanel» (WordPress' wp-admin/index.php): notices, the welcome panel and «I korte trekk». Each part loads and
// fails by itself, so one that cannot load does not take the others with it. WordPress' «Nettstedshelse-status» comes with the
// site health screen, later; the old line with the API's health check had no place left on a dashboard and is gone from here.
definePageMeta({ layout: 'dashboard', middleware: 'signed-in' })

const { t } = useI18n()
useSeoMeta({ title: () => t('dashboard.title') })
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
        <DashboardGlance />
      </div>
    </template>
  </UDashboardPanel>
</template>
