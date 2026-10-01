<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { bag } from '$lib/bag.svelte';
  import { formatMinor } from '$lib/menu';
  import { site } from '$lib/site';

  let mode = $state<'pickup' | 'delivery'>('pickup');
  let name = $state('');
  let address = $state('');
  let when = $state('');
  let note = $state('');

  const canSend = $derived(bag.count > 0 && name.trim().length > 1 && (mode === 'pickup' || address.trim().length > 4));

  function message() {
    const lines = bag.items.map((l) => `• ${l.qty} × ${l.item.name} — ${formatMinor(l.item.priceMinor * l.qty)}`);
    return [
      `Hello GLS! I’d like to place an order:`,
      '',
      ...lines,
      '',
      `Estimated total: ${formatMinor(bag.totalMinor)}`,
      `${mode === 'pickup' ? 'Pickup' : 'Delivery'}${when ? ` — ${when}` : ''}`,
      mode === 'delivery' ? `Address: ${address.trim()}` : '',
      `Name: ${name.trim()}`,
      note.trim() ? `Note: ${note.trim()}` : ''
    ]
      .filter((l, i, a) => l !== '' || a[i - 1] !== '')
      .join('\n');
  }

  function send(e: SubmitEvent) {
    e.preventDefault();
    if (!canSend) return;
    const url = `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(message())}`;
    window.open(url, '_blank', 'noopener');
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && bag.open) bag.open = false;
  }
</script>

<svelte:window onkeydown={onKey} />

