<script lang="ts" setup>
import { ref } from 'vue';
import TouchBanner from './base/TouchBanner.vue';
import TouchText from './base/TouchText.vue';

const waitlistForm = ref({
  email: ''
});

const submitWaitlist = () => {
  console.log('Waitlist submission:', waitlistForm.value.email);
  alert(`Thank you for your interest! We've added ${waitlistForm.value.email} to the pioneer testing list.`);
  waitlistForm.value.email = '';
};
</script>

<template>
  <div class="Home">
    <TouchBanner>
      <template #center>
        <TouchText />
        <p>A strong adaptation more platform all-tool program.</p>
      </template>
    </TouchBanner>

    <div class="content-wrapper">
      <div class="beta-tag">
        <span class="beta-text">BETA</span>
      </div>

      <p class="subtitle">The Polyglot Toolbox</p>

      <div class="introduction">
        <p>Polyglot Toolbox is a desktop application developed with Electron, Vue3, and Vite.</p>
        <p>It integrates various practical tools and features, aiming to make your desktop smarter, more efficient, and convenient.</p>
      </div>

      <div class="features">
        <div class="feature-item">
          <i class="feature-icon i-ri-plug-line"></i>
          <span class="feature-text">Plugin Ecosystem</span>
        </div>
        <div class="feature-item">
          <i class="feature-icon i-ri-tools-line"></i>
          <span class="feature-text">Multi-functional Toolkit</span>
        </div>
        <div class="feature-item">
          <i class="feature-icon i-ri-settings-5-line"></i>
          <span class="feature-text">Ultimate Customization</span>
        </div>
      </div>

      <div class="waitlist-section">
        <p class="waitlist-title">Join the Pioneer Testing Program</p>
        <form @submit.prevent="submitWaitlist" class="waitlist-form">
          <input
            v-model="waitlistForm.email"
            type="email"
            placeholder="Enter your email address"
            class="waitlist-input"
            required
          />
          <button type="submit" class="waitlist-button">Join Waitlist</button>
        </form>
      </div>
    </div>

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

.content-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  color: white;
  z-index: 10;
  position: relative;
  padding: 2rem 1rem;
}

.beta-tag {
  position: absolute;
  top: -60px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 20px;
  padding: 5px 15px;
}

.beta-text {
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.subtitle {
  font-size: 1.5rem;
  margin-top: 1rem;
  margin-bottom: 2rem;
  font-weight: 300;
  letter-spacing: 1px;
}

.introduction {
  max-width: 600px;
  margin: 0 auto 2rem;
  font-size: 1.1rem;
  line-height: 1.6;
  font-weight: 300;
}

.features {
  display: flex;
  gap: 2rem;
  margin-bottom: 3rem;
  flex-wrap: wrap;
  justify-content: center;
}

.feature-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.feature-icon {
  font-size: 1.8rem;
}

.feature-text {
  font-size: 0.9rem;
  font-weight: 300;
}

.waitlist-section {
  width: 100%;
  max-width: 500px;
  margin-top: 2rem;
}

.waitlist-title {
  font-size: 1.2rem;
  margin-bottom: 1rem;
  font-weight: 300;
}

.waitlist-form {
  display: flex;
  gap: 0.5rem;
  width: 100%;
}

.waitlist-input {
  flex: 1;
  padding: 0.8rem 1.2rem;
  border-radius: 30px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  color: white;
  font-size: 1rem;

  &::placeholder {
    color: rgba(255, 255, 255, 0.5);
  }

  &:focus {
    outline: none;
    border-color: rgba(255, 255, 255, 0.4);
  }
}

.waitlist-button {
  padding: 0.8rem 1.5rem;
  border-radius: 30px;
  border: none;
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(10px);
  color: white;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
}

@media (max-width: 768px) {
  .features {
    gap: 1rem;
  }

  .feature-text {
    font-size: 0.8rem;
  }

  .waitlist-form {
    flex-direction: column;
  }

  .waitlist-input,
  .waitlist-button {
    width: 100%;
  }
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

.features {
  backdrop-filter: blur(10px);
  background: rgba(255, 255, 255, 0.05);
  border-radius: 20px;
  padding: 2rem;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.waitlist-section {
  backdrop-filter: blur(10px);
  background: rgba(255, 255, 255, 0.05);
  border-radius: 20px;
  padding: 2rem;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.feature-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.introduction {
  position: relative;

  &::after {
    content: '';
    position: absolute;
    bottom: -1rem;
    left: 50%;
    transform: translateX(-50%);
    width: 100px;
    height: 2px;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.5), transparent);
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
