<!--
  A still of the GLS POS "Items" screen, rebuilt in HTML so it stays sharp at
  any camera zoom. Purely visual: nothing here is interactive. Palette, labels
  and menu are taken from apps/mobile (constants/theme.ts, lib/mock-items.ts).
  Landscape container = counter tablet with the order pane; portrait = phone.
-->
<script lang="ts">
  let { tapped = false }: { tapped?: boolean } = $props();

  const items = [
    { n: 'Meat Pie', p: '1,000', c: '#6A1B9A', hero: true },
    { n: 'Chicken Pie', p: '1,100', c: '#6A1B9A' },
    { n: 'Sausage Roll', p: '800', c: '#6A1B9A' },
    { n: 'Scotch Egg', p: '1,000', c: '#6A1B9A', out: true },
    { n: 'Jollof Rice', p: '800', c: '#EF6C00' },
    { n: 'Fried Rice', p: '700', c: '#EF6C00' },
    { n: 'Coconut Rice', p: '1,000', c: '#EF6C00' },
    { n: 'Butter Bread', p: '1,500', c: '#8D6E63' },
    { n: 'Jam Doughnut', p: '800', c: '#6A1B9A' },
    { n: 'Chin-Chin', p: '3,700', c: '#6A1B9A' },
    { n: 'Zobo Drink', p: '2,500', c: '#00838F' },
    { n: 'Burger', p: '2,500', c: '#6A1B9A' }
  ];
  const initials = (n: string) =>
    n
      .split(/[\s-]+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  const tabs = ['Reports', 'Today', 'Counter', 'Items', 'More'];
</script>

<div class="pos" class:tapped aria-hidden="true">
  <div class="main">
    <div class="bar">
      <span class="store">GLS Kitchen &amp; Bakery <i>▾</i></span>
      <span class="live"><b></b>Synced</span>
    </div>
    <div class="search">I want to sell…</div>
    <div class="grid">
      {#each items as it}
        <div class="tile" class:hero={it.hero} class:out={it.out}>
          <div class="ph" style:background={it.c}>{initials(it.n)}</div>
          <div class="nm">{it.n}</div>
          <div class="pr">{it.out ? 'Out of stock' : `₦${it.p}`}</div>
          {#if it.hero}<span class="qty">1</span>{/if}
        </div>
      {/each}
    </div>
    <div class="goto">
      <span>Go To Counter</span><span>1 item · ₦1,000</span>
    </div>
    <div class="tabs">
      {#each tabs as t}
        <span class:on={t === 'Items'}>
          <em></em>{t}{#if t === 'Counter'}<sup>1</sup>{/if}
        </span>
      {/each}
    </div>
  </div>
  <div class="counter">
    <div class="ch">Counter <span>Takeaway</span></div>
    <div class="empty">Counter Is Empty</div>
    <div class="line">
      <span>1 × Meat Pie</span><span>₦1,000</span>
    </div>
    <div class="sum"><span>Subtotal</span><span>₦1,000</span></div>
    <div class="charge"><span>Charge</span><span>{tapped ? '₦1,000' : '₦0'}</span></div>
  </div>
</div>

<style>
  .pos {
    --g: #5aa02c;
    --gd: #3f7a1c;
    container-type: size;
    position: absolute;
    inset: 0;
    display: flex;
    background: #e0e0e0;
    color: #424242;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    font-size: 6.4px;
    line-height: 1.25;
    overflow: hidden;
    user-select: none;
  }
  .main {
    position: relative;
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.9em 1.2em;
    background: var(--g);
    color: #fff;
    font-weight: 600;
    font-size: 1.15em;
  }
  .bar i {
    font-style: normal;
    opacity: 0.8;
  }
  .live {
    display: flex;
    align-items: center;
    gap: 0.4em;
    font-size: 0.75em;
    font-weight: 500;
    opacity: 0.9;
  }
  .live b {
    width: 0.6em;
    height: 0.6em;
    border-radius: 50%;
    background: #d6f5a8;
  }
  .search {
    margin: 0.8em;
    padding: 0.7em 1em;
    background: #fff;
    border-radius: 3px;
    color: #9e9e9e;
  }
  .grid {
    flex: 1;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.5em;
    padding: 0 0.8em 0.8em;
    align-content: start;
  }
  .tile {
    position: relative;
    background: #fff;
    border-radius: 3px;
    box-shadow: 0 1px 1.5px rgb(0 0 0 / 0.14);
    overflow: hidden;
    transition: box-shadow 0.4s, translate 0.4s;
  }
  .ph {
    display: grid;
    place-items: center;
    height: 3.6em;
    color: #fff;
    font-weight: 700;
    font-size: 1.1em;
    letter-spacing: 0.04em;
  }
  .nm {
    padding: 0.45em 0.6em 0;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pr {
    padding: 0.1em 0.6em 0.55em;
    color: #616161;
  }
  .out .pr {
    color: #c62828;
    font-weight: 600;
  }
  .out .ph {
    filter: grayscale(0.7) brightness(0.9);
  }
  .qty {
    position: absolute;
    top: 0.4em;
    right: 0.4em;
    display: grid;
    place-items: center;
    width: 1.7em;
    height: 1.7em;
    border-radius: 50%;
    background: #fff;
    color: var(--gd);
    font-weight: 700;
    scale: 0;
    transition: scale 0.5s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .tapped .hero {
    box-shadow:
      0 0 0 0.25em var(--g),
      0 4px 10px rgb(0 0 0 / 0.18);
    translate: 0 -0.15em;
  }
  .tapped .qty {
    scale: 1;
  }
  .tabs {
    display: flex;
    background: #fff;
    box-shadow: 0 -1px 0 #e0e0e0;
  }
  .tabs span {
    position: relative;
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3em;
    padding: 0.7em 0 0.8em;
    font-size: 0.85em;
    color: #757575;
  }
  .tabs em {
    width: 1.6em;
    height: 1.2em;
    border-radius: 2px;
    border: 0.18em solid currentColor;
  }
  .tabs .on {
    background: var(--g);
    color: #fff;
  }
  .tabs sup {
    position: absolute;
    top: 0.4em;
    left: 58%;
    display: grid;
    place-items: center;
    min-width: 1.5em;
    height: 1.5em;
    border-radius: 1em;
    background: #e53935;
    color: #fff;
    font-size: 0.85em;
    opacity: 0;
    transition: opacity 0.3s;
  }
  .tapped .tabs sup {
    opacity: 1;
  }
  .goto {
    display: none;
  }

  /* landscape tablet: order pane on the right */
  .counter {
    width: 34%;
    display: flex;
    flex-direction: column;
    background: #fff;
    box-shadow: -1px 0 0 #e0e0e0;
  }
  .ch {
    display: flex;
    justify-content: space-between;
    padding: 0.9em 1.1em;
    background: var(--gd);
    color: #fff;
    font-weight: 600;
    font-size: 1.15em;
  }
  .ch span {
    font-size: 0.7em;
    font-weight: 500;
    opacity: 0.85;
  }
  .empty {
    margin: auto;
    color: #9e9e9e;
  }
  .line,
  .sum {
    display: none;
    justify-content: space-between;
    padding: 0.9em 1.1em;
    border-bottom: 1px solid #eee;
    font-weight: 600;
  }
  .sum {
    margin-top: auto;
    border: 0;
    color: #616161;
    font-weight: 500;
  }
  .charge {
    display: flex;
    justify-content: space-between;
    margin: 0.8em;
    padding: 1em 1.1em;
    border-radius: 3px;
    background: #bdbdbd;
    color: #fff;
    font-weight: 700;
    font-size: 1.1em;
    transition: background-color 0.4s;
  }
  .tapped .empty {
    display: none;
  }
  .tapped .line,
  .tapped .sum {
    display: flex;
  }
  .tapped .charge {
    background: var(--g);
  }

  /* portrait phone */
  @container (aspect-ratio < 1) {
    .counter {
      display: none;
    }
    .grid {
      grid-template-columns: repeat(3, 1fr);
    }
    .goto {
      display: flex;
      justify-content: space-between;
      margin: 0 0.8em 0.6em;
      padding: 0.9em 1.1em;
      border-radius: 3px;
      background: var(--g);
      color: #fff;
      font-weight: 700;
      translate: 0 160%;
      opacity: 0;
      transition:
        translate 0.6s cubic-bezier(0.16, 1, 0.3, 1),
        opacity 0.4s;
    }
    .tapped .goto {
      translate: 0 0;
      opacity: 1;
    }
  }
</style>
