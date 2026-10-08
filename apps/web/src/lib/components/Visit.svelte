<script lang="ts">
  import { magnetic, progress, reveal } from '$lib/motion';
  import { branches, photo, site, src, srcset } from '$lib/site';

  const year = new Date().getFullYear();
</script>

<section id="visit" class="visit" aria-labelledby="visit-title">
  <div class="scene" use:progress>
    <img
      src={src(photo.dining, 2000)}
      srcset={srcset(photo.dining, [800, 1200, 1800, 2600])}
      sizes="100vw"
      alt="A warmly lit table set with plates, glasses and food"
      loading="lazy"
      decoding="async"
    />
    <div class="shade" aria-hidden="true"></div>
    <div class="wrap over">
      <p class="chapter-no" use:reveal>06</p>
      <h2 id="visit-title" class="display rv lines" use:reveal={{ delay: 100 }}>
        <span><span>Come</span></span>
        <span><span><em>hungry.</em></span></span>
      </h2>
    </div>
  </div>

  <div class="wrap branches" aria-labelledby="branches-title">
    <div class="bhead" use:reveal>
      <h3 id="branches-title" class="eyebrow">Our branches</h3>
      <p>More GLS kitchens are on the way.</p>
    </div>
    <ul>
      {#each branches as b, i}
        <li class:soon={b.status === 'soon'} use:reveal={{ delay: i * 100 }}>
          <span class="tag">{b.status === 'open' ? 'Open now' : 'Coming soon'}</span>
          <span class="bn display">{b.name}</span>
          <span class="ba">{b.area}</span>
        </li>
      {/each}
    </ul>
  </div>

  <div class="wrap info">
    <div class="col" use:reveal>
      <h3 class="eyebrow">Find us</h3>
      <address>
        {#each site.address as line}<span>{line}</span>{/each}
      </address>
      <a class="link" href={site.mapsUrl} target="_blank" rel="noopener">Get directions ↗</a>
    </div>
    <div class="col" use:reveal={{ delay: 100 }}>
      <h3 class="eyebrow">Opening hours</h3>
      <dl>
        {#each site.hours as h}
          <div><dt>{h.days}</dt><dd>{h.time}</dd></div>
        {/each}
      </dl>
    </div>
    <div class="col" use:reveal={{ delay: 200 }}>
      <h3 class="eyebrow">Talk to us</h3>
      <a class="big" href="tel:+{site.whatsapp}">{site.phoneDisplay}</a>
      <a class="link" href="mailto:{site.email}">{site.email}</a>
      <a class="link" href={site.instagram} target="_blank" rel="noopener">Instagram ↗</a>
    </div>
    <div class="cta" use:reveal={{ delay: 300 }}>
      <p>Catering, birthdays, office trays — tell us the headcount and we’ll build the menu.</p>
      <a
        class="btn"
        href="https://wa.me/{site.whatsapp}?text={encodeURIComponent('Hello GLS! I’d like to ask about catering for an event.')}"
        target="_blank"
        rel="noopener"
        use:magnetic
      >
        Plan an event <span class="arrow" aria-hidden="true">→</span>
      </a>
    </div>
  </div>
</section>

<footer class="end">
  <div class="wrap mark">
    <img src="/gls-logo.png" alt="GLS — Est. 2018" width="520" height="697" loading="lazy" use:reveal />
    <p class="sign display" use:reveal={{ delay: 150 }}>
      Freshly made.<br /><em>Beautifully served.</em>
    </p>
  </div>
  <div class="wrap legal">
    <span>© {year} {site.name}</span>
    <a href="#top">Back to top ↑</a>
  </div>
</footer>

<style>
  .visit {
    background: var(--ink);
    color: var(--cream);
  }
  .scene {
    --p: 0;
    position: relative;
    height: 115vh;
    min-height: 620px;
    overflow: clip;
    display: grid;
    align-items: end;
  }
  .scene img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    scale: calc(1.25 - var(--p) * 0.25);
    translate: 0 calc((var(--p) - 0.5) * -10%);
  }
  .shade {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(0deg, var(--ink) 0%, rgb(20 23 15 / 0.6) 35%, rgb(20 23 15 / 0.25) 70%, var(--ink) 100%);
  }
  .over {
    position: relative;
    padding-bottom: clamp(3rem, 10vh, 7rem);
  }
  .chapter-no {
    margin: 0 0 1rem;
    font-size: clamp(3rem, 6vw, 5.5rem);
    line-height: 0.8;
    color: var(--lime);
  }
  h2 {
    margin: 0;
    font-size: clamp(5rem, 18vw, 20rem);
    line-height: 0.82;
  }
  h2 em {
    color: var(--lime);
  }

  .branches {
    display: grid;
    grid-template-columns: 1fr 3fr;
    gap: 2.5rem;
    padding-block: clamp(3.5rem, 9vh, 6rem);
    border-top: 1px solid color-mix(in oklab, var(--cream) 14%, transparent);
  }
  .bhead h3 {
    margin: 0 0 0.8rem;
    color: var(--lime);
  }
  .bhead p {
    margin: 0;
    color: color-mix(in oklab, var(--cream) 70%, transparent);
  }
  .branches ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1px;
    background: color-mix(in oklab, var(--cream) 14%, transparent);
  }
  .branches li {
    display: grid;
    gap: 0.5rem;
    align-content: start;
    padding: 1.6rem 1.5rem 1.8rem;
    background: var(--ink);
  }
  .tag {
    width: fit-content;
    padding: 0.3rem 0.6rem;
    font-size: 0.68rem;
    font-weight: 600;
    font-stretch: 110%;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    background: var(--lime);
    color: var(--ink);
  }
  .soon .tag {
    background: transparent;
    color: var(--lime);
    box-shadow: inset 0 0 0 1px var(--lime);
  }
  .bn {
    font-size: clamp(2rem, 3.4vw, 3rem);
  }
  .soon .bn {
    color: color-mix(in oklab, var(--cream) 60%, transparent);
  }
  .ba {
    color: color-mix(in oklab, var(--cream) 65%, transparent);
    font-size: 0.95rem;
  }

  .info {
    display: grid;
    grid-template-columns: repeat(3, 1fr) 1.3fr;
    gap: 2.5rem;
    padding-block: clamp(4rem, 10vh, 7rem);
    border-top: 1px solid color-mix(in oklab, var(--cream) 14%, transparent);
  }
  .col {
    display: grid;
    align-content: start;
    gap: 0.6rem;
  }
  .col h3 {
    margin: 0 0 0.6rem;
    color: var(--lime);
  }
  address {
    display: grid;
    font-style: normal;
    font-family: var(--serif);
    font-size: 1.3rem;
    line-height: 1.3;
  }
  dl {
    margin: 0;
    display: grid;
    gap: 0.4rem;
  }
  dl div {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    max-width: 16rem;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid color-mix(in oklab, var(--cream) 12%, transparent);
  }
  dt {
    color: color-mix(in oklab, var(--cream) 65%, transparent);
  }
  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  .big {
    font-family: var(--serif);
    font-size: 1.4rem;
    text-decoration: none;
  }
  .link {
    width: fit-content;
    color: color-mix(in oklab, var(--cream) 75%, transparent);
    text-decoration: none;
    background: linear-gradient(currentColor, currentColor) 0 100% / 0 1px no-repeat;
    transition:
      background-size 0.6s var(--ease),
      color 0.3s;
  }
  .link:hover {
    color: var(--cream);
    background-size: 100% 1px;
  }
  .cta p {
    margin: 0 0 1.5rem;
    font-family: var(--serif);
    font-size: 1.5rem;
    line-height: 1.25;
    letter-spacing: -0.015em;
  }

  .end {
    background: var(--paper);
    color: var(--ink);
  }
  .mark {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: clamp(2rem, 6vw, 7rem);
    padding-block: clamp(5rem, 12vh, 8rem);
  }
  .mark img {
    width: clamp(9rem, 18vw, 15rem);
    height: auto;
  }
  .sign {
    margin: 0;
    font-size: clamp(2.6rem, 7vw, 8rem);
  }
  .sign em {
    color: var(--leaf);
  }
  .legal {
    display: flex;
    justify-content: space-between;
    padding-block: 1.5rem 2rem;
    border-top: 1px solid var(--line);
    font-size: 0.85rem;
    color: var(--muted);
  }
  .legal a {
    text-decoration: none;
  }

  @media (max-width: 999px) {
    .info {
      grid-template-columns: 1fr 1fr;
    }
    .branches {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 640px) {
    .branches ul {
      grid-template-columns: 1fr;
    }
    .info,
    .mark {
      grid-template-columns: 1fr;
    }
    .legal {
      padding-bottom: 6rem; /* clear the floating order bar */
    }
  }
</style>
