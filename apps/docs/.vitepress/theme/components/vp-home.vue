<script lang="ts" setup>
import { onMounted } from 'vue';
import TouchBanner from './base/TouchBanner.vue';
import TouchText from './base/TouchText.vue';
import TouchFeatures from './base/TouchFeatures.vue';
import TouchButton from './base/TouchButton.vue'

onMounted(() => {
  const pageHeight = document.documentElement.clientHeight;

  document.documentElement.style.setProperty('--vh', `${pageHeight}px`);
})
</script>

<template>
  <div class="Home">
    <TouchBanner>
      <template #center>
        <TouchText />
        <p>A strong adaptation more platform all-tool program.</p>

        <div style="margin-bottom: -4rem">
          <TouchButton>
            Download <span style="font-weight: bold;">BETA</span> version
          </TouchButton>
        </div>
      </template>
    </TouchBanner>

    <TouchFeatures />



    <!-- 第二个版面 -->
    <div class="second-section">
      <div class="section-content">
        <h2 class="section-title">Why Choose Polyglot Toolbox?</h2>
        <div class="features-grid">
          <div class="feature-card">
            <i class="card-icon i-ri-lightbulb-line"></i>
            <h3 class="card-title">Innovative Design</h3>
            <p class="card-description">Experience a modern and intuitive interface designed to enhance your productivity.</p>
          </div>
          <div class="feature-card">
            <i class="card-icon i-ri-rocket-line"></i>
            <h3 class="card-title">Lightning Fast</h3>
            <p class="card-description">Built with cutting-edge technologies for optimal performance and speed.</p>
          </div>
          <div class="feature-card">
            <i class="card-icon i-ri-shield-check-line"></i>
            <h3 class="card-title">Secure & Reliable</h3>
            <p class="card-description">Your data is protected with industry-standard security measures.</p>
          </div>
          <div class="feature-card">
            <i class="card-icon i-ri-global-line"></i>
            <h3 class="card-title">Cross-Platform</h3>
            <p class="card-description">Seamlessly sync your data across Windows, macOS, and Linux devices.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.Home {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 100%;
}

.touch-text {
  text-shadow:
      0 0 10px rgba(255, 255, 255, 0.5),
      0 0 20px rgba(255, 255, 255, 0.3),
      0 0 30px rgba(255, 255, 255, 0.2);
  animation: textGlow 3s ease-in-out infinite alternate;
}

@keyframes textGlow {
  from {
    text-shadow:
        0 0 10px rgba(255, 255, 255, 0.5),
        0 0 20px rgba(255, 255, 255, 0.3),
        0 0 30px rgba(255, 255, 255, 0.2);
  }
  to {
    text-shadow:
        0 0 15px rgba(255, 255, 255, 0.6),
        0 0 25px rgba(255, 255, 255, 0.4),
        0 0 35px rgba(255, 255, 255, 0.3);
  }
}

/* 第二个版面样式 */
.second-section {
  padding: 4rem 1rem;
  background: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(10px);
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.section-content {
  max-width: 1200px;
  margin: 0 auto;
  text-align: center;
}

.section-title {
  font-size: 2rem;
  font-weight: 300;
  margin-bottom: 3rem;
  color: white;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 2rem;
}

.feature-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
}

.card-icon {
  font-size: 2.5rem;
  margin-bottom: 1rem;
  color: rgba(255, 255, 255, 0.8);
}

.card-title {
  font-size: 1.3rem;
  font-weight: 400;
  margin-bottom: 1rem;
  color: white;
}

.card-description {
  font-size: 1rem;
  font-weight: 300;
  color: rgba(255, 255, 255, 0.7);
  line-height: 1.6;
}

@media (max-width: 768px) {
  .second-section {
    padding: 2rem 1rem;
  }

  .section-title {
    font-size: 1.5rem;
  }

  .features-grid {
    grid-template-columns: 1fr;
  }
}
</style>

<style lang="scss">
.VPContent.is-home {
  display: flex;
  padding: 0 !important;
  height: 100%;

  .VPHome {
    & > div {
      display: flex;
      flex-grow: 1;
      & > div {
        flex-grow: 1;
      }
    }
    flex-grow: 1;
    padding: 0;
    width: 100%;
    height: 100%;
    min-width: 100%;
    min-height: 100%;
  }
}
</style>
