<script setup lang="ts">
import Logo from "../base/Logo.vue";
</script>

<template>
  <div class="CoreBoxMockup">
    <div class="CoreBoxMockup-Logo">
      <Logo />
    </div>
    <div class="CoreBoxMockup-Input">
      <input placeholder="Type what you want to search by talex-touch." />
    </div>
    <div class="CoreBoxMockup-Suffix">
      <i />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.CoreBoxMockup {
  padding: 0 0.25rem;
  display: flex;
  width: 70%;
  height: 60px;

  align-items: center;

  gap: 0.25rem;
  border-radius: 18px;
  border: 1px solid #484848;
  background-color: #212121a0;
  backdrop-filter: blur(18px) saturate(180%);
}

.CoreBoxMockup-Suffix {
  display: flex;

  width: 52px;
  height: 52px;

  font-size: 22px;

  align-items: center;
  justify-content: center;
}

.CoreBoxMockup-Suffix i {
  display: block;
  --un-icon: url("data:image/svg+xml;utf8,%3Csvg viewBox='0 0 24 24' width='1em' height='1em' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='currentColor' d='M18 3v2h-1v6l2 3v2h-6v7h-2v-7H5v-2l2-3V5H6V3z'/%3E%3C/svg%3E");

  -webkit-mask: var(--un-icon) no-repeat;
  mask: var(--un-icon) no-repeat;
  -webkit-mask-size: 100% 100%;
  mask-size: 100% 100%;
  background-color: currentColor;
  color: inherit;
  width: 1em;
  height: 1em;
}

.CoreBoxMockup-Logo {
  width: 52px;
  height: 52px;
}

.CoreBoxMockup-Input {
  flex: 1;
  height: 100%;
  input {
    width: 100%;
    height: 100%;

    outline: none;
    border: none;
    background-color: transparent;

    font-size: 22px;
  }
}
</style>
