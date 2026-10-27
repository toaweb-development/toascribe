<script setup lang="ts">
// The frame around every template: a skip link, the core's head (ScribeHead: title, description, the toolbar), the site's name and
// tagline (with the logo from «Tilpass» when there is one), the search, the content, and the core's footer (ScribeFooter). Landmarks: banner, main, contentinfo (WCAG 1.3.1, 2.4.1).
const { t } = useI18n()
const settings = useSettings()
const customize = useCustomize()
</script>

<template>
  <div class="theme-site">
    <a href="#innhold" class="theme-skip">{{ t('theme.skip') }}</a>
    <ScribeHead />
    <header class="theme-header">
      <div class="theme-wrap theme-header-inner">
        <div>
          <a href="/" class="theme-site-title">
            <img
              v-if="customize.logo"
              :src="customize.logo.url"
              :width="customize.logo.width ?? undefined"
              :height="customize.logo.height ?? undefined"
              alt=""
              class="theme-logo"
            />
            <span>{{ settings?.title || t('brand.name') }}</span>
          </a>
          <p v-if="settings?.tagline" class="theme-tagline">{{ settings.tagline }}</p>
        </div>
        <ScribeSearchForm />
      </div>
      <div class="theme-wrap">
        <ThemeNavigation />
      </div>
    </header>
    <main id="innhold" class="theme-wrap theme-main" tabindex="-1">
      <slot />
    </main>
    <footer class="theme-footer">
      <div class="theme-wrap theme-footer-inner">
        <!-- The theme's «Bunntekst» set (theme.json `globalSets`), edited in «Utseende → Globale sett». -->
        <ScribeGlobalSet slug="bunntekst" />
        <ThemeFooterMenu />
        <p>{{ settings?.title ? t('theme.footer', { site: settings.title }) : t('theme.poweredBy') }}</p>
        <p v-if="settings?.privacyPolicyPath">
          <a :href="settings.privacyPolicyPath">{{ t('theme.privacy') }}</a>
        </p>
      </div>
      <ScribeFooter />
    </footer>
  </div>
</template>
