<script lang="ts" setup>
import Logo from '/images/logo.svg'
import DefaultTheme from 'vitepress/theme'

const { Layout } = DefaultTheme
</script>

<template>
  <Layout>
    <template #nav-bar-title-before>
      <img width="32" :src="Logo" alt="logo" />
    </template>
  </Layout>
</template>
