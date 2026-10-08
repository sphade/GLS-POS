<!--
  Final frame. Opens on exactly the frame the film ended on (ink, the GLS mark,
  "One connected system."), overlapping the stage by one viewport so the cut
  is invisible. Then the frame floods with paper, the mark rises, and the CTA
  is the last thing on screen.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { progress, magnetic } from '$lib/motion';
  import { ramp } from './timeline';
  import { site } from '$lib/site';

  let live = $state(false);
  let node: HTMLElement;

  // PLACEHOLDER — demo requests go to the same inbox / WhatsApp as the site.
  const demoMail = `mailto:${site.email}?subject=${encodeURIComponent('GLS demo')}&body=${encodeURIComponent(
    'Business name:\nWhat you sell:\nNumber of counters / devices:\nBest time to call:'
  )}`;
  const wa = `https://wa.me/${site.whatsapp}?text=${encodeURIComponent('Hi GLS — I’d like a demo for my business.')}`;

  type Link = { label: string; href: string };
  let {
    oldLine = 'One connected system.',
    oldSub = 'Works offline · Every device live · Roles & PINs · Synced to the cloud',
    eyebrow = 'For kitchens, bakeries, cafés & shops',
    l1 = 'Run the whole business',
    l2 = 'GLS.',
    body = 'Works on the phones and tablets you already own. We’ll come to your counter, load your menu, and show you the first sale.',
    primary = { label: 'Book a demo', href: demoMail } as Link,
    secondary = { label: 'WhatsApp us', href: wa } as Link,
    proof = { label: 'See it running at GLS Kitchen & Bakery', href: '/' } as Link
  }: {
    oldLine?: string;
    oldSub?: string;
    eyebrow?: string;
    l1?: string;
    l2?: string;
    body?: string;
    primary?: Link;
    secondary?: Link;
    proof?: Link;
  } = $props();
  const external = (h: string) => /^https?:/.test(h);

  function apply(p: number) {
    if (!live) return;
    const s = node.style;
    s.setProperty('--flood', ramp(p, 0.04, 0.4).toFixed(4));
    s.setProperty('--lift', ramp(p, 0.12, 0.46).toFixed(4));
    s.setProperty('--old', (1 - ramp(p, 0, 0.12)).toFixed(4));
    s.setProperty('--h1', ramp(p, 0.3, 0.54).toFixed(4));
    s.setProperty('--h2', ramp(p, 0.36, 0.6).toFixed(4));
    s.setProperty('--cta', ramp(p, 0.48, 0.7).toFixed(4));
  }

  onMount(() => {
    live = document.documentElement.classList.contains('cine');
  });
</script>

