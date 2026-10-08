<!--
  GLS KITCHEN — the homepage film. One pinned track; scroll is the playhead.

  Physical first, digital second: we open in a working kitchen, a paper order
  drops into frame, the paper becomes a kitchen-display ticket, the display
  opens out to show every station, then collapses back to one ticket that rides
  along as the camera travels prep → rice → grill → the pass. Pull back: the
  whole kitchen as one strip, each station stamped with its time. Only the mark
  remains — the finale opens on that frame.

  Two coordinate systems: the WORLD (photos, moved by the camera) and the
  OVERLAY (the order, in viewport units, so the digital ticket can follow the
  physical camera). All UI is a still mockup. No JS / reduced motion = static.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { k, sample, ramp, hold, type Key } from './timeline';
  import { progress } from '$lib/motion';
  import { photo, src, srcset } from '$lib/site';

  type Shot = { id: string; img: string; label: string; time: string };
  const shots: Shot[] = [
    { id: 'in', img: photo.chefFlame, label: 'Order in', time: '19:42' },
    { id: 'prep', img: photo.chopping, label: 'Prep', time: '4:12' },
    { id: 'rice', img: photo.jollof, label: 'Rice', time: '9:30' },
    { id: 'grill', img: photo.suya, label: 'Grill', time: '14:05' },
    { id: 'pass', img: photo.spread, label: 'The pass', time: '16:05' }
  ];

  type Layout = {
    W: number;
    H: number;
    photo: { w: number; h: number };
    at: (i: number) => [number, number]; // world centre of shot i
    labelAt: (i: number) => [number, number];
    labelAlign: 'center' | 'left';
    labelPx: number;
    camera: Key[];
    order: Key[];
  };

  const wide: Layout = {
    W: 1600,
    H: 1000,
    photo: { w: 1500, h: 940 },
    at: (i) => [800 + i * 1600, 500],
    labelAt: (i) => [800 + i * 1600, 1090],
    labelAlign: 'center',
    labelPx: 82,
    camera: [
      k(0, 800, 470, 1.15), k(0.1, 800, 500, 1.5), k(0.4, 820, 500, 1.62),
      k(0.48, 2400, 470, 1.1), k(0.58, 2400, 480, 1.18), k(0.62, 4000, 470, 1.1), k(0.68, 4000, 480, 1.18),
      k(0.72, 5600, 470, 1.1), k(0.78, 5600, 480, 1.18), k(0.82, 7200, 470, 1.1), k(0.86, 7200, 480, 1.16),
      k(0.93, 4000, 600, 0.186), k(1, 4000, 600, 0.186)
    ],
    order: [
      k(0.095, 50, -45, 1.05), k(0.17, 50, 52), k(0.4, 50, 52), k(0.46, 80, 31, 0.62),
      k(0.86, 80, 31, 0.62), k(0.9, 80, 31, 0.55, 0)
    ]
  };
  const narrow: Layout = {
    W: 600,
    H: 1100,
    photo: { w: 600, h: 1300 },
    at: (i) => [300, 650 + i * 1400],
    labelAt: (i) => [640, 650 + i * 1400],
    labelAlign: 'left',
    labelPx: 150,
    camera: [
      k(0, 300, 650, 1), k(0.1, 300, 650, 1.3), k(0.4, 300, 640, 1.4),
      k(0.48, 300, 2050, 1), k(0.58, 300, 2060, 1.08), k(0.62, 300, 3450, 1), k(0.68, 300, 3460, 1.08),
      k(0.72, 300, 4850, 1), k(0.78, 300, 4860, 1.08), k(0.82, 300, 6250, 1), k(0.86, 300, 6260, 1.06),
      k(0.93, 700, 3900, 0.135), k(1, 700, 3900, 0.135)
    ],
    order: [
      k(0.095, 50, -45, 1), k(0.17, 50, 52), k(0.4, 50, 52), k(0.46, 50, 22, 0.5),
      k(0.86, 50, 22, 0.5), k(0.9, 50, 22, 0.45, 0)
    ]
  };

  // scrim over the photography: legible titles, dim during the display, clear at stations, ink at the end
  const scrim = [
    k(0, 0, 0, 1, 0.55), k(0.08, 0, 0, 1, 0.3), k(0.14, 0, 0, 1, 0.5), k(0.3, 0, 0, 1, 0.55),
    k(0.34, 0, 0, 1, 0.86), k(0.4, 0, 0, 1, 0.86), k(0.47, 0, 0, 1, 0.12), k(0.87, 0, 0, 1, 0.12),
    k(0.92, 0, 0, 1, 0.05), k(0.955, 0, 0, 1, 0.1), k(0.99, 0, 0, 1, 1)
  ];

  const captions = [
    { a: 0.11, b: 0.2, no: '01', tag: '19:42 · Table 6', line: 'An order comes in.' },
    { a: 0.2, b: 0.29, no: '02', tag: 'The ticket', line: 'Paper becomes a signal.' },
    { a: 0.29, b: 0.41, no: '03', tag: 'Kitchen display', line: 'Every station sees it at once.' },
    { a: 0.47, b: 0.59, no: '04', tag: 'Prep', line: 'Small chops, first out.' },
    { a: 0.6, b: 0.69, no: '05', tag: 'Rice', line: 'Two party jollof, right on time.' },
    { a: 0.7, b: 0.79, no: '06', tag: 'Grill', line: 'The grill knows it’s next.' },
    { a: 0.8, b: 0.87, no: '07', tag: 'The pass', line: 'Plated in sixteen minutes.' },
    { a: 0.89, b: 1.1, no: '08', tag: 'GLS Kitchen', line: 'One kitchen, perfectly in sync.' }
  ];
  const SUB = 'Orders · Stations · Timing · Stock · Payments';

  const items = [
    { q: 2, n: 'Party Jollof', st: 'Rice', done: 0.65 },
    { q: 1, n: 'Peppered Chicken', st: 'Grill', done: 0.75 },
    { q: 1, n: 'Small Chops', st: 'Prep', note: 'no pepper', done: 0.55 }
  ];
  // elapsed seconds keyed to scroll
  const clock: [number, number][] = [
    [0.3, 0], [0.55, 252], [0.65, 570], [0.75, 845], [0.82, 965]
  ];
  function elapsed(p: number) {
    if (p <= clock[0]![0]) return 0;
    for (let i = 1; i < clock.length; i++) {
      const [pb, sb] = clock[i]!;
      if (p <= pb) {
        const [pa, sa] = clock[i - 1]!;
        return sa + ((p - pa) / (pb - pa)) * (sb - sa);
      }
    }
    return clock[clock.length - 1]![1];
  }
  const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  let lay = $state<'wide' | 'narrow'>('wide');
  const L = $derived(lay === 'wide' ? wide : narrow);
  let live = $state(false);

  // resolved by default so the static render shows the finished ticket
  let pNow = $state(1);
  const secs = $derived(elapsed(pNow));
  const status = $derived(pNow < 0.44 ? 'New' : pNow < 0.62 ? 'Preparing' : pNow < 0.82 ? 'Cooking' : 'Ready');

  let track: HTMLElement;
  let pin: HTMLElement;
  let view: HTMLElement;
  let world: HTMLElement;
  let veil: HTMLElement;
  let order: HTMLElement;
  let heroL1: HTMLElement;
  let heroL2: HTMLElement;
  let heroRest: HTMLElement;
  let mark: HTMLElement;
  const capEls: HTMLElement[] = $state([]);

  let fit = 1;
  let vw = 1;
  let vh = 1;
  let last = 0;

  function apply(p: number) {
    last = p;
    if (!live) return;
    // at the very end the finale sits underneath on the identical frame: hand over
    pin.style.opacity = p >= 0.999 ? '0' : '1';
    pNow = p;
    const lo = L;
    const cam = sample(lo.camera, p);
    const s = fit * cam.s;
    world.style.transform = `translate3d(${vw / 2 - cam.x * s}px, ${vh / 2 - cam.y * s}px, 0) scale(${s})`;
    veil.style.opacity = sample(scrim, p).o.toFixed(3);

    // hero: the two words part and pass the camera as we push into the kitchen
    const h = ramp(p, 0, 0.09);
    heroL1.style.transform = `translate3d(0, ${-h * 32}vh, 0) scale(${1 + h * 0.7})`;
    heroL2.style.transform = `translate3d(0, ${h * 32}vh, 0) scale(${1 + h * 0.7})`;
    heroL1.style.opacity = heroL2.style.opacity = String(1 - ramp(p, 0.02, 0.09));
    heroRest.style.opacity = String(1 - ramp(p, 0, 0.035));
    heroRest.style.visibility = p > 0.04 ? 'hidden' : 'visible';

    const o = sample(lo.order, p);
    order.style.transform = `translate(${o.x}vw, ${o.y}vh) translate(-50%, -50%) scale(${o.s})`;
    order.style.opacity = p < 0.09 ? '0' : o.o.toFixed(3);

    const t = track.style;
    t.setProperty('--morph', ramp(p, 0.2, 0.26).toFixed(3));
    t.setProperty('--board', (ramp(p, 0.29, 0.345) - ramp(p, 0.39, 0.445)).toFixed(3));
    t.setProperty('--lab', ramp(p, 0.87, 0.92).toFixed(3));
    t.setProperty('--strip', (1 - ramp(p, 0.955, 0.985)).toFixed(3));

    const m = ramp(p, 0.95, 0.99);
    mark.style.opacity = m.toFixed(3);
    mark.style.transform = `translate(-50%, -50%) scale(${0.85 + m * 0.15})`;

    captions.forEach((c, i) => {
      const n = capEls[i];
      if (!n) return;
      const v = hold(p, c.a, c.b, 0.022);
      n.style.opacity = v.toFixed(3);
      n.style.transform = `translate3d(0, ${(1 - v) * 1.25}rem, 0)`;
      n.style.visibility = v <= 0 ? 'hidden' : 'visible';
    });
  }

  function measure() {
    lay = matchMedia('(max-width: 759px)').matches ? 'narrow' : 'wide';
    vw = view.clientWidth;
    vh = view.clientHeight;
    const lo = lay === 'wide' ? wide : narrow;
    fit = Math.min(vw / lo.W, vh / lo.H);
    const root = document.documentElement.style;
    root.setProperty('--mark-px', `${mark.offsetWidth}px`);
    root.setProperty('--mark-y', '50vh');
    requestAnimationFrame(() => apply(last));
  }

  onMount(() => {
    if (!document.documentElement.classList.contains('cine')) return;
    live = true;
    pNow = 0;
    requestAnimationFrame(measure);
    let tm = 0;
    const onResize = () => {
      clearTimeout(tm);
      tm = window.setTimeout(measure, 120);
    };
    addEventListener('resize', onResize, { passive: true });
    return () => removeEventListener('resize', onResize);
  });
