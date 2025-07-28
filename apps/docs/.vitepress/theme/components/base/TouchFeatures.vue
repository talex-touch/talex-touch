<script setup lang="ts">
import { ref } from 'vue';
import TouchRay from './TouchRay.vue'

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
  <div class="touch-feature">
    <TouchRay />

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
  </div>
</template>

<style scoped>
.touch-feature {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 100%;
  min-height: 100%;
  overflow: hidden;
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
}

.content-wrapper {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  color: white;
  z-index: 10;
  position: relative;
  padding: 2rem 1rem;
  max-width: 1200px;
  width: 100%;
  min-height: 80vh;
}

.beta-tag {
  position: relative;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 20px;
  padding: 5px 15px;
  margin-bottom: 1rem;
  box-shadow: 0 0 20px rgba(255, 255, 255, 0.1);
}

.beta-text {
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.subtitle {
  font-size: 2rem;
  margin-top: 1rem;
  margin-bottom: 2rem;
  font-weight: 300;
  letter-spacing: 1px;
  text-shadow: 0 0 10px rgba(255, 255, 255, 0.3);
  position: relative;
  padding-bottom: 1rem;
}

.subtitle::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 80px;
  height: 3px;
  background: linear-gradient(90deg, transparent, #64b5f6, transparent);
  border-radius: 3px;
}

.introduction {
  max-width: 600px;
  margin: 0 auto 2rem;
  font-size: 1.1rem;
  line-height: 1.6;
  font-weight: 300;
  position: relative;
}

.introduction::after {
  content: '';
  position: absolute;
  bottom: -1rem;
  left: 50%;
  transform: translateX(-50%);
  width: 100px;
  height: 2px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.5), transparent);
}

.features {
  display: flex;
  gap: 2rem;
  margin-bottom: 3rem;
  flex-wrap: wrap;
  justify-content: center;
  backdrop-filter: blur(10px);
  background: rgba(255, 255, 255, 0.05);
  border-radius: 20px;
  padding: 2rem;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
}

.feature-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.feature-icon {
  font-size: 2rem;
}

.feature-text {
  font-size: 1rem;
  font-weight: 300;
}

.waitlist-section {
  backdrop-filter: blur(10px);
  background: rgba(255, 255, 255, 0.05);
  border-radius: 20px;
  padding: 2rem;
  border: 1px solid rgba(255, 255, 255, 0.1);
  width: 100%;
  max-width: 500px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
}

.waitlist-title {
  font-size: 1.3rem;
  margin-bottom: 1rem;
  font-weight: 300;
  text-shadow: 0 0 5px rgba(255, 255, 255, 0.2);
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
}

.waitlist-input::placeholder {
  color: rgba(255, 255, 255, 0.5);
}

.waitlist-input:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.4);
  box-shadow: 0 0 15px rgba(255, 255, 255, 0.2);
}

.waitlist-button {
  padding: 0.8rem 1.5rem;
  border-radius: 30px;
  border: none;
  background: linear-gradient(45deg, rgba(100, 181, 246, 0.8), rgba(25, 118, 210, 0.8));
  backdrop-filter: blur(10px);
  color: white;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 4px 15px rgba(100, 181, 246, 0.3);
}

@media (max-width: 768px) {
  .features {
    gap: 1rem;
  }

  .feature-text {
    font-size: 0.9rem;
  }

  .waitlist-form {
    flex-direction: column;
  }

  .waitlist-input,
  .waitlist-button {
    width: 100%;
  }
  
  .subtitle {
    font-size: 1.5rem;
  }
  
  .waitlist-title {
    font-size: 1.1rem;
  }
}
</style>
