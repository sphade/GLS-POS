<script lang="ts">
  import { onMount } from 'svelte';
  import { progress, reveal } from '$lib/motion';
  import { photo, src, srcset } from '$lib/site';

  const dishes = [
    {
      name: 'Party Jollof',
      line: 'Smoke from the bottom of the pot',
      body: 'Long-fried tomato and pepper base, parboiled long-grain, finished low so the smoke gets in. Served with dodo.',
      img: photo.jollof,
      alt: 'A pan of rich red rice with herbs and lemon'
    },
    {
      name: 'Beef Suya',
      line: 'Yaji, open flame, no shortcuts',
      body: 'Thin-cut beef rubbed in our own yaji blend and grilled over open heat. Raw onion, tomato, a little more pepper.',
      img: photo.suya,
      alt: 'Skewers of spiced grilled meat over charcoal'
    },
    {
      name: 'Peppered Chicken',
      line: 'Grilled first, then drowned in rodo',
      body: 'Seasoned overnight, grilled for char, then tossed in a scotch-bonnet sauce that will make you reach for water.',
      img: photo.pepperedChicken,
      alt: 'Chicken pieces in a glossy pepper sauce with basil'
    },
    {
      name: 'Small Chops & Trays',
      line: 'For when everyone is coming',
      body: 'Puff-puff, samosa, spring rolls, gizdodo and grills — boxed for the office or trayed for the owambe.',
      img: photo.spread,
      alt: 'A table spread of plated dishes and herbs, seen from above'
    }
  ];

  let track: HTMLDivElement;
  let pinned = $state(false);
  let travel = $state(0);

  onMount(() => {
    const mq = matchMedia('(min-width: 900px) and (prefers-reduced-motion: no-preference)');
    const measure = () => {
      pinned = mq.matches;
      travel = pinned ? Math.max(0, track.scrollWidth - innerWidth) : 0;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    mq.addEventListener('change', measure);
    return () => {
      ro.disconnect();
      mq.removeEventListener('change', measure);
    };
  });
</script>

<section
  id="signatures"
  class="sig"
  class:pinned
  style="--travel:{travel}px"
  use:progress={{ mode: 'pin' }}
  aria-labelledby="sig-title"
>
  <div class="stage">
    <div class="track" bind:this={track}>
      <header class="intro">
        <p class="chapter-no" use:reveal>02</p>
        <h2 id="sig-title" class="display rv lines" use:reveal={{ delay: 80 }}>
          <span><span>From the</span></span>
          <span><span><em>pot</em> &amp; the</span></span>
          <span><span>grill.</span></span>
        </h2>
        <p class="sub" use:reveal={{ delay: 300 }}>
          Four plates people drive across town for. The rest of the menu is waiting at the end.
        </p>
        <p class="hint eyebrow" aria-hidden="true">Keep scrolling <span>→</span></p>
      </header>

      {#each dishes as d, i}
        <article class="dish" style="--c:{(i + 1) / (dishes.length + 1)}">
          <figure class="shot rv mask" use:reveal={{ threshold: 0.1 }}>
            <img
              src={src(d.img, 1400)}
              srcset={srcset(d.img)}
              sizes="(min-width: 900px) 58vw, 100vw"
              alt={d.alt}
              loading="lazy"
              decoding="async"
            />
          </figure>
          <div class="cap">
            <span class="no chapter-no">No. {String(i + 1).padStart(2, '0')}</span>
            <h3 class="display">{d.name}</h3>
            <p class="line eyebrow">{d.line}</p>
            <p class="body">{d.body}</p>
          </div>
        </article>
      {/each}
    </div>
    <div class="bar" aria-hidden="true"><span></span></div>
  </div>
</section>

<style>
  .sig {
    --p: 0;
    position: relative;
    background: var(--cream);
  }
  .stage {
    padding-block: clamp(5rem, 12vh, 8rem);
  }
  .track {
    display: flex;
    flex-direction: column;
    gap: clamp(4rem, 10vh, 7rem);
    padding-inline: var(--gutter);
  }

  /* ---- desktop: pinned horizontal chapter ---- */
  .pinned {
    height: calc(100vh + var(--travel));
  }
  .pinned .stage {
    position: sticky;
    top: 0;
    height: 100vh;
    padding: 0;
    overflow: clip;
  }
  .pinned .track {
    flex-direction: row;
    align-items: center;
    gap: 5vw;
    height: 100%;
    width: max-content;
    padding-inline: var(--gutter) 8vw;
    translate: calc(var(--p) * var(--travel) * -1) 0;
    will-change: translate;
  }

  .intro {
    max-width: 34rem;
  }
  .pinned .intro {
    width: 34vw;
    flex: none;
  }
  .chapter-no {
    margin: 0 0 1.25rem;
    font-size: clamp(3rem, 6vw, 5.5rem);
    line-height: 0.8;
    color: var(--leaf);
  }
  .intro h2 {
    margin: 0;
    font-size: clamp(3.2rem, 7vw, 7.5rem);
  }
  .intro em {
    color: var(--crust);
  }
  .sub {
    max-width: 24rem;
    margin: 2rem 0 0;
    color: var(--muted);
    font-size: 1.1rem;
  }
  .hint {
    display: none;
    margin-top: 3rem;
    color: var(--leaf);
  }
  .pinned .hint {
    display: block;
    opacity: calc(1 - var(--p) * 8);
  }
  .hint span {
    display: inline-block;
    animation: nudge 2.4s var(--ease-io) infinite;
  }
  @keyframes nudge {
    50% {
      translate: 0.5rem 0;
    }
  }

  .dish {
    position: relative;
  }
  .pinned .dish {
    flex: none;
    width: 58vw;
    height: 100%;
    display: grid;
    grid-template-rows: 1fr auto;
    padding-block: 12vh 8vh;
  }
  .pinned .dish:nth-of-type(even) {
    padding-block: 7vh 13vh;
  }
  .shot {
    margin: 0;
    overflow: clip;
    aspect-ratio: 4 / 5;
    background: var(--ink-2);
  }
  .pinned .shot {
    aspect-ratio: auto;
    min-height: 0;
  }
  .shot img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition:
      scale 1.6s var(--ease),
      clip-path 1.6s var(--ease);
  }
  .pinned .shot img {
    /* inner image drifts against the track for depth */
    width: 118%;
    max-width: none;
    translate: calc(-7.5% + (var(--p) - var(--c)) * -9%) 0;
  }
  .dish:hover .shot img {
    scale: 1.05;
  }

  .cap {
    position: relative;
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 2rem;
    align-items: end;
    margin-top: -0.55em;
    font-size: clamp(2.6rem, 5.6vw, 6.4rem);
  }
  .no {
    grid-row: 1 / 3;
    align-self: start;
    margin-top: 0.9em;
    font-size: 1rem;
    color: var(--crust);
  }
  .cap h3 {
    margin: 0;
    font-size: 1em;
    color: var(--ink);
    text-shadow: 0 0 0.4em var(--cream);
  }
  .line {
    margin: 0.9rem 0 0.4rem;
    font-size: 0.7rem;
    color: var(--leaf);
  }
  .body {
    grid-column: 2;
    max-width: 30rem;
    margin: 0;
    font-size: 1rem;
    color: var(--muted);
  }

  .bar {
    display: none;
  }
  .pinned .bar {
    display: block;
    position: absolute;
    left: var(--gutter);
    right: var(--gutter);
    bottom: 2rem;
    height: 1px;
    background: var(--line);
  }
  .pinned .bar span {
    position: absolute;
    inset: 0;
    background: var(--ink);
    transform: scaleX(var(--p));
    transform-origin: left;
  }

  @media (max-width: 899px) {
    .cap {
      grid-template-columns: 1fr;
      margin-top: 1.25rem;
    }
    .no {
      grid-row: auto;
      margin: 0 0 0.5rem;
    }
    .body {
      grid-column: 1;
    }
  }
</style>
