<script lang="ts">
  import Nav from '$lib/components/Nav.svelte';
  import Hero from '$lib/components/Hero.svelte';
  import House from '$lib/components/House.svelte';
  import Signatures from '$lib/components/Signatures.svelte';
  import Kitchen from '$lib/components/Kitchen.svelte';
  import Bakery from '$lib/components/Bakery.svelte';
  import Order from '$lib/components/Order.svelte';
  import Visit from '$lib/components/Visit.svelte';
  import { photo, site, src } from '$lib/site';

  const title = `${site.name} — ${site.tagline}`;
  const description =
    'Nigerian kitchen and bakery since 2018. Party jollof, suya, small chops, fresh bread, pastries and celebration cakes — order for pickup or delivery.';
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <meta property="og:type" content="website" />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:image" content={src(photo.croissants, 1200)} />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="preload" as="image" href={src(photo.croissants, 2000)} fetchpriority="high" />
  {@html `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Bakery',
    name: site.name,
    foundingDate: String(site.established),
    servesCuisine: ['Nigerian', 'Bakery'],
    telephone: `+${site.whatsapp}`
  })}</script>`}
  <noscript>
    <style>
      .rv, .hero * { opacity: 1 !important; translate: none !important; clip-path: none !important; }
      .rv.lines > span > span { translate: none !important; }
    </style>
  </noscript>
</svelte:head>

<a class="skip" href="#menu">Skip to the menu</a>
<Nav />
<main>
  <Hero />
  <House />
  <Signatures />
  <Kitchen />
  <Bakery />
  <Order />
  <Visit />
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
