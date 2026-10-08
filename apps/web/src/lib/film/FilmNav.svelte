<script lang="ts">
  import { onMount } from 'svelte';

  type Link = { href: string; label: string };
  let {
    links = [
      { href: '#sale', label: 'How it works' },
      { href: '/', label: 'See it live' }
    ],
    cta = { href: '#talk', label: 'Book a demo' },
    brand = 'GLS'
  }: { links?: Link[]; cta?: Link; brand?: string } = $props();

  let solid = $state(false);
  onMount(() => {
    const on = () => (solid = scrollY > innerHeight * 0.4);
    on();
    addEventListener('scroll', on, { passive: true });
    return () => removeEventListener('scroll', on);
  });
</script>

<header class="nav" class:solid>
  <div class="bar wrap">
    <a href="#top" class="brand" aria-label="{brand} — back to top">
      <img src="/favicon.png" alt="" width="30" height="34" />
      <span>{brand}</span>
    </a>
    <nav aria-label="Primary">
      {#each links as l}<a href={l.href}>{l.label}</a>{/each}
    </nav>
    <a class="cta" href={cta.href}>{cta.label}</a>
  </div>
</header>

<style>
  .nav {
    position: fixed;
    inset: 0 0 auto;
    z-index: 50;
    color: var(--cream);
    transition: background-color 0.5s, box-shadow 0.5s;
    animation: drop 1.2s var(--ease) 1.9s both;
  }
  @keyframes drop {
    from {
      translate: 0 -100%;
    }
  }
  .solid {
    background: color-mix(in oklab, var(--ink) 86%, transparent);
    backdrop-filter: blur(12px);
    box-shadow: 0 1px 0 rgb(255 255 255 / 0.06);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 2.2rem;
    height: 4.25rem;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-right: auto;
    text-decoration: none;
    font-family: var(--serif);
    font-size: 1.35rem;
    font-weight: 500;
    letter-spacing: -0.02em;
  }
  .brand img {
    width: 28px;
    height: auto;
  }
  nav {
    display: flex;
    gap: 2rem;
  }
  nav a,
  .cta {
    font-size: 0.74rem;
    font-weight: 600;
    font-stretch: 110%;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    text-decoration: none;
  }
  nav a {
    opacity: 0.8;
    transition: opacity 0.3s;
  }
  nav a:hover {
    opacity: 1;
  }
  .cta {
    display: inline-flex;
    align-items: center;
    min-height: 2.75rem;
    padding: 0 1.1rem;
    box-shadow: inset 0 0 0 1px currentColor;
    transition: background-color 0.4s, color 0.4s, box-shadow 0.4s;
  }
  .cta:hover {
    background: var(--lime);
    color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--lime);
  }
  .brand,
  .cta {
    white-space: nowrap;
  }
  @media (max-width: 759px) {
    nav {
      display: none;
    }
    .bar {
      gap: 1rem;
    }
    .cta {
      padding: 0 0.85rem;
      letter-spacing: 0.12em;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .nav {
      animation: none;
    }
  }
</style>
