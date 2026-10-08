<script lang="ts">
  import FilmNav from '$lib/film/FilmNav.svelte';
  import Stage from '$lib/film/Stage.svelte';
  import Finale from '$lib/film/Finale.svelte';
  import { photo, src } from '$lib/site';

  const title = 'GLS — the system behind the counter';
  const description =
    'GLS runs the whole business from one connected system: point of sale, stock, kitchen tickets, payments and reports. Works offline, on the phones and tablets you already own.';
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <meta property="og:type" content="website" />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:image" content={src(photo.bakeryShelf, 1200)} />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="preload" as="image" href={src(photo.bakeryShelf, 1600)} fetchpriority="high" />
</svelte:head>

<div id="top"></div>
<a class="skip" href="#talk">Skip to booking a demo</a>
<FilmNav />
<main>
  <Stage />
  <Finale />
</main>

<style>
  .skip {
    position: fixed;
    top: 0.75rem;
    left: 0.75rem;
    z-index: 100;
    padding: 0.75rem 1rem;
    background: var(--lime);
    color: var(--ink);
    translate: 0 -200%;
  }
  .skip:focus {
    translate: 0 0;
  }
</style>