{#if bag.open}
  <button class="scrim" aria-label="Close order" transition:fade={{ duration: 300 }} onclick={() => (bag.open = false)}></button>
{/if}

<aside class="bag" class:open={bag.open} aria-label="Your order">
  <header>
    <h3 class="display">Your order</h3>
    <span class="eyebrow">{bag.count} {bag.count === 1 ? 'item' : 'items'}</span>
    <button class="close" onclick={() => (bag.open = false)} aria-label="Close order">✕</button>
  </header>

  {#if bag.count === 0}
    <p class="empty">Nothing here yet. Start with the jollof — everyone does.</p>
  {:else}
    <ul class="lines">
      {#each bag.items as l (l.item.id)}
        <li in:fly={{ x: 16, duration: 450, easing: cubicOut }}>
          <span class="q">{l.qty}×</span>
          <span class="nm">{l.item.name}</span>
          <span class="pr">{formatMinor(l.item.priceMinor * l.qty)}</span>
          <span class="ctl">
            <button onclick={() => bag.remove(l.item.id)} aria-label="Remove one {l.item.name}">−</button>
            <button onclick={() => bag.add(l.item.id)} aria-label="Add one {l.item.name}">+</button>
          </span>
        </li>
      {/each}
    </ul>
    <div class="total">
      <span class="eyebrow">Estimated total</span>
      <strong>{formatMinor(bag.totalMinor)}</strong>
    </div>
  {/if}

  <form onsubmit={send}>
    <div class="seg" role="radiogroup" aria-label="Pickup or delivery">
      <label class:on={mode === 'pickup'}><input type="radio" bind:group={mode} value="pickup" />Pickup</label>
      <label class:on={mode === 'delivery'}><input type="radio" bind:group={mode} value="delivery" />Delivery</label>
    </div>
    <label class="field">
      <span>Your name</span>
      <input bind:value={name} autocomplete="name" required />
    </label>
    {#if mode === 'delivery'}
      <label class="field" transition:fly={{ y: -8, duration: 350 }}>
        <span>Delivery address</span>
        <input bind:value={address} autocomplete="street-address" required />
      </label>
    {/if}
    <label class="field">
      <span>When <em>(optional)</em></span>
      <input bind:value={when} placeholder="e.g. Today, 7pm · Sat for the party" />
    </label>
    <label class="field">
      <span>Note <em>(optional)</em></span>
      <textarea bind:value={note} rows="2" placeholder="Allergies, extra pepper, cake message…"></textarea>
    </label>
    <button class="btn send" type="submit" disabled={!canSend}>
      Send order on WhatsApp <span class="arrow" aria-hidden="true">→</span>
    </button>
    <p class="fine">We confirm the final total and timing before you pay.</p>
  </form>
</aside>

{#if bag.count > 0 && !bag.open}
  <button class="peek" onclick={() => (bag.open = true)} transition:fly={{ y: 80, duration: 500, easing: cubicOut }}>
    <span>View order · {bag.count}</span>
    <strong>{formatMinor(bag.totalMinor)}</strong>
  </button>
{/if}

<style>
  .bag {
    position: sticky;
    top: 6rem;
    display: grid;
    gap: 1.25rem;
    padding: 1.75rem;
    background: var(--paper);
    box-shadow: 0 0 0 1px var(--line);
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 1rem;
  }
  h3 {
    margin: 0;
    font-size: 2rem;
    margin-right: auto;
  }
  header .eyebrow {
    color: var(--muted);
  }
  .close {
    display: none;
  }
  .empty {
    margin: 0;
    color: var(--muted);
    font-family: var(--serif);
    font-style: italic;
    font-size: 1.1rem;
  }
  .lines {
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: 16rem;
    overflow-y: auto;
  }
  .lines li {
    display: grid;
    grid-template-columns: 2rem 1fr auto auto;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--line);
  }
  .q {
    font-variant-numeric: tabular-nums;
    color: var(--leaf);
    font-weight: 600;
  }
  .pr {
    font-variant-numeric: tabular-nums;
  }
  .ctl {
    display: flex;
    gap: 0.25rem;
  }
  .ctl button {
    width: 1.7rem;
    height: 1.7rem;
    border: 1px solid var(--line);
    background: transparent;
    cursor: pointer;
  }
  .ctl button:hover {
    border-color: var(--ink);
  }
  .total {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .total strong {
    font-family: var(--serif);
    font-weight: 500;
    font-size: 1.7rem;
    font-variant-numeric: tabular-nums;
  }

  form {
    display: grid;
    gap: 0.9rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--line);
  }
  .seg {
    display: grid;
    grid-template-columns: 1fr 1fr;
    box-shadow: inset 0 0 0 1px var(--ink);
  }
  .seg label {
    position: relative;
    padding: 0.7rem;
    text-align: center;
    font-size: 0.75rem;
    font-weight: 600;
    font-stretch: 110%;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    cursor: pointer;
    transition:
      background-color 0.35s,
      color 0.35s;
  }
  .seg label.on {
    background: var(--ink);
    color: var(--lime);
  }
  .seg input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .seg label:has(input:focus-visible) {
    outline: 2px solid var(--lime);
    outline-offset: 2px;
  }
  .field {
    display: grid;
    gap: 0.35rem;
  }
  .field span {
    font-size: 0.7rem;
    font-weight: 600;
    font-stretch: 110%;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .field em {
    font-style: normal;
    text-transform: none;
    letter-spacing: 0;
    font-weight: 400;
  }
  input:not([type='radio']),
  textarea {
    width: 100%;
    padding: 0.75rem 0;
    border: 0;
    border-bottom: 1px solid color-mix(in oklab, var(--ink) 30%, transparent);
    background: transparent;
    font: inherit;
    color: var(--ink);
    resize: vertical;
    transition: border-color 0.3s;
  }
  input:not([type='radio']):focus,
  textarea:focus {
    outline: none;
    border-color: var(--leaf);
  }
  .send {
    justify-content: space-between;
    margin-top: 0.5rem;
  }
  .send:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .send:disabled::before {
    display: none;
  }
  .send:disabled:hover {
    color: var(--ink);
  }
  .fine {
    margin: 0;
    font-size: 0.8rem;
    color: var(--muted);
  }

  .scrim,
  .peek {
    display: none;
  }

  /* ---- below 1000px the bag becomes a drawer ---- */
  @media (max-width: 999px) {
    .bag {
      position: fixed;
      inset: auto 0 0 0;
      z-index: 70;
      max-height: 92svh;
      overflow-y: auto;
      padding: 1.5rem var(--gutter) 2rem;
      translate: 0 105%;
      transition: translate 0.7s var(--ease);
      box-shadow: 0 -20px 60px rgb(20 23 15 / 0.25);
    }
    .bag.open {
      translate: 0 0;
    }
    .close {
      display: block;
      border: 0;
      background: none;
      font-size: 1.1rem;
      cursor: pointer;
    }
    .scrim {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 60;
      border: 0;
      background: rgb(20 23 15 / 0.55);
    }
    .peek {
      position: fixed;
      left: var(--gutter);
      right: var(--gutter);
      bottom: 1rem;
      z-index: 40;
      display: flex;
      justify-content: space-between;
      padding: 1.1rem 1.4rem;
      border: 0;
      background: var(--ink);
      color: var(--cream);
      font-size: 0.8rem;
      font-weight: 600;
      font-stretch: 110%;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      cursor: pointer;
      box-shadow: 0 14px 40px rgb(20 23 15 / 0.3);
    }
    .peek strong {
      color: var(--lime);
      letter-spacing: 0;
    }
  }
</style>
