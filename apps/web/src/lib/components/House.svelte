<script lang="ts">
  import { progress, reveal } from '$lib/motion';

  const statement =
    'Since 2018, GLS has fed birthdays, Sunday lunches, office mornings and owambe Saturdays. A kitchen that cooks the way home does — and a bakery that bakes like it means it.';
  const words = statement.split(' ');
  // Words that carry the brand get the italic, lime-underlined treatment.
  const accent = new Set(['home', 'bakes']);

  const pillars = [
    { k: 'Kitchen', v: 'Nigerian classics, cooked to order and packed hot.' },
    { k: 'Bakery', v: 'Breads, pastries and celebration cakes, out of the oven daily.' },
    { k: 'Events', v: 'Small chops, trays and catering for the whole guest list.' }
  ];
</script>

<section id="house" class="house" aria-labelledby="house-title">
  <div class="wrap grid">
    <header class="side">
      <p class="chapter-no" use:reveal>01</p>
      <h2 id="house-title" class="eyebrow" use:reveal={{ delay: 120 }}>The House of GLS</h2>
    </header>

    <!-- Ink fills the statement word-by-word as it moves through the viewport. -->
    <p class="statement display" use:progress style="--n:{words.length}">
      {#each words as w, i}
        <span class="w" class:acc={accent.has(w.replace(/[^a-z]/gi, ''))} style="--i:{i}">{w}</span>{' '}
      {/each}
    </p>

    <ul class="pillars">
      {#each pillars as p, i}
        <li use:reveal={{ delay: i * 120 }}>
          <span class="idx">0{i + 1}</span>
          <h3>{p.k}</h3>
          <p>{p.v}</p>
        </li>
      {/each}
    </ul>
  </div>
</section>

<style>
  .house {
    position: relative;
    padding-block: clamp(6rem, 16vh, 12rem) clamp(5rem, 12vh, 9rem);
    background: var(--paper);
  }
  .grid {
    display: grid;
    grid-template-columns: minmax(10rem, 1fr) 4fr;
    gap: 2rem clamp(2rem, 6vw, 6rem);
  }
  .side {
    position: sticky;
    top: 7rem;
    align-self: start;
  }
  .chapter-no {
    margin: 0;
    font-size: clamp(4rem, 8vw, 7rem);
    line-height: 0.8;
    color: var(--leaf);
  }
  .side h2 {
    margin: 1rem 0 0;
    color: var(--muted);
  }

  .statement {
    --p: 0;
    margin: 0;
    font-size: clamp(2rem, 1.1rem + 3.6vw, 4.6rem);
    line-height: 1.04;
    letter-spacing: -0.03em;
    font-weight: 360;
    text-wrap: pretty;
  }
  .w {
    /* k sweeps 0 → n across the middle of the viewport */
    --k: calc((var(--p) * 2.1 - 0.45) * var(--n));
    opacity: clamp(0.13, calc(var(--k) - var(--i)), 1);
  }
  .w.acc {
    font-style: italic;
    font-variation-settings: 'SOFT' 100, 'WONK' 1;
    background: linear-gradient(var(--lime), var(--lime)) 0 88% / 100% 0.1em no-repeat;
  }

  .pillars {
    grid-column: 2;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    margin: clamp(4rem, 10vh, 7rem) 0 0;
    padding: 0;
    list-style: none;
    border-top: 1px solid var(--line);
  }
  .pillars li {
    padding: 1.75rem 2rem 0 0;
  }
  .pillars li + li {
    padding-left: 2rem;
    border-left: 1px solid var(--line);
  }
  .idx {
    font-family: var(--serif);
    font-style: italic;
    color: var(--crust);
  }
  .pillars h3 {
    margin: 0.4rem 0 0.5rem;
    font-family: var(--serif);
    font-weight: 400;
    font-size: 1.6rem;
    letter-spacing: -0.02em;
  }
  .pillars p {
    margin: 0;
    color: var(--muted);
    max-width: 22rem;
  }

  @media (max-width: 860px) {
    .grid {
      grid-template-columns: 1fr;
    }
    .side {
      position: static;
      display: flex;
      align-items: baseline;
      gap: 1rem;
    }
    .pillars {
      grid-column: 1;
      grid-template-columns: 1fr;
    }
    .pillars li,
    .pillars li + li {
      padding: 1.5rem 0;
      border-left: 0;
      border-bottom: 1px solid var(--line);
    }
  }
</style>
