<script lang="ts">
  import { onMount } from 'svelte';
  import { magnetic, progress } from '$lib/motion';
  import { photo, src, srcset } from '$lib/site';

  // The film opening is CSS-driven; JS only says "action" once the image is decoded,
  // so the sequence never plays over an empty frame.
  let ready = $state(false);
  let img: HTMLImageElement;

  onMount(() => {
    const go = () => requestAnimationFrame(() => (ready = true));
    if (img.complete) go();
    else {
      img.addEventListener('load', go, { once: true });
      img.addEventListener('error', go, { once: true });
      setTimeout(go, 1800); // never hold the page hostage to a slow image
    }
  });

  const ring = 'Baked every morning · Cooked to order · Since 2018 · ';
</script>

<section id="top" class="hero" class:ready use:progress={{ prop: '--hp', mode: 'exit' }} aria-labelledby="hero-title">
  <div class="frame">
    <img
      bind:this={img}
      src={src(photo.croissants, 2000)}
      srcset={srcset(photo.croissants, [800, 1200, 1800, 2600])}
      sizes="100vw"
      alt="Golden croissants dusted with flour on a dark board"
      fetchpriority="high"
      decoding="async"
    />
  </div>
  <div class="veil" aria-hidden="true"></div>

  <div class="content wrap">
    <p class="eyebrow kicker"><span class="rule"></span>Kitchen &amp; Bakery — Est. 2018</p>

    <h1 id="hero-title" class="display title">
      <span class="sr-only">GLS Kitchen &amp; Bakery. </span>
      <span class="l l1" aria-hidden="true"><span>Freshly made.</span></span>
      <span class="l l2" aria-hidden="true"><span><em>Beautifully</em></span></span>
      <span class="l l3" aria-hidden="true"><span>served.</span></span>
    </h1>

    <div class="foot">
      <p class="lede">
        Nigerian cooking from a proper kitchen, and a bakery that starts before sunrise. Order for
        tonight — or for the whole party.
      </p>
      <div class="ctas">
        <a class="btn" href="#menu" use:magnetic>Order now <span class="arrow" aria-hidden="true">→</span></a>
        <a class="btn ghost" href="#signatures">Explore the kitchen</a>
      </div>
    </div>
  </div>

  <div class="badge" aria-hidden="true">
    <svg viewBox="0 0 200 200">
      <defs><path id="ring" d="M100,100 m-78,0 a78,78 0 1,1 156,0 a78,78 0 1,1 -156,0" /></defs>
      <text><textPath href="#ring" textLength="486" lengthAdjust="spacing">{ring}</textPath></text>
    </svg>
    <img src="/favicon.png" alt="" width="56" height="64" />
  </div>

  <a class="cue eyebrow" href="#house"><span class="tick"></span>Scroll — Chapter 01</a>
</section>

