<script lang="ts">
  import { onMount } from 'svelte';
  import { bag } from '$lib/bag.svelte';

  let solid = $state(false);
  let hidden = $state(false);

  onMount(() => {
    let lastY = scrollY;
    const onScroll = () => {
      const y = scrollY;
      solid = y > innerHeight * 0.85;
      // Step out of the way while reading downward; return on any upward intent.
      hidden = y > innerHeight * 1.2 && y > lastY + 4;
      if (y < lastY - 4 || y < innerHeight) hidden = false;
      lastY = y;
    };
    onScroll();
    addEventListener('scroll', onScroll, { passive: true });
    return () => removeEventListener('scroll', onScroll);
  });

  // Wide screens keep the bag docked beside the menu; narrow screens use the drawer.
  function openOrder() {
    if (matchMedia('(min-width: 1000px)').matches) {
      document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth' });
    } else {
      bag.open = true;
    }
  }

  const links = [
    { href: '#kitchen', label: 'Kitchen' },
    { href: '#bakery', label: 'Bakery' },
    { href: '#menu', label: 'Menu' },
    { href: '#visit', label: 'Visit' }
  ];
</script>

<header class="nav" class:solid class:hidden>
  <div class="bar wrap">
    <a href="#top" class="brand" aria-label="GLS Kitchen & Bakery — back to top">
      <img src="/favicon.png" alt="" width="34" height="38" />
      <span class="word">GLS <span>Kitchen &amp; Bakery</span></span>
    </a>
    <nav aria-label="Primary">
      <ul>
        {#each links as l}
          <li><a href={l.href}>{l.label}</a></li>
        {/each}
      </ul>
    </nav>
    <button class="order" onclick={openOrder} aria-label="Open your order, {bag.count} items">
      Order
      <span class="count" class:has={bag.count > 0}>{bag.count}</span>
    </button>
  </div>
</header>

<style>
  .nav {
    position: fixed;
    inset: 0 0 auto;
    z-index: 50;
    color: var(--cream);
    transition:
      translate 0.7s var(--ease),
      background-color 0.5s,
      color 0.5s;
    animation: drop 1.2s var(--ease) 1.9s both;
  }
  @keyframes drop {
    from {
      translate: 0 -100%;
    }
  }
  .nav.solid {
    color: var(--ink);
    background: color-mix(in oklab, var(--paper) 88%, transparent);
    backdrop-filter: saturate(1.4) blur(14px);
    box-shadow: 0 1px 0 var(--line);
  }
  .nav.hidden {
    translate: 0 -100%;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 2rem;
    height: 4.5rem;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    text-decoration: none;
    margin-right: auto;
  }
  .brand img {
    width: 30px;
    height: auto;
  }
  .word {
    font-family: var(--serif);
    font-size: 1.3rem;
    font-weight: 500;
    letter-spacing: -0.02em;
  }
  .word span {
    font-family: var(--sans);
    font-size: 0.68rem;
    font-weight: 600;
    font-stretch: 112%;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    margin-left: 0.4rem;
    opacity: 0.75;
  }
  ul {
    display: flex;
    gap: 2.2rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  nav a {
    position: relative;
    font-size: 0.78rem;
    font-weight: 600;
    font-stretch: 110%;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    text-decoration: none;
  }
  nav a::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -0.35rem;
    height: 1px;
    background: currentColor;
    transform: scaleX(0);
    transform-origin: right;
    transition: transform 0.6s var(--ease);
  }
  nav a:hover::after {
    transform: scaleX(1);
    transform-origin: left;
  }
  .order {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.7rem 1rem 0.7rem 1.2rem;
    border: 1px solid currentColor;
    background: transparent;
    font-size: 0.75rem;
    font-weight: 600;
    font-stretch: 110%;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background-color 0.4s, color 0.4s, border-color 0.4s;
  }
  .order:hover {
    background: var(--lime);
    border-color: var(--lime);
    color: var(--ink);
  }
  .count {
    display: grid;
    place-items: center;
    min-width: 1.5rem;
    height: 1.5rem;
    padding-inline: 0.35rem;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0;
    background: color-mix(in oklab, currentColor 14%, transparent);
    transition: background-color 0.4s, color 0.4s;
  }
  .count.has {
    background: var(--lime);
    color: var(--ink);
  }
  @media (max-width: 860px) {
    nav,
    .word span {
      display: none;
    }
  }
</style>