<section class="fin" class:live bind:this={node} use:progress={{ mode: 'pin', onChange: apply }} aria-labelledby="fin-title">
  <span id="talk" class="anchor"></span>
  <div class="pin">
    <div class="old" aria-hidden="true">
      <span class="ol">{oldLine}</span>
      {#if oldSub}<span class="os">{oldSub}</span>{/if}
    </div>
    <div class="flood" aria-hidden="true"></div>
    <img class="mark" src="/favicon.png" alt="" width="200" height="200" />
    <div class="copy wrap">
      <p class="eyebrow">{eyebrow}</p>
      <h2 id="fin-title" class="display">
        <span class="l1">{l1}</span>
        <span class="l2">on <em>{l2}</em></span>
      </h2>
      <div class="cta">
        <p>{body}</p>
        <div class="row">
          <a class="btn" href={primary.href} use:magnetic>{primary.label} <span class="arrow">→</span></a>
          <a
            class="btn ghost"
            href={secondary.href}
            target={external(secondary.href) ? '_blank' : undefined}
            rel={external(secondary.href) ? 'noopener' : undefined}>{secondary.label}</a
          >
        </div>
        <a class="proof" href={proof.href}>
          {proof.label} <span aria-hidden="true">→</span>
        </a>
      </div>
    </div>
    <footer class="foot wrap">
      <span>© {new Date().getFullYear()} GLS</span>
      <a href="mailto:{site.email}">{site.email}</a>
      <a href="#top">Back to top ↑</a>
    </footer>
  </div>
</section>

<style>
  /* static (no-JS / reduced motion): a calm paper close */
  .fin {
    position: relative;
    background: var(--paper);
    color: var(--ink);
  }
  .anchor {
    position: absolute;
    top: 0;
  }
  .pin {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 6rem 0 2rem;
    text-align: center;
  }
  .old,
  .flood {
    display: none;
  }
  .mark {
    width: 112px;
    height: auto;
  }
  .copy {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .eyebrow {
    margin: 2.2rem 0 1.2rem;
    color: var(--leaf);
  }
  h2 {
    margin: 0;
    font-size: clamp(3rem, 8.4vw, 8.6rem);
  }
  h2 > span {
    display: block;
  }
  h2 em {
    color: var(--leaf);
  }
  .cta p {
    max-width: 34rem;
    margin: 2rem auto;
    color: var(--muted);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.8rem;
  }
  .btn {
    --fg: var(--ink);
  }
  .btn.ghost:hover {
    color: var(--ink);
  }
  .btn.ghost::before {
    background: var(--lime);
  }
  .proof {
    display: inline-block;
    margin-top: 2.2rem;
    padding: 0.6rem 0;
    font-size: 0.9rem;
    font-weight: 600;
    text-decoration: none;
    border-bottom: 1px solid var(--line);
    transition: border-color 0.4s;
  }
  .proof:hover {
    border-color: var(--ink);
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.8rem 2rem;
    margin-top: 5rem;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .foot a {
    text-decoration: none;
  }

  /* ---------------------------------------------------------------- live */
  .live {
    height: 300vh;
    margin-top: -100vh;
    margin-top: -100svh;
    background: transparent;
    z-index: 0;
  }
  .live .anchor {
    top: 60%;
  }
  .live .pin {
    position: sticky;
    top: 0;
    height: 100vh;
    height: 100svh;
    justify-content: center;
    padding: 0;
    overflow: hidden;
    background: var(--ink);
  }
  .live .old {
    display: flex;
    flex-direction: column;
    align-items: center;
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(2.2rem + 1.5rem);
    padding-inline: var(--gutter);
    color: var(--cream);
    opacity: var(--old, 1);
  }
  .ol {
    font-family: var(--serif);
    font-optical-sizing: auto;
    font-variation-settings: 'SOFT' 50, 'WONK' 0;
    font-weight: 340;
    letter-spacing: -0.035em;
    line-height: 0.98;
    font-size: clamp(2rem, 3.6vw, 3.4rem);
  }
  .os {
    margin-top: 1rem;
    font-size: 0.82rem;
    font-weight: 600;
    font-stretch: 110%;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--lime);
  }
  .live .flood {
    display: block;
    position: absolute;
    inset: 0;
    background: var(--paper);
    clip-path: circle(calc(var(--flood, 0) * 150vmax) at 50% var(--mark-y, 50vh));
  }
  .live .mark {
    position: absolute;
    left: 50%;
    top: var(--mark-y, 50vh);
    width: var(--mark-px, 160px);
    translate: -50% calc(-50% - var(--lift, 0) * (var(--mark-y, 50vh) - 15vh) * 1) 0;
    scale: calc(1 - var(--lift, 0) * 0.45);
  }
  .live .copy {
    margin-top: 6vh;
  }
  .live .eyebrow {
    opacity: var(--h1, 0);
  }
  .live h2 > span {
    overflow: visible clip;
    padding-bottom: 0.08em;
  }
  .live .l1 {
    opacity: var(--h1, 0);
    translate: 0 calc((1 - var(--h1, 0)) * 0.5em);
  }
  .live .l2 {
    opacity: var(--h2, 0);
    translate: 0 calc((1 - var(--h2, 0)) * 0.5em);
  }
  .live .cta {
    opacity: var(--cta, 0);
    translate: 0 calc((1 - var(--cta, 0)) * 1.5rem);
    visibility: visible;
  }
  .live .foot {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 1.4rem;
    margin: 0 auto;
    opacity: var(--cta, 0);
  }
  .live h2 {
    font-size: clamp(2.8rem, 7.4vw, 7.6rem);
  }

  @media (max-width: 759px) {
    .live .old {
      bottom: 1.6rem;
    }
    .ol {
      font-size: clamp(1.8rem, 8.4vw, 2.3rem);
    }
    .os {
      font-size: 0.66rem;
      line-height: 1.7;
    }
    .live .copy {
      margin-top: 10vh;
    }
    .live h2 {
      font-size: clamp(2.5rem, 12.5vw, 3.6rem);
    }
    .cta p {
      margin: 1.3rem auto 1.6rem;
      font-size: 0.95rem;
    }
    .row .btn {
      flex: 1 1 100%;
      justify-content: center;
    }
    .proof {
      margin-top: 1.2rem;
    }
    .live .foot {
      font-size: 0.72rem;
      justify-content: center;
    }
  }
</style>
