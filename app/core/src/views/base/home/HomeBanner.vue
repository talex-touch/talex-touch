<script setup lang="ts" name="HomerBanner">
import Wallpaper from '~/assets/bg/wallpaper.png'

const props = defineProps<{
  modelValue?: boolean;
}>();

const oneWord = ref("");

function getOneWord() {
  const lastTime = +(localStorage.getItem("oneword_last") || -1);
  const diff = Date.now() - lastTime;

  if (diff < 1000 * 3600)
    return (oneWord.value = localStorage.getItem("oneword_content"));
  localStorage.setItem("oneword_last", Date.now().toString());

  const url = "https://apiv3.shanbay.com/weapps/dailyquote/quote/";

  fetch(url)
    .then((res) => res.json())
    .then((res) => {
      console.log(res);

      oneWord.value = res.content;
      localStorage.setItem("oneword_content", res.content);
    });
}
getOneWord();
</script>

<template>
  <div class="HomeBanner">
    <!-- <img
      src="https://api.dujin.org/bing/1920.php"
      alt="Background Wallpaper Not Support!"
    /> -->
    <img
    :src="Wallpaper"
      alt="Wallpaper"
    />

    <div class="HomeBanner__Content">
      <h1 text-3xl font-bold>Home Page</h1>
      <span text-xl>{{ oneWord }}</span>
    </div>
    "
  </div>
</template>

<style lang="scss" scoped>
.HomeBanner,
img {
  position: absolute;
  height: 60%;
  width: 100%;
  user-select: none;
  pointer-events: none;

  &__Content {
    z-index: 100;
    position: absolute;
    padding: 0.5rem 1rem;
    display: flex;
    align-items: end;
    bottom: 5%;
    width: 100%;
    height: 15%;
    box-sizing: border-box;

    h1 {
      margin: 0;
      flex-shrink: 0;
    }

    span {
      margin-left: 1rem;
      opacity: 0.5;
    }
  }

  img {
    height: 100%;
    object-fit: fill;
  }
}

.HomeBanner::before {
  z-index: 100;
  content: "";
  position: absolute;

  bottom: 0;
  width: 100%;

  height: 50%;
  left: 0;

  background: linear-gradient(
    to top,
    rgba(255, 255, 255, 0.75),
    rgba(255, 255, 255, 0.5) 50%,
    rgba(255, 255, 255, 0)
  );

  .dark & {
    background: linear-gradient(
      to top,
      rgba(0, 0, 0, 0.75),
      rgba(0, 0, 0, 0.5) 50%,
      rgba(0, 0, 0, 0)
    );
  }
}
</style>
