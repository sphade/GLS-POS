<script lang="ts">
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { bag } from '$lib/bag.svelte';
  import { formatMinor, menu } from '$lib/menu';
  import { reveal } from '$lib/motion';
  import OrderBag from './OrderBag.svelte';

  const current = $derived(menu.find((c) => c.id === bag.tab) ?? menu[0]!);

  function onTabKey(e: KeyboardEvent, i: number) {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = menu[(i + dir + menu.length) % menu.length]!;
    bag.tab = next.id;
    document.getElementById(`tab-${next.id}`)?.focus();
  }
</script>

<section id="menu" class="order" aria-labelledby="menu-title">
  <div class="wrap">
    <header class="head">
      <div>
        <p class="chapter-no" use:reveal>05</p>
        <h2 id="menu-title" class="display rv lines" use:reveal={{ delay: 100 }}>
          <span><span>The menu.</span></span>
          <span><span><em>Order</em> in a minute.</span></span>
        </h2>
      </div>
      <p class="sub" use:reveal={{ delay: 240 }}>
        Build your order, send it to us on WhatsApp, and we’ll confirm the total and a pickup or
        delivery time. Cakes need 48 hours’ notice.
      </p>
    </header>

    <div class="layout">
      <div class="board">
        <div class="tabs" role="tablist" aria-label="Menu categories">
          {#each menu as c, i}
            <button
              id="tab-{c.id}"
              role="tab"
              aria-selected={bag.tab === c.id}
              aria-controls="panel"
              tabindex={bag.tab === c.id ? 0 : -1}
              class:on={bag.tab === c.id}
              onclick={() => (bag.tab = c.id)}
              onkeydown={(e) => onTabKey(e, i)}
            >
              {c.label}
            </button>
          {/each}
        </div>

        <div id="panel" role="tabpanel" aria-labelledby="tab-{current.id}" class="panel">
          {#key current.id}
            <ul in:fly={{ y: 18, duration: 600, easing: cubicOut }}>
              {#each current.items as item, i (item.id)}
                {@const q = bag.qty(item.id)}
                <li class:picked={q > 0} style="--d:{i * 50}ms">
                  <div class="info">
                    <h3>
                      {item.name}
                      {#if item.tag}<span class="tag">{item.tag}</span>{/if}
                    </h3>
                    <p>{item.note}</p>
                  </div>
                  <span class="leader" aria-hidden="true"></span>
                  <span class="price">{formatMinor(item.priceMinor)}</span>
                  <div class="qty">
                    {#if q > 0}
                      <button class="step" onclick={() => bag.remove(item.id)} aria-label="Remove one {item.name}">−</button>
                      <span class="n" aria-live="polite">{q}</span>
                    {/if}
                    <button class="step add" onclick={() => bag.add(item.id)} aria-label="Add {item.name}">+</button>
                  </div>
                </li>
              {/each}
            </ul>
          {/key}
        </div>
      </div>

      <OrderBag />
    </div>
  </div>
</section>

<style>
  .order {
    background: var(--cream);
    padding-block: clamp(6rem, 14vh, 10rem);
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    justify-content: space-between;
    gap: 2rem;
    margin-bottom: clamp(3rem, 8vh, 5rem);
  }
  .chapter-no {
    margin: 0 0 1rem;
    font-size: clamp(3rem, 6vw, 5.5rem);
    line-height: 0.8;
    color: var(--leaf);
  }
  h2 {
    margin: 0;
    font-size: clamp(2.8rem, 6vw, 6.4rem);
  }
  h2 em {
    color: var(--crust);
  }
  .sub {
    max-width: 24rem;
    margin: 0;
    color: var(--muted);
  }

  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(20rem, 26rem);
    gap: clamp(2rem, 4vw, 4rem);
    align-items: start;
  }

  .tabs {
    display: flex;
    gap: 1.75rem;
    overflow-x: auto;
    scrollbar-width: none;
    border-bottom: 1px solid var(--line);
  }
  .tabs button {
    position: relative;
    flex: none;
    padding: 0 0 1rem;
    border: 0;
    background: none;
    font-family: var(--serif);
    font-size: clamp(1.15rem, 1.6vw, 1.45rem);
    letter-spacing: -0.01em;
    color: var(--muted);
    cursor: pointer;
    transition: color 0.4s;
  }
  .tabs button::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 2px;
    background: var(--ink);
    transform: scaleX(0);
    transform-origin: left;
    transition: transform 0.6s var(--ease);
  }
  .tabs button:hover,
  .tabs button.on {
    color: var(--ink);
  }
  .tabs button.on::after {
    transform: scaleX(1);
  }

  .panel ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .panel li {
    display: grid;
    grid-template-columns: fit-content(34rem) minmax(1.5rem, 1fr) auto auto;
    align-items: baseline;
    gap: 1rem;
    padding: 1.5rem 0;
    border-bottom: 1px solid var(--line);
    transition: background-color 0.4s;
  }
  .info h3 {
    margin: 0;
    font-family: var(--serif);
    font-weight: 420;
    font-size: clamp(1.3rem, 1.9vw, 1.7rem);
    letter-spacing: -0.02em;
  }
  .tag {
    display: inline-block;
    margin-left: 0.6rem;
    padding: 0.2rem 0.45rem;
    vertical-align: 0.3em;
    font-family: var(--sans);
    font-size: 0.58rem;
    font-weight: 600;
    font-stretch: 112%;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--leaf);
    box-shadow: inset 0 0 0 1px currentColor;
  }
  .info p {
    margin: 0.3rem 0 0;
    font-size: 0.95rem;
    color: var(--muted);
  }
  .leader {
    align-self: center;
    border-bottom: 1px dotted color-mix(in oklab, var(--ink) 30%, transparent);
    translate: 0 0.35rem;
  }
  .price {
    font-family: var(--serif);
    font-size: 1.15rem;
    font-variant-numeric: tabular-nums lining-nums;
  }
  .qty {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 6.5rem;
    justify-content: flex-end;
    align-self: center;
  }
  .step {
    display: grid;
    place-items: center;
    width: 2.4rem;
    height: 2.4rem;
    border: 1px solid var(--ink);
    background: transparent;
    font-size: 1.15rem;
    line-height: 1;
    cursor: pointer;
    transition:
      background-color 0.3s,
      color 0.3s,
      scale 0.4s var(--ease);
  }
  .step:hover {
    background: var(--ink);
    color: var(--lime);
  }
  .step:active {
    scale: 0.92;
  }
  .add {
    background: var(--ink);
    color: var(--cream);
  }
  .picked .add {
    background: var(--lime);
    border-color: var(--lime);
    color: var(--ink);
  }
  .n {
    min-width: 1.25rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  @media (max-width: 999px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 640px) {
    .panel li {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas: 'info info' 'price qty';
      row-gap: 0.75rem;
    }
    .info {
      grid-area: info;
    }
    .leader {
      display: none;
    }
    .price {
      grid-area: price;
    }
    .qty {
      grid-area: qty;
    }
  }
</style>