</script>

<section class="track" class:live data-lay={lay} bind:this={track} use:progress={{ mode: 'pin', onChange: apply }} aria-labelledby="k-title">
  <span id="follow" class="anchor"></span>
  <div class="pin" bind:this={pin}>
    <div class="view" bind:this={view}>
      <div class="scene-in">
        <div class="world" bind:this={world}>
          {#each shots as s, i}
            {@const [x, y] = L.at(i)}
            {@const [lx, ly] = L.labelAt(i)}
            <figure
              class="shot"
              style:width="{L.photo.w}px"
              style:height="{L.photo.h}px"
              style:transform="translate({x}px, {y}px) translate(-50%, -50%)"
            >
              <img
                src={src(s.img, 1400)}
                srcset={srcset(s.img, [640, 960, 1400, 2000])}
                sizes="100vw"
                alt=""
                loading={i === 0 ? 'eager' : 'lazy'}
                fetchpriority={i === 0 ? 'high' : 'auto'}
              />
            </figure>
            <span
              class="stamp"
              class:left={L.labelAlign === 'left'}
              style:font-size="{L.labelPx}px"
              style:transform="translate({lx}px, {ly}px) translate({L.labelAlign === 'left' ? '0' : '-50%'}, -50%)"
              aria-hidden="true"><b></b>{s.label} <em>{s.time}</em></span
            >
          {/each}
        </div>
        <div class="veil" bind:this={veil}></div>
        <div class="grade"></div>
      </div>
    </div>

    <!-- the kitchen display, opening out of the ticket -->
    <div class="board" aria-hidden="true">
      <div class="bh"><span><img src="/favicon.png" alt="" /> GLS Kitchen · Display</span><span>19:42 · 9 open · avg 14 min</span></div>
      <div class="cols">
        <div class="col new">
          <h4>New <i>2</i></h4>
          <div class="mini"><b>#0219</b> Takeaway<span>1 × Suya · 2 × Zobo</span></div>
          <div class="mini"><b>#0220</b> Delivery<span>3 × Meat Pie</span></div>
        </div>
        <div class="col cook">
          <h4>Cooking <i>4</i></h4>
          <div class="slot"></div>
          <div class="mini"><b>#0214</b> Table 2<span>Ofada · 06:40</span></div>
        </div>
        <div class="col ready">
          <h4>Ready <i>3</i></h4>
          <div class="mini ok"><b>#0211</b> Table 9<span>✓ Plated · 12:02</span></div>
          <div class="mini ok"><b>#0212</b> Delivery<span>✓ Rider waiting</span></div>
        </div>
      </div>
    </div>

    <!-- the order: paper first, then the GLS ticket -->
    <div class="order" bind:this={order} aria-hidden="true">
      <div class="paper">
        <div class="pk">GLS KITCHEN</div>
        <div class="pn">ORDER #0217</div>
        <div class="pm">Table 6 · Dine-in · 19:42</div>
        <div class="pr"></div>
        {#each items as it}
          <div class="pi"><b>{it.q} ×</b> {it.n}{#if it.note}<i>{it.note}</i>{/if}</div>
        {/each}
        <div class="pr"></div>
        <div class="pm">From: Counter POS · Tunde</div>
      </div>
      <div class="kds" data-status={status}>
        <div class="kh">
          <span class="kt">#0217 <small>Table 6</small></span>
          <span class="chip">{status}</span>
        </div>
        <div class="clock"><span>{mmss(secs)}</span><small>target 18:00</small></div>
        <ul>
          {#each items as it}
            <li class:done={pNow >= it.done}>
              <span class="tick"></span>
              <span class="nm"><b>{it.q} ×</b> {it.n}{#if it.note}<i>{it.note}</i>{/if}</span>
              <span class="st">{it.st}</span>
            </li>
          {/each}
        </ul>
        <div class="bar"><i style:scale="{Math.min(1, secs / 1080)} 1"></i></div>
      </div>
    </div>

    <!-- opening titles -->
    <div class="hero">
      <h1 id="k-title" class="sr-only">GLS Kitchen — every order, from ticket to table.</h1>
      <div class="words" aria-hidden="true">
        <span class="w1" bind:this={heroL1}>GLS</span>
        <span class="w2" bind:this={heroL2}><em>Kitchen</em></span>
      </div>
      <div class="rest" bind:this={heroRest}>
        <p class="eyebrow e1">Orders · Stations · Timing</p>
        <p class="lede">Every order, from ticket to table. The kitchen system that keeps every station in step — even when the signal drops.</p>
        <div class="ctas">
          <a class="btn" href="#talk">Book a demo <span class="arrow">→</span></a>
          <a class="btn ghost" href="#follow">Follow an order <span class="arrow">↓</span></a>
        </div>
      </div>
    </div>

    <img class="mark" bind:this={mark} src="/favicon.png" alt="" aria-hidden="true" />

    <ol class="caps">
      {#each captions as c, i}
        <li bind:this={capEls[i]}>
          <span class="no">{c.no}</span><span class="eyebrow">{c.tag}</span>
          <span class="line display">{c.line}</span>
          {#if c.no === '08'}<span class="sub">{SUB}</span>{/if}
        </li>
      {/each}
    </ol>
    <div class="rule" aria-hidden="true"></div>
  </div>
</section>

<style>
  /* ---------------------------------------- static (no-JS / reduced motion) */
  .track {
    position: relative;
    background: var(--ink);
    color: var(--cream);
    --morph: 1;
    --lab: 1;
    --strip: 1;
  }
  .anchor {
    position: absolute;
    top: 0;
  }
  .hero {
    padding: 8rem var(--gutter) 3rem;
    max-width: var(--max);
    margin-inline: auto;
  }
  .words {
    display: flex;
    flex-direction: column;
    font-family: var(--serif);
    font-optical-sizing: auto;
    font-variation-settings: 'SOFT' 30, 'WONK' 0;
    font-weight: 360;
    font-size: clamp(5.5rem, 15vw, 15rem);
    line-height: 0.8;
    letter-spacing: -0.055em;
  }
  .words em {
    font-style: italic;
    font-weight: 300;
    font-variation-settings: 'SOFT' 100, 'WONK' 1;
    color: var(--lime);
  }
  .e1 {
    color: var(--lime);
    margin: 2rem 0 0.8rem;
  }
  .lede {
    max-width: 30rem;
    margin: 0 0 2rem;
    color: color-mix(in oklab, var(--cream) 82%, transparent);
  }
  .ctas {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
  }
  .world {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
    gap: 1rem;
    padding: 0 var(--gutter) 3rem;
    max-width: var(--max);
    margin-inline: auto;
  }
  .shot {
    margin: 0;
  }
  .track:not(.live) .shot {
    width: auto !important;
    height: auto !important;
    transform: none !important;
    aspect-ratio: 3 / 2;
  }
  .shot img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .track:not(.live) .stamp {
    display: none;
  }
  .veil,
  .grade,
  .board,
  .mark,
  .rule,
  .paper {
    display: none;
  }
  .order {
    max-width: 22rem;
    margin: 0 auto 4rem;
  }
  .caps {
    list-style: none;
    margin: 0 auto;
    padding: 0 var(--gutter) 6rem;
    max-width: var(--max);
    display: grid;
    gap: 2.2rem;
  }
  .caps li {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 1rem;
    align-items: baseline;
  }
  .no {
    font-family: var(--serif);
    font-style: italic;
    font-weight: 300;
    color: var(--lime);
    font-size: 1.1rem;
  }
  .caps .eyebrow {
    color: color-mix(in oklab, var(--cream) 70%, transparent);
  }
  .line {
    grid-column: 1 / -1;
    margin-top: 0.6rem;
    font-size: clamp(2rem, 4vw, 4rem);
    line-height: 0.98;
  }
  .sub {
    display: block;
    grid-column: 1 / -1;
    margin-top: 1rem;
    font-size: 0.82rem;
    font-weight: 600;
    font-stretch: 110%;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--lime);
  }

  /* --------------------------------------------------------- the order */
  .paper {
    padding: 20px 22px 30px;
    background: #fbfaf6;
    color: #1d1d1b;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 14px;
    line-height: 1.6;
    mask: conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) 50% / 14px 100%;
    box-shadow: 0 30px 60px -20px rgb(0 0 0 / 0.7);
  }
  .pk {
    text-align: center;
    font-weight: 700;
    letter-spacing: 0.2em;
  }
  .pn {
    margin-top: 4px;
    text-align: center;
    font-size: 22px;
    font-weight: 700;
  }
  .pm {
    text-align: center;
    color: #555;
    font-size: 12px;
  }
  .pr {
    margin: 12px 0;
    border-top: 1px dashed #999;
  }
  .pi {
    font-size: 16px;
  }
  .pi i,
  .nm i {
    display: block;
    padding-left: 2.2em;
    font-style: normal;
    font-size: 0.8em;
    color: #777;
  }

  .kds {
    background: #1b2015;
    color: var(--cream);
    border-radius: 8px;
    padding: 18px 20px 20px;
    font-family: var(--sans);
    box-shadow:
      inset 0 0 0 1px rgb(255 255 255 / 0.07),
      0 30px 60px -20px rgb(0 0 0 / 0.75);
  }
  .kh {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .kt {
    font-family: var(--serif);
    font-size: 26px;
    font-weight: 400;
    letter-spacing: -0.02em;
  }
  .kt small {
    font-family: var(--sans);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    margin-left: 6px;
    opacity: 0.7;
  }
  .chip {
    padding: 5px 10px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    background: rgb(255 255 255 / 0.1);
    transition: background-color 0.4s, color 0.4s;
  }
  [data-status='Preparing'] .chip,
  [data-status='Cooking'] .chip {
    background: var(--crust);
    color: #fff;
  }
  [data-status='Ready'] .chip {
    background: var(--lime);
    color: var(--ink);
  }
  .clock {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin: 12px 0 10px;
  }
  .clock span {
    font-size: 44px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
  }
  .clock small {
    font-size: 12px;
    opacity: 0.6;
  }
  .kds ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .kds li {
    display: grid;
    grid-template-columns: 18px 1fr auto;
    gap: 10px;
    align-items: start;
    padding: 9px 0;
    border-top: 1px solid rgb(255 255 255 / 0.08);
    font-size: 15px;
    transition: opacity 0.4s;
  }
  .tick {
    width: 16px;
    height: 16px;
    margin-top: 2px;
    border: 1.5px solid rgb(255 255 255 / 0.4);
    border-radius: 50%;
    transition: background-color 0.35s, border-color 0.35s;
  }
  .done .tick {
    background: var(--lime);
    border-color: var(--lime);
    box-shadow: inset 0 0 0 3px #1b2015;
  }
  .done .nm {
    opacity: 0.55;
  }
  .nm i {
    color: rgb(255 255 255 / 0.5);
  }
  .st {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    opacity: 0.55;
    padding-top: 4px;
  }
  .bar {
    height: 3px;
    margin-top: 12px;
    background: rgb(255 255 255 / 0.1);
  }
  .bar i {
    display: block;
    height: 100%;
    background: var(--lime);
    transform-origin: left;
  }

  /* ================================================================ LIVE */
  .live {
    height: 1000vh;
    z-index: 1;
    background: transparent;
    --morph: 0;
    --board: 0;
    --lab: 0;
  }
  .live .anchor {
    top: 13%;
  }
  .live .pin {
    position: sticky;
    top: 0;
    height: 100vh;
    height: 100svh;
    overflow: hidden;
    background: var(--ink);
  }
  .live .view,
  .live .scene-in {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .live .world {
    display: block;
    position: absolute;
    left: 0;
    top: 0;
    padding: 0;
    max-width: none;
    transform-origin: 0 0;
    opacity: var(--strip);
  }
  .live .shot {
    position: absolute;
    left: 0;
    top: 0;
    overflow: hidden;
    background: #0d0f0a;
  }
  .stamp {
    position: absolute;
    left: 0;
    top: 0;
    display: flex;
    align-items: center;
    gap: 0.35em;
    white-space: nowrap;
    font-family: var(--sans);
    font-weight: 600;
    font-stretch: 112%;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--cream);
    opacity: var(--lab);
  }
  .stamp b {
    width: 0.5em;
    height: 0.5em;
    border-radius: 50%;
    background: var(--lime);
  }
  .stamp em {
    font-style: normal;
    color: var(--lime);
    font-variant-numeric: tabular-nums;
  }
  .live .veil {
    display: block;
    position: absolute;
    inset: 0;
    background: var(--ink);
    pointer-events: none;
  }
  .live .grade {
    display: block;
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(130% 95% at 50% 45%, transparent 55%, rgb(10 12 8 / 0.6)),
      linear-gradient(rgb(10 12 8 / 0.35), transparent 22%, transparent 70%, rgb(10 12 8 / 0.45));
  }

  /* the order card lives in viewport space */
  .live .order {
    position: absolute;
    left: 0;
    top: 0;
    width: 320px;
    max-width: none;
    margin: 0;
    z-index: 3;
  }
  .live .paper {
    display: block;
    opacity: calc(1 - var(--morph));
    scale: calc(1 - var(--morph) * 0.04);
  }
  .live .kds {
    position: absolute;
    inset: 0 0 auto;
    opacity: var(--morph);
    scale: calc(0.96 + var(--morph) * 0.04);
  }

  .live .board {
    --ix: calc((min(1120px, 94vw) - 320px) / 2);
    --iy: calc((min(640px, 80vh) - 400px) / 2);
    display: flex;
    flex-direction: column;
    position: absolute;
    left: 50%;
    top: 52%;
    width: min(1120px, 94vw);
    height: min(640px, 80vh);
    translate: -50% -50%;
    background: #12160d;
    border-radius: 10px;
    box-shadow:
      inset 0 0 0 1px rgb(255 255 255 / 0.07),
      0 40px 90px -30px rgb(0 0 0 / 0.8);
    clip-path: inset(calc((1 - var(--board)) * var(--iy)) calc((1 - var(--board)) * var(--ix)) round 10px);
    opacity: min(1, calc(var(--board) * 3));
    z-index: 2;
    font-family: var(--sans);
  }
  .bh {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 20px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgb(255 255 255 / 0.7);
    border-bottom: 1px solid rgb(255 255 255 / 0.07);
    opacity: var(--board);
  }
  .bh span:first-child {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--cream);
  }
  .bh img {
    width: 18px;
  }
  .cols {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 360px 1fr;
    gap: 18px;
    padding: 16px 20px;
    opacity: var(--board);
  }
  .col h4 {
    margin: 0 0 12px;
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: rgb(255 255 255 / 0.6);
  }
  .col h4 i {
    font-style: normal;
    padding: 2px 7px;
    background: rgb(255 255 255 / 0.1);
    color: var(--cream);
  }
  .cook h4 {
    justify-content: center;
  }
  .slot {
    height: 400px;
    max-height: calc(100% - 110px);
  }
  .mini {
    margin-bottom: 10px;
    padding: 12px 14px;
    background: #1b2015;
    border-radius: 6px;
    color: var(--cream);
    font-size: 13px;
  }
  .mini b {
    font-family: var(--serif);
    font-weight: 400;
    font-size: 17px;
    margin-right: 6px;
  }
  .mini span {
    display: block;
    margin-top: 4px;
    font-size: 12px;
    color: rgb(255 255 255 / 0.55);
  }
  .mini.ok {
    box-shadow: inset 3px 0 0 var(--lime);
  }
  .mini.ok span {
    color: var(--lime);
  }

  .live .mark {
    display: block;
    position: absolute;
    left: 50%;
    top: 50%;
    width: 150px;
    opacity: 0;
    z-index: 2;
  }

  /* hero */
  .live .hero {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding: 4.5rem var(--gutter) 2rem;
    text-align: center;
    pointer-events: none;
    z-index: 4;
    max-width: none;
  }
  .live .hero a {
    pointer-events: auto;
  }
  .live .words {
    align-items: center;
    font-size: clamp(6rem, 15.5vw, 15.5rem);
  }
  .live .words > span {
    display: block;
    transform-origin: 50% 50%;
  }
  .live .rest {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .live .ctas {
    justify-content: center;
  }

  /* captions */
  .live .caps {
    position: absolute;
    inset: auto 0 0;
    display: block;
    padding: 0;
    pointer-events: none;
    z-index: 5;
  }
  .live .caps li {
    position: absolute;
    left: var(--gutter);
    bottom: 2.4rem;
    max-width: min(36rem, 60vw);
    padding: 1.1rem 1.5rem 1.3rem;
    background: color-mix(in oklab, var(--ink) 90%, transparent);
    box-shadow: inset 3px 0 0 var(--lime);
    opacity: 0;
    visibility: hidden;
  }
  .live .line {
    font-size: clamp(2rem, 3.6vw, 3.6rem);
  }
  .live .caps li:last-child {
    left: 0;
    right: 0;
    bottom: 2.2rem;
    max-width: none;
    background: transparent;
    box-shadow: none;
    text-align: center;
    display: block;
  }
  .live .caps li:last-child .no,
  .live .caps li:last-child .eyebrow {
    display: none;
  }
  .live .caps li:last-child .line {
    font-size: clamp(2rem, 3.6vw, 3.4rem);
  }
  .live .rule {
    display: block;
    position: absolute;
    inset: auto 0 0;
    height: 2px;
    background: var(--lime);
    transform-origin: left;
    scale: var(--p, 0) 1;
    z-index: 5;
  }

  /* opening: the frame opens like a letterbox lifting, then the titles rise */
  :global(html.cine) .scene-in {
    animation: lid 1.9s var(--ease) 0.1s both;
  }
  :global(html.cine) .world {
    animation: bloom 2.8s var(--ease) 0.1s both;
  }
  @keyframes lid {
    from {
      clip-path: inset(44% 0 44% 0);
    }
    to {
      clip-path: inset(0 0 0 0);
    }
  }
  @keyframes bloom {
    from {
      filter: brightness(0.35);
    }
    to {
      filter: none;
    }
  }
  :global(html.cine) .words > span > *,
  :global(html.cine) .w1,
  :global(html.cine) .e1,
  :global(html.cine) .lede,
  :global(html.cine) .ctas {
    animation: rise 1.4s var(--ease) both;
  }
  :global(html.cine) .w1 {
    animation-delay: 0.55s;
  }
  :global(html.cine) .words > span > * {
    display: inline-block;
    animation-delay: 0.72s;
  }
  :global(html.cine) .e1 {
    animation-delay: 1.1s;
  }
  :global(html.cine) .lede {
    animation-delay: 1.22s;
  }
  :global(html.cine) .ctas {
    animation-delay: 1.4s;
  }
  @keyframes rise {
    from {
      opacity: 0;
      translate: 0 2rem;
    }
  }

  /* ------------------------------------------------------------- narrow */
  @media (max-width: 759px) {
    .live {
      height: 1100vh;
    }
    .live .words {
      font-size: clamp(5rem, 27vw, 7.5rem);
    }
    .live .lede {
      font-size: 0.98rem;
      max-width: 22rem;
    }
    .live .ctas .ghost {
      display: none;
    }
    .live .order {
      width: 300px;
    }
    .live .board {
      --ix: calc((94vw - 300px) / 2);
      --iy: calc((84vh - 400px) / 2);
      width: 94vw;
      height: 84vh;
      top: 51%;
    }
    .bh span:last-child {
      display: none;
    }
    .cols {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr auto;
      gap: 10px;
      padding: 10px 12px;
    }
    .col.ready {
      order: -1;
    }
    .col.new {
      order: 1;
    }
    .col.ready,
    .col.new {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      align-content: start;
    }
    .col.ready h4,
    .col.new h4 {
      grid-column: 1 / -1;
      margin: 0;
    }
    .col.cook h4,
    .col.cook .mini {
      display: none;
    }
    .mini {
      margin: 0;
      padding: 9px 10px;
      font-size: 11px;
    }
    .mini b {
      font-size: 14px;
    }
    .mini span {
      font-size: 10.5px;
    }
    .slot {
      height: 100%;
      max-height: none;
    }
    .live .mark {
      width: 120px;
    }
    .live .caps li {
      left: var(--gutter);
      right: var(--gutter);
      bottom: 1.6rem;
      max-width: none;
      padding: 0.95rem 1.1rem 1.05rem;
    }
    .live .line {
      font-size: clamp(1.65rem, 7.4vw, 2.1rem);
    }
    .live .caps li:last-child {
      left: 0;
      right: 0;
      padding: 0 var(--gutter);
    }
    .live .caps li:last-child .line {
      font-size: clamp(1.8rem, 8.4vw, 2.3rem);
    }
    .sub {
      font-size: 0.66rem;
      line-height: 1.7;
    }
  }
</style>
