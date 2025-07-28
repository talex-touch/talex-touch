---
layout: home
title: Home
---

<Home />

<script setup lang="ts">
/**
 * 这里路径 @theme 可以直接指向 .vitepress/theme 目录
 */
import Home from '@theme/components/vp-home.vue'
</script>

<style scoped>
.home-content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
  text-align: center;
}

.features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 2rem;
  margin-top: 3rem;
}

.feature {
  padding: 1.5rem;
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  transition: transform 0.3s ease;
}

.feature:hover {
  transform: translateY(-5px);
}

.feature h3 {
  font-size: 1.5rem;
  margin-bottom: 1rem;
  color: var(--vp-c-brand);
}

.feature p {
  font-size: 1rem;
  line-height: 1.6;
  color: var(--vp-c-text-2);
}

.cta-section {
  margin-top: 3rem;
  padding: 2rem;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--vp-c-brand), var(--vp-c-brand-dark));
  color: white;
}

.cta-section h2 {
  font-size: 2rem;
  margin-bottom: 1rem;
}

.cta-section p {
  font-size: 1.1rem;
  margin-bottom: 1.5rem;
}

.cta-button {
  display: inline-block;
  padding: 0.8rem 1.5rem;
  background: white;
  color: var(--vp-c-brand);
  border-radius: 4px;
  text-decoration: none;
  font-weight: bold;
  transition: background 0.3s ease;
}

.cta-button:hover {
  background: var(--vp-c-brand-light);
  color: white;
}
</style>

<div class="home-content">
  <div class="features">
    <div class="feature">
      <h3>🧩 Plugin Ecosystem</h3>
      <p>
        Utilizes innovative E-TOS technology to independently package each plugin,
        providing a flexible and streamlined selection and customization of plugins.
      </p>
    </div>

    <div class="feature">
      <h3>🔄 Cross-Platform</h3>
      <p>
        Available for Windows, macOS, Linux, Android, iOS, watchOS, and wearOS.
        Data synchronization across multiple platforms for a continuous working environment.
      </p>
    </div>

    <div class="feature">
      <h3>🎨 Customization</h3>
      <p>
        Ultimate customization options to make your workflow more efficient and meet personalized needs.
        Choose and customize installations based on your requirements.
      </p>
    </div>
  </div>

  <div class="cta-section">
    <h2>Ready to Get Started?</h2>
    <p>
      Join thousands of users who have transformed their desktop experience with TalexTouch.
      Explore our extensive documentation and start building your perfect toolbox today.
    </p>
    <a href="/docs/documents/index" class="cta-button">Explore Documentation</a>
  </div>
</div>
