<script lang="ts">
  import FilmNav from '$lib/film/FilmNav.svelte';
  import KitchenFilm from '$lib/film/KitchenFilm.svelte';
  import Finale from '$lib/film/Finale.svelte';
  import { photo, site, src } from '$lib/site';

  const title = 'GLS Kitchen — every order, from ticket to table';
  const description =
    'GLS Kitchen moves every order from the counter to the pass: kitchen tickets, station timing and order status in one connected system that keeps working offline.';

  // PLACEHOLDER contact — same inbox as the rest of the site.
  const demo = `mailto:${site.email}?subject=${encodeURIComponent('GLS Kitchen demo')}&body=${encodeURIComponent(
    'Restaurant name:\nNumber of kitchen stations:\nOrders on a busy night:\nBest time to call:'
  )}`;
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <meta property="og:type" content="website" />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:image" content={src(photo.chefFlame, 1200)} />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="preload" as="image" href={src(photo.chefFlame, 1400)} fetchpriority="high" />
</svelte:head>

<div id="top"></div>
<a class="skip" href="#talk">Skip to booking a demo</a>
<FilmNav
  brand="GLS Kitchen"
  links={[
    { href: '#follow', label: 'Follow an order' },
    { href: '/pos', label: 'GLS POS' },
    { href: '/', label: 'Order food' }
  ]}
/>
<main>
  <KitchenFilm />
  <Finale
    oldLine="One kitchen, perfectly in sync."
    oldSub="Orders · Stations · Timing · Stock · Payments"
    eyebrow="For restaurants, bakeries & busy kitchens"
    l1="Run every service"
    l2="GLS Kitchen."
    body="Kitchen tickets, station timing and order status on the screens you already have. We’ll set it up on your line and run your first service with you."
    primary={{ label: 'Book a demo', href: demo }}
    secondary={{ label: 'Explore GLS POS', href: '/pos' }}
    proof={{ label: 'Hungry? Order from GLS Kitchen & Bakery', href: '/' }}
  />
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
