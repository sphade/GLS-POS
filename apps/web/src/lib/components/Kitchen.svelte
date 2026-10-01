<script lang="ts">
  import { progress, reveal } from '$lib/motion';
  import { photo, src, srcset } from '$lib/site';

  const steps = [
    {
      t: 'Market, early',
      b: 'Peppers, tomatoes, fish and greens come in fresh every day. If it isn’t right, it doesn’t come in.'
    },
    {
      t: 'Slow over heat',
      b: 'Stews are fried down until the oil rises. Jollof takes its smoke from the base of the pot. Nothing here is hurried.'
    },
    {
      t: 'Finished to order',
      b: 'Every plate and pack is portioned when you order, so it reaches you the way it left the stove.'
    }
  ];
</script>

<section id="kitchen" class="kitchen" use:progress aria-labelledby="kitchen-title">
  <div class="wrap grid">
    <div class="visual">
      <figure class="main">
        <img
          src={src(photo.chefFlame, 1400)}
          srcset={srcset(photo.chefFlame)}
          sizes="(min-width: 900px) 50vw, 100vw"
          alt="A chef working over flames in a professional kitchen"
          loading="lazy"
          decoding="async"
        />
      </figure>
      <figure class="inset rv mask" use:reveal={{ delay: 200 }}>
        <img
          src={src(photo.chopping, 800)}
          srcset={srcset(photo.chopping, [480, 800, 1200])}
          sizes="(min-width: 900px) 22vw, 50vw"
          alt="Hands slicing fresh vegetables on a board"
          loading="lazy"
          decoding="async"
        />
      </figure>
    </div>

    <div class="copy">
      <p class="chapter-no" use:reveal>03</p>
      <p class="eyebrow tag" use:reveal={{ delay: 80 }}>The Kitchen</p>
      <h2 id="kitchen-title" class="display rv lines" use:reveal={{ delay: 120 }}>
        <span><span>Cooked the</span></span>
        <span><span><em>long</em> way.</span></span>
      </h2>

      <ol class="steps">
        {#each steps as s, i}
          <li use:reveal={{ threshold: 0.5 }}>
            <span class="n">{String(i + 1).padStart(2, '0')}</span>
            <div>
              <h3>{s.t}</h3>
              <p>{s.b}</p>
            </div>
          </li>
        {/each}
      </ol>
    </div>
  </div>
</section>

<style>
  .kitchen {
    --p: 0;
    position: relative;
    background: var(--ink);
    color: var(--cream);
    padding-block: clamp(6rem, 14vh, 10rem);
  }
  .grid {
    display: grid;
    grid-template-columns: 1.05fr 1fr;
    gap: clamp(3rem, 7vw, 8rem);
  }

  .visual {
    position: sticky;
    top: 6vh;
    height: 88vh;
    align-self: start;
  }
  .main {
    position: absolute;
    inset: 0 12% 0 0;
    margin: 0;
    overflow: clip;
    /* the frame opens as the chapter scrolls through */
    clip-path: inset(
      calc(clamp(0, (0.3 - var(--p)) * 3, 1) * 22%)
        calc(clamp(0, (0.3 - var(--p)) * 3, 1) * 18%) round 0
    );
  }
  .main img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    scale: calc(1.25 - var(--p) * 0.25);
    filter: saturate(0.95) contrast(1.05);
  }
  .inset {
    position: absolute;
    right: 0;
    bottom: -4vh;
    width: 42%;
    aspect-ratio: 3 / 4;
    margin: 0;
    overflow: clip;
    box-shadow: 0 0 0 0.6rem var(--ink);
    translate: 0 calc((0.5 - var(--p)) * 30vh);
  }
  .inset img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .copy {
    padding-top: 18vh;
  }
  .chapter-no {
    margin: 0;
    font-size: clamp(3rem, 6vw, 5.5rem);
    line-height: 0.8;
    color: var(--lime);
  }
  .tag {
    margin: 1rem 0 1.5rem;
    color: color-mix(in oklab, var(--cream) 60%, transparent);
  }
  h2 {
    margin: 0;
    font-size: clamp(3rem, 6.4vw, 7rem);
  }
  h2 em {
    color: var(--lime);
  }

  .steps {
    margin: clamp(5rem, 16vh, 10rem) 0 0;
    padding: 0;
    list-style: none;
  }
  .steps li {
    display: grid;
    grid-template-columns: 4rem 1fr;
    gap: 1rem;
    padding-block: 2.4rem 32vh;
    border-top: 1px solid color-mix(in oklab, var(--cream) 16%, transparent);
  }
  .steps li:last-child {
    padding-bottom: 6vh;
  }
  .n {
    font-family: var(--serif);
    font-style: italic;
    font-size: 1.15rem;
    color: var(--lime);
  }
  .steps h3 {
    margin: 0 0 0.75rem;
    font-family: var(--serif);
    font-weight: 380;
    font-size: clamp(1.8rem, 2.6vw, 2.6rem);
    letter-spacing: -0.025em;
    line-height: 1;
  }
  .steps p {
    margin: 0;
    max-width: 26rem;
    color: color-mix(in oklab, var(--cream) 70%, transparent);
  }

  @media (max-width: 899px) {
    .grid {
      grid-template-columns: 1fr;
    }
    .visual {
      position: relative;
      top: 0;
      height: 70vh;
      order: 2;
    }
    .copy {
      padding-top: 0;
    }
    .steps {
      margin-top: 3rem;
    }
    .steps li {
      padding-block: 1.75rem;
    }
  }
</style>
