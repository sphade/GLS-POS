<script lang="ts">
  import { magnetic, progress, reveal } from '$lib/motion';
  import { bag } from '$lib/bag.svelte';
  import { photo, src, srcset } from '$lib/site';

  const shots = [
    { k: 'a', img: photo.chocolateCake, cap: 'Cake parfait', alt: 'A GLS cake parfait cup', s: -8, w: 1000 },
    { k: 'b', img: photo.raspberrySlice, cap: 'Fruit parfait', alt: 'A GLS fruit parfait cup', s: 14, w: 700 },
    { k: 'c', img: photo.sourdough, cap: 'Butter bread', alt: 'A loaf of GLS butter bread', s: 6, w: 1100 },
    { k: 'd', img: photo.cookies, cap: 'Chin-chin', alt: 'A pack of GLS chin-chin', s: -12, w: 700 },
    { k: 'e', img: photo.orangeCake, cap: 'Foil cake', alt: 'A GLS milky foil cake', s: 10, w: 800 },
    { k: 'f', img: photo.bakeryShelf, cap: 'The bread wall', alt: 'Shelves of fresh bread and pastries in a bakery', s: -6, w: 900 }
  ];
</script>

<section id="bakery" class="bakery" use:progress aria-labelledby="bakery-title">
  <p class="giant display" aria-hidden="true"><em>Bakery</em></p>

  <div class="wrap collage">
    <div class="copy">
      <p class="chapter-no" use:reveal>04</p>
      <p class="eyebrow tag" use:reveal={{ delay: 80 }}>The Bakery</p>
      <h2 id="bakery-title" class="display rv lines" use:reveal={{ delay: 120 }}>
        <span><span>Out of the oven,</span></span>
        <span><span><em>into your hands.</em></span></span>
      </h2>
      <p class="body" use:reveal={{ delay: 260 }}>
        Croissants laminated by hand. Agege loaves the way they should be. Celebration cakes made to
        order — tell us the day, and we’ll take care of the rest.
      </p>
      <a class="btn dark" href="#menu" onclick={() => (bag.tab = 'cakes')} use:magnetic use:reveal={{ delay: 360 }}>
        Pre-order a cake <span class="arrow" aria-hidden="true">→</span>
      </a>
    </div>

    {#each shots as s}
      <figure class="shot {s.k}" style="--s:{s.s}vh">
        <div class="frame rv mask" use:reveal={{ threshold: 0.15 }}>
          <img
            src={src(s.img, s.w)}
            srcset={srcset(s.img, [480, 800, 1200, 1600])}
            sizes="(min-width: 900px) 33vw, 50vw"
            alt={s.alt}
            loading="lazy"
            decoding="async"
          />
        </div>
        <figcaption class="eyebrow">{s.cap}</figcaption>
      </figure>
    {/each}
  </div>
</section>

<style>
  .bakery {
    --p: 0;
    position: relative;
    overflow: clip;
    background: var(--paper);
    padding-block: clamp(6rem, 14vh, 10rem) clamp(7rem, 16vh, 12rem);
  }
  .giant {
    position: absolute;
    top: clamp(2rem, 6vh, 5rem);
    left: 0;
    margin: 0;
    white-space: nowrap;
    font-size: clamp(9rem, 30vw, 34rem);
    line-height: 0.8;
    color: color-mix(in oklab, var(--crust) 13%, transparent);
    translate: calc((0.5 - var(--p)) * 40vw - 6vw) 0;
    pointer-events: none;
    user-select: none;
  }

  .collage {
    position: relative;
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: clamp(1rem, 2vw, 2rem);
    row-gap: clamp(2.5rem, 6vh, 4.5rem);
    padding-top: clamp(8rem, 22vw, 20rem);
  }
  .copy {
    grid-column: 1 / 6;
    grid-row: 1;
    align-self: end;
    padding-bottom: 2rem;
  }
  .chapter-no {
    margin: 0;
    font-size: clamp(3rem, 6vw, 5.5rem);
    line-height: 0.8;
    color: var(--leaf);
  }
  .tag {
    margin: 1rem 0 1.5rem;
    color: var(--muted);
  }
  h2 {
    margin: 0;
    font-size: clamp(2.6rem, 4.8vw, 5.4rem);
  }
  h2 em {
    color: var(--crust);
  }
  .body {
    max-width: 27rem;
    margin: 1.75rem 0 2.25rem;
    color: var(--muted);
    font-size: 1.08rem;
  }
  .btn.dark {
    --bg: var(--ink);
    --fg: var(--lime);
    color: var(--cream);
  }
  .btn.dark:hover {
    color: var(--ink);
  }

  .shot {
    margin: 0;
    translate: 0 calc((var(--p) - 0.5) * var(--s) * 4);
  }
  .frame {
    overflow: clip;
    background: var(--cream);
    height: 100%;
  }
  .frame img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition:
      scale 1.6s var(--ease),
      clip-path 1.6s var(--ease);
  }
  .shot:hover .frame img {
    scale: 1.07;
  }
  figcaption {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-top: 0.9rem;
    font-size: 0.66rem;
    color: var(--muted);
  }
  figcaption::before {
    content: '';
    width: 1.5rem;
    height: 1px;
    background: currentColor;
    transition: width 0.6s var(--ease);
  }
  .shot:hover figcaption::before {
    width: 3rem;
  }

  .a {
    grid-column: 6 / 10;
    grid-row: 1 / 3;
    aspect-ratio: 4 / 5.6;
  }
  .b {
    grid-column: 10 / 13;
    grid-row: 1;
    align-self: end;
    aspect-ratio: 3 / 4;
  }
  .c {
    grid-column: 1 / 6;
    grid-row: 2 / 4;
    aspect-ratio: 5 / 4;
    align-self: center;
  }
  .d {
    grid-column: 10 / 13;
    grid-row: 2;
    aspect-ratio: 1;
  }
  .e {
    grid-column: 6 / 9;
    grid-row: 3;
    aspect-ratio: 4 / 5;
  }
  .f {
    grid-column: 9 / 13;
    grid-row: 3;
    aspect-ratio: 4 / 3;
    align-self: end;
  }
  .shot {
    display: grid;
    grid-template-rows: 1fr auto;
  }

  @media (max-width: 899px) {
    .collage {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      padding-top: 9rem;
    }
    .copy {
      grid-column: 1 / -1;
      grid-row: auto;
    }
    .shot {
      grid-row: auto !important;
      translate: none;
    }
    .a,
    .c {
      grid-column: 1 / -1;
    }
    .b,
    .d,
    .e,
    .f {
      grid-column: auto;
    }
  }
</style>