<style>
  .hero {
    --hp: 0;
    position: relative;
    height: 100svh;
    min-height: 640px;
    overflow: clip;
    background: var(--ink);
    color: var(--cream);
    isolation: isolate;
  }

  /* 1–2 · frame opens from a letterboxed crop, image settles inside it */
  .frame {
    position: absolute;
    inset: 0;
    z-index: -2;
    clip-path: inset(18% 22% 18% 22%);
    /* scroll: slow drift down + gentle push-in (no transition — tracks the wheel 1:1) */
    translate: 0 calc(var(--hp) * 16%);
    scale: calc(1 + var(--hp) * 0.1);
    transition: clip-path 2s var(--ease-io) 0.15s;
  }
  .frame img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 60% 55%;
    scale: 1.32;
    opacity: 0;
    filter: saturate(0.9) contrast(1.05);
    transition:
      scale 3.2s var(--ease) 0.1s,
      opacity 1.2s ease 0.05s;
  }
  .ready .frame {
    clip-path: inset(0 0 0 0);
  }
  .ready .frame img {
    scale: 1.04;
    opacity: 1;
  }
  .veil {
    position: absolute;
    inset: 0;
    z-index: -1;
    background:
      linear-gradient(180deg, rgb(20 23 15 / 0.55) 0%, transparent 28%),
      linear-gradient(0deg, rgb(20 23 15 / 0.92) 0%, rgb(20 23 15 / 0.35) 48%, transparent 75%),
      linear-gradient(90deg, rgb(20 23 15 / 0.55) 0%, transparent 60%);
    opacity: 0;
    transition: opacity 1.6s ease 0.6s;
  }
  .ready .veil {
    opacity: 1;
  }

  .content {
    position: relative;
    height: 100%;
    display: grid;
    align-content: end;
    padding-bottom: clamp(5rem, 11vh, 8rem);
    translate: 0 calc(var(--hp) * -12vh);
    opacity: calc(1 - var(--hp) * 1.6);
  }
  .kicker {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin: 0 0 clamp(1.25rem, 3vh, 2rem);
    color: var(--lime);
  }
  .rule {
    width: 3rem;
    height: 1px;
    background: currentColor;
    transform: scaleX(0);
    transform-origin: left;
    transition: transform 1.2s var(--ease) 1.1s;
  }
  .kicker {
    opacity: 0;
    transition: opacity 1s ease 1s;
  }
  .ready .kicker {
    opacity: 1;
  }
  .ready .rule {
    transform: scaleX(1);
  }

  /* 3 · headline rises line by line out of masks */
  .title {
    margin: 0;
    font-size: clamp(3.6rem, 11.5vw, 12.5rem);
  }
  .l {
    display: block;
    /* mask vertically only: a horizontal clip shaves italic overhangs */
    overflow: visible clip;
    padding-bottom: 0.2em;
    margin-bottom: -0.2em;
  }
  .l > span {
    display: block;
    translate: 0 110%;
    rotate: 0 0 1 3deg;
    transform-origin: left bottom;
    transition:
      translate 1.5s var(--ease),
      rotate 1.5s var(--ease);
  }
  .l2 {
    color: var(--lime);
  }
  .l1 > span {
    transition-delay: 0.7s;
  }
  .l2 > span {
    transition-delay: 0.85s;
  }
  .l3 > span {
    transition-delay: 1s;
  }
  .ready .l > span {
    translate: 0 0;
    rotate: 0 0 1 0deg;
  }

  /* 4–5 · supporting copy then CTA */
  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    justify-content: space-between;
    gap: 2rem 4rem;
    margin-top: clamp(1.75rem, 4vh, 3rem);
  }
  .lede {
    max-width: 30rem;
    margin: 0;
    font-size: clamp(1rem, 0.9rem + 0.35vw, 1.2rem);
    color: color-mix(in oklab, var(--cream) 82%, transparent);
  }
  .lede,
  .ctas {
    opacity: 0;
    translate: 0 1.25rem;
    transition:
      opacity 1.2s ease,
      translate 1.4s var(--ease);
  }
  .lede {
    transition-delay: 1.35s;
  }
  .ctas {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    transition-delay: 1.55s;
  }
  .ready .lede,
  .ready .ctas {
    opacity: 1;
    translate: 0 0;
  }

  /* 6 · small details settle */
  .badge {
    position: absolute;
    top: clamp(6rem, 16vh, 9rem);
    right: var(--gutter);
    width: clamp(7rem, 11vw, 9.5rem);
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    opacity: 0;
    scale: 0.85;
    transition:
      opacity 1s ease 1.8s,
      scale 1.6s var(--ease) 1.8s;
  }
  .ready .badge {
    opacity: 1;
    scale: 1;
  }
  .badge svg {
    position: absolute;
    inset: 0;
    /* rotation is scroll-linked, not perpetual */
    rotate: calc(var(--hp) * 220deg);
    fill: var(--cream);
    font-family: var(--sans);
    font-size: 13.4px;
    font-weight: 600;
    letter-spacing: 0.22em;
    text-transform: uppercase;
  }
  .badge img {
    width: 34%;
    height: auto;
  }
  .cue {
    position: absolute;
    left: var(--gutter);
    bottom: 1.6rem;
    display: flex;
    align-items: center;
    gap: 0.8rem;
    color: color-mix(in oklab, var(--cream) 70%, transparent);
    text-decoration: none;
    opacity: 0;
    transition: opacity 1s ease 2.1s;
  }
  .ready .cue {
    opacity: calc(1 - var(--hp) * 4);
  }
  .tick {
    position: relative;
    width: 1px;
    height: 2.2rem;
    overflow: clip;
    background: color-mix(in oklab, var(--cream) 25%, transparent);
  }
  .tick::after {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--lime);
    animation: drip 2.4s var(--ease-io) 2.6s infinite;
    translate: 0 -100%;
  }
  @keyframes drip {
    0% {
      translate: 0 -100%;
    }
    55%,
    100% {
      translate: 0 100%;
    }
  }

  @media (max-width: 720px) {
    .badge {
      display: none;
    }
    .cue {
      display: none;
    }
    .frame img {
      object-position: 55% 40%;
    }
  }
</style>
