<script setup lang="ts">
import TouchRay from './TouchRay.vue'

</script>

<template>
  <div class="touch-feature">
    <TouchRay />

    <div class="content-wrapper">
      <div class="beta-tag">
        <span class="beta-text">BETA</span>
      </div>

      <p class="subtitle">More than imagination.</p>

      <div class="introduction">
        <p>Depends on your needs, it integrates various practical tools and features, aiming to make your desktop smarter, more efficient, and convenient.</p>
      </div>

      <div class="features-section">
        <h2 class="section-title">Why Choose Touch?</h2>
        <div class="features-grid">
          <div class="feature-card">
            <div class="card-icon">
              <svg viewBox="0 0 24 24" width="48" height="48">
                <path fill="rgba(255, 255, 255, 0.8)" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-2-3.5l6-4.5-6-4.5z"/>
              </svg>
            </div>
            <h3 class="card-title">Innovative Design</h3>
            <p class="card-description">Experience a modern and intuitive interface that boosts your productivity with every click.</p>
          </div>
          <div class="feature-card">
            <div class="card-icon">
              <svg viewBox="0 0 24 24" width="48" height="48">
                <path fill="rgba(255, 255, 255, 0.8)" d="M12 2L4 7v10c0 5.55 3.84 9.739 9 11 5.16-1.261 9-5.45 9-11V7l-8-5zM12 20c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-12.5l4 3-4 3v-6z"/>
              </svg>
            </div>
            <h3 class="card-title">Lightning Fast</h3>
            <p class="card-description">Blazing-fast performance powered by cutting-edge technologies for seamless workflow.</p>
          </div>
          <div class="feature-card">
            <div class="card-icon">
              <svg viewBox="0 0 24 24" width="48" height="48">
                <path fill="rgba(255, 255, 255, 0.8)" d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 19.47c-3.87-.45-7-3.65-7-7.47v-1.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5V12c0 2.21 1.79 4 4 4s4-1.79 4-4v-1.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5V12c0 3.82-3.13 7.02-7 7.47z"/>
              </svg>
            </div>
            <h3 class="card-title">Secure & Reliable</h3>
            <p class="card-description">Military-grade encryption and robust security measures to keep your data safe.</p>
          </div>
          <div class="feature-card">
            <div class="card-icon">
              <svg viewBox="0 0 24 24" width="48" height="48">
                <path fill="rgba(255, 255, 255, 0.8)" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13.5v6l5.2 3.2.8-1.3-4.5-2.7V8.5z"/>
              </svg>
            </div>
            <h3 class="card-title">Cross-Platform</h3>
            <p class="card-description">Work seamlessly across all your devices with perfect synchronization.</p>
          </div>
        </div>
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

.features-section {
  width: 100%;
  padding: 2rem 0;
}

.section-title {
  font-size: 2rem;
  font-weight: 300;
  margin-bottom: 3rem;
  color: white;
  text-align: center;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 2rem;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 1rem;
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
  transition: all 0.3s ease;
  transform: translateY(0);
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.feature-card:hover {
  transform: translateY(-5px);
  background: rgba(255, 255, 255, 0.08);
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.card-icon {
  margin-bottom: 1rem;
  transition: all 0.3s ease;
}

.feature-card:hover .card-icon {
  transform: scale(1.1);
}

.feature-card:hover .card-icon path {
  fill: rgba(255, 255, 255, 1);
}

.card-title {
  font-size: 1.3rem;
  font-weight: 400;
  margin-bottom: 1rem;
  color: white;
  transition: all 0.3s ease;
}

.feature-card:hover .card-title {
  color: #64b5f6;
}

.card-description {
  font-size: 1rem;
  font-weight: 300;
  color: rgba(255, 255, 255, 0.7);
  line-height: 1.6;
  text-align: center;
  transition: all 0.3s ease;
}

.feature-card:hover .card-description {
  color: rgba(255, 255, 255, 0.9);
}

@media (max-width: 768px) {
  .features-grid {
    gap: 1.5rem;
    padding: 0 0.5rem;
  }
  
  .feature-card {
    padding: 1.5rem;
  }
  
  .card-icon svg {
    width: 40px;
    height: 40px;
  }
  
  .card-title {
    font-size: 1.1rem;
    margin-bottom: 0.75rem;
  }
  
  .card-description {
    font-size: 0.9rem;
  }
  
  .section-title {
    font-size: 1.5rem;
    margin-bottom: 2rem;
  }
}

@media (max-width: 480px) {
  .features-grid {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
  
  .feature-card {
    padding: 1.25rem;
  }
  
  .card-icon svg {
    width: 36px;
    height: 36px;
  }
  
  .card-title {
    font-size: 1rem;
    margin-bottom: 0.5rem;
  }
  
  .card-description {
    font-size: 0.85rem;
  }
  
  .section-title {
    font-size: 1.3rem;
    margin-bottom: 1.5rem;
  }
}
</style>
