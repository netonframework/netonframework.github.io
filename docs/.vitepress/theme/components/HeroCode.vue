<template>
  <div class="hero-code">
    <div class="hero-code-header">
      <span class="hero-code-dot red"></span>
      <span class="hero-code-dot yellow"></span>
      <span class="hero-code-dot green"></span>
      <span class="hero-code-title">main.kt</span>
    </div>
    <pre class="hero-code-body"><code><span class="token class-name">Neton</span>.<span class="token function">run</span>(args) {

    <span class="token function">http</span> {
        port = <span class="token number">8080</span>
    }

    <span class="token function">routing</span> {
        <span class="token function">get</span>(<span class="token string">"/"</span>) {
            <span class="token string">"Hello Neton!"</span>
        }
    }
}</code></pre>
  </div>
</template>

<style scoped>
.hero-code {
  border-radius: 12px;
  overflow: hidden;
  background: var(--vp-code-block-bg);
  border: 1px solid var(--vp-c-divider);
  font-size: 14px;
  line-height: 1.7;
  width: 100%;
  max-width: 440px;
}

.hero-code-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
}

.hero-code-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.hero-code-dot.red { background: #ff5f57; }
.hero-code-dot.yellow { background: #febc2e; }
.hero-code-dot.green { background: #28c840; }

.hero-code-title {
  margin-left: 8px;
  font-size: 12px;
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-mono);
}

.hero-code-body {
  margin: 0;
  padding: 20px 24px;
  overflow-x: auto;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-1);
}

.hero-code-body code {
  font-family: inherit;
}

.token.class-name {
  color: var(--vp-c-brand-1);
}

.token.function {
  color: #ab80ff;
}

.token.string {
  color: #a5d6ff;
}

.token.number {
  color: #79c0ff;
}

@media (max-width: 960px) {
  .hero-code {
    max-width: 100%;
  }
}
</style>
