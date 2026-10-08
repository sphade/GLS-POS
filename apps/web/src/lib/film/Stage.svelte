<!--
  THE FILM. One pinned track, one camera.

  Hero → push into the counter terminal until its screen fills the frame →
  one tap sells a meat pie → camera pulls back and the software unfolds
  (stock, kitchen ticket, payment, reports) → the sale travels through each →
  everything converges around the GLS mark. Scroll is the playhead, so going
  back up rewinds the shot.

  Everything inside .world is a still mockup (aria-hidden); the story is
  carried for screen readers by the captions.

  Without JS, or with prefers-reduced-motion, html lacks `.cine` and this
  renders as a calm static sequence instead.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import PosScreen from './PosScreen.svelte';
  import { k, sample, ramp, hold, type Key } from './timeline';
  import { progress } from '$lib/motion';
  import { photo, src, srcset } from '$lib/site';

  type Id = 'photo' | 'counter' | 'device' | 'inv' | 'kot' | 'pay' | 'ana' | 'token' | 'mark';
  type Box = { w: number; h: number };
  type Layout = {
    W: number;
    H: number;
    anchor: number;
    clip: [number[], number[]];
    label: number;
    geo: Record<Id, Box>;
    tracks: Record<Id, Key[]>;
    camera: Key[];
  };

  // World units are px of an imaginary set. Wide = counter tablet, narrow = phone.
  const wide: Layout = {
    W: 1600,
    H: 1000,
    anchor: 0.5,
    clip: [
      [9, 4, 9, 47],
      [0, 0, 0, 0]
    ],
    label: 28,
    geo: {
      photo: { w: 2400, h: 1300 },
      counter: { w: 3400, h: 720 },
      device: { w: 428, h: 288 },
      inv: { w: 280, h: 320 },
      kot: { w: 230, h: 300 },
      pay: { w: 300, h: 200 },
      ana: { w: 320, h: 250 },
      token: { w: 150, h: 44 },
      mark: { w: 200, h: 200 }
    },
    tracks: {
      photo: [k(0, 800, 330), k(0.34, 800, 330), k(0.42, 800, 330, 1, 0.3), k(0.82, 800, 330, 1, 0.3), k(0.95, 800, 330, 1, 0)],
      counter: [k(0, 800, 1040), k(0.34, 800, 1040), k(0.42, 800, 1040, 1, 0.45), k(0.82, 800, 1040, 1, 0.45), k(0.92, 800, 1040, 1, 0)],
      device: [k(0, 800, 520), k(0.82, 800, 520), k(0.93, 800, 262, 0.5)],
      ana: [k(0.35, 420, 320, 0.94, 0), k(0.41, 420, 300), k(0.82, 420, 300), k(0.93, 432, 440, 0.5)],
      inv: [k(0.36, 1180, 350, 0.94, 0), k(0.42, 1180, 330), k(0.82, 1180, 330), k(0.93, 1168, 440, 0.5)],
      kot: [k(0.37, 1170, 810, 0.94, 0), k(0.43, 1170, 790), k(0.82, 1170, 790), k(0.93, 1020, 735, 0.5)],
      pay: [k(0.38, 420, 800, 0.94, 0), k(0.44, 420, 780), k(0.82, 420, 780), k(0.93, 580, 735, 0.5)],
      token: [
        k(0.37, 860, 600, 0.6, 0), k(0.4, 860, 600), k(0.46, 1180, 300), k(0.49, 1180, 300),
        k(0.54, 1170, 700), k(0.57, 1170, 700), k(0.62, 420, 740), k(0.65, 420, 740),
        k(0.7, 420, 210), k(0.74, 420, 210, 0.6, 0)
      ],
      mark: [k(0.84, 800, 520, 0.7, 0), k(0.93, 800, 520)]
    },
    camera: [
      k(0, 640, 500, 1), k(0.08, 800, 510, 1.15), k(0.22, 800, 520, 3.6), k(0.32, 800, 520, 3.6),
      k(0.4, 800, 545, 1.15), k(0.46, 1000, 500, 1.3), k(0.49, 1000, 510, 1.3), k(0.54, 1000, 620, 1.3),
      k(0.57, 990, 620, 1.3), k(0.62, 600, 620, 1.3), k(0.65, 600, 610, 1.3), k(0.72, 600, 450, 1.3),
      k(0.79, 600, 450, 1.3), k(0.87, 800, 540, 1.1), k(0.94, 800, 520, 1), k(1, 800, 520, 1)
    ]
  };

  const ringN = (i: number) => {
    // five stations on a ring around the narrow mark
    const a = (-90 + i * 72) * (Math.PI / 180);
    return [300 + Math.cos(a) * 225, 1540 + Math.sin(a) * 240] as const;
  };
  const r = [0, 1, 2, 3, 4].map(ringN);
  const narrow: Layout = {
    W: 600,
    H: 1100,
    anchor: 0.6,
    clip: [
      [50, 5, 3, 5],
      [0, 0, 0, 0]
    ],
    label: 48,
    geo: {
      photo: { w: 1500, h: 1300 },
      counter: { w: 1800, h: 800 },
      device: { w: 200, h: 400 },
      inv: { w: 280, h: 300 },
      kot: { w: 240, h: 300 },
      pay: { w: 280, h: 200 },
      ana: { w: 300, h: 260 },
      token: { w: 150, h: 44 },
      mark: { w: 190, h: 190 }
    },
    tracks: {
      photo: [k(0, 300, 330), k(0.36, 300, 330), k(0.44, 300, 330, 1, 0)],
      counter: [k(0, 300, 1180), k(0.36, 300, 1180), k(0.44, 300, 1180, 1, 0)],
      device: [k(0, 300, 560), k(0.8, 300, 560), k(0.92, r[0]![0], r[0]![1], 0.42)],
      inv: [k(0.4, 300, 1020, 0.94, 0), k(0.44, 300, 1000), k(0.8, 300, 1000), k(0.92, r[1]![0], r[1]![1], 0.38)],
      kot: [k(0.48, 300, 1420, 0.94, 0), k(0.52, 300, 1400), k(0.8, 300, 1400), k(0.92, r[2]![0], r[2]![1], 0.38)],
      pay: [k(0.56, 300, 1780, 0.94, 0), k(0.6, 300, 1760), k(0.8, 300, 1760), k(0.92, r[3]![0], r[3]![1], 0.38)],
      ana: [k(0.64, 300, 2140, 0.94, 0), k(0.68, 300, 2120), k(0.8, 300, 2120), k(0.92, r[4]![0], r[4]![1], 0.38)],
      token: [
        k(0.37, 300, 680, 0.6, 0), k(0.4, 300, 700), k(0.46, 300, 870), k(0.49, 300, 870),
        k(0.54, 300, 1270), k(0.57, 300, 1270), k(0.62, 300, 1680), k(0.65, 300, 1680),
        k(0.7, 300, 2010), k(0.74, 300, 2010, 0.6, 0)
      ],
      mark: [k(0.84, 300, 1540, 0.7, 0), k(0.93, 300, 1540)]
    },
    camera: [
      k(0, 300, 430, 1), k(0.08, 300, 540, 1.15), k(0.22, 300, 560, 2.5), k(0.32, 300, 560, 2.5),
      k(0.4, 300, 760, 1.1), k(0.46, 300, 1000, 1.7), k(0.49, 300, 1000, 1.7), k(0.54, 300, 1400, 1.7),
      k(0.57, 300, 1400, 1.7), k(0.62, 300, 1760, 1.7), k(0.65, 300, 1760, 1.7), k(0.72, 300, 2110, 1.6),
      k(0.79, 300, 2110, 1.6), k(0.86, 300, 1640, 0.95), k(0.94, 300, 1540, 1.08), k(1, 300, 1540, 1.08)
    ]
  };

  // Final beat: the stations dissolve and only the mark is left — the exact
  // frame the finale opens on.
  for (const lo of [wide, narrow]) {
    for (const id of ['device', 'inv', 'kot', 'pay', 'ana'] as const) {
      const end = lo.tracks[id][lo.tracks[id].length - 1]!;
      lo.tracks[id].push(k(0.955, end.x, end.y, end.s), k(0.995, end.x, end.y, end.s * 0.9, 0));
    }
  }

  const captions = [
    { a: 0.12, b: 0.26, no: '01', tag: 'The counter', line: 'Every sale starts here.' },
    { a: 0.26, b: 0.37, no: '02', tag: 'Sell', line: 'One tap. One meat pie. ₦1,000.' },
    { a: 0.41, b: 0.5, no: '03', tag: 'Stock', line: 'The shelf already knows.' },
    { a: 0.5, b: 0.58, no: '04', tag: 'Kitchen', line: 'The kitchen hears it.' },
    { a: 0.58, b: 0.66, no: '05', tag: 'Payments', line: 'Paid, and counted to the kobo.' },
    { a: 0.67, b: 0.8, no: '06', tag: 'Reports', line: 'Every naira adds up.' },
    { a: 0.85, b: 1.1, no: '07', tag: 'GLS', line: 'One connected system.' }
  ];

  const bars = [0.18, 0.3, 0.55, 0.92, 0.7, 0.42, 0.38, 0.5, 0.78, 1, 0.84, 0.46];
  const hours = ['8', '', '10', '', '12', '', '14', '', '16', '', '18', ''];

  let lay = $state<'wide' | 'narrow'>('wide');
  const L = $derived(lay === 'wide' ? wide : narrow);
  let live = $state(false);

  // story beats — start resolved so the static (reduced / no-JS) render tells the whole story
  let tapped = $state(true);
  let sold = $state(true);
  let paid = $state(true);
  let net = $state(184_300);

  let track: HTMLElement;
  let pin: HTMLElement;
  let view: HTMLElement;
  let world: HTMLElement;
  let heroText: HTMLElement;
  const el: Partial<Record<Id, HTMLElement>> = {};
  const capEls: HTMLElement[] = $state([]);

  let fit = 1;
  let vw = 1;
  let vh = 1;
  let last = 0;

  function apply(p: number) {
    last = p;
    if (!live) return;
    pin.style.opacity = p >= 0.999 ? '0' : '1';
    const lo = L;
    const cam = sample(lo.camera, p);
    const s = fit * cam.s;
    world.style.transform = `translate3d(${vw / 2 - cam.x * s}px, ${vh * lo.anchor - cam.y * s}px, 0) scale(${s})`;

    for (const id of Object.keys(lo.tracks) as Id[]) {
      const node = el[id];
      if (!node) continue;
      const t = sample(lo.tracks[id], p);
      node.style.transform = `translate(${t.x}px, ${t.y}px) translate(-50%, -50%) scale(${t.s})`;
      node.style.opacity = t.o.toFixed(3);
    }

    // hero: the scene opens from its frame to full-bleed while the type exits
    const c = ramp(p, 0, 0.09);
    const [from, to] = lo.clip;
    const ins = from.map((v, i) => v + (to[i]! - v) * c);
    view.style.clipPath = `inset(${ins[0]}% ${ins[1]}% ${ins[2]}% ${ins[3]}%)`;
    const h = ramp(p, 0, 0.065);
    heroText.style.opacity = String(1 - h);
    heroText.style.transform = `translate3d(0, ${-h * 7}vh, 0)`;
    heroText.style.visibility = h >= 1 ? 'hidden' : 'visible';

    captions.forEach((cap, i) => {
      const n = capEls[i];
      if (!n) return;
      const o = hold(p, cap.a, cap.b, 0.022);
      n.style.opacity = o.toFixed(3);
      n.style.transform = `translate3d(0, ${(1 - o) * 1.25}rem, 0)`;
      n.style.visibility = o <= 0 ? 'hidden' : 'visible';
    });

    tapped = p >= 0.27;
    sold = p >= 0.46;
    paid = p >= 0.62;
    const b = ramp(p, 0.68, 0.8);
    net = Math.round((183_300 * b + (sold ? 1_000 : 0)) / 100) * 100;
    track.style.setProperty('--print', ramp(p, 0.53, 0.575).toFixed(3));
    track.style.setProperty('--bars', b.toFixed(3));
    track.style.setProperty('--ring', ramp(p, 0.88, 0.95).toFixed(3));
  }

  function measure() {
    lay = matchMedia('(max-width: 759px)').matches ? 'narrow' : 'wide';
    vw = view.clientWidth;
    vh = view.clientHeight;
    const lo = lay === 'wide' ? wide : narrow;
    fit = Math.min(vw / lo.W, vh / lo.H);
    // hand the final on-screen size of the mark to the finale, so the cut is invisible
    const endS = lo.camera[lo.camera.length - 1]!.s;
    document.documentElement.style.setProperty('--mark-px', `${Math.round(lo.geo.mark.w * fit * endS)}px`);
    document.documentElement.style.setProperty('--mark-y', `${lo.anchor * 100}vh`);
    // apply after the layout-dependent geometry has re-rendered
    requestAnimationFrame(() => apply(last));
  }

  onMount(() => {
    if (!document.documentElement.classList.contains('cine')) return;
    live = true;
    measure();
    let t = 0;
    const onResize = () => {
      clearTimeout(t);
      t = window.setTimeout(measure, 120);
    };
    addEventListener('resize', onResize, { passive: true });
    return () => removeEventListener('resize', onResize);
  });

  const naira = (n: number) => '₦' + n.toLocaleString('en-NG');
</script>

<section
  class="track"
  class:live
  data-lay={lay}
  bind:this={track}
  use:progress={{ mode: 'pin', onChange: apply }}
  aria-labelledby="film-title"
>
  <span id="sale" class="anchor"></span>
  <div class="pin" bind:this={pin}>
    <!-- the scene: everything the camera sees -->
    <div class="view" bind:this={view}>
      <div class="scene-in">
        <div class="world" bind:this={world} aria-hidden="true">
          <div class="photo" bind:this={el.photo} style:width="{L.geo.photo.w}px" style:height="{L.geo.photo.h}px">
            <img
              src={src(photo.bakeryShelf, 1600)}
              srcset={srcset(photo.bakeryShelf, [960, 1600, 2400])}
              sizes="100vw"
              alt=""
              fetchpriority="high"
            />
          </div>
          <div class="counter" bind:this={el.counter} style:width="{L.geo.counter.w}px" style:height="{L.geo.counter.h}px"></div>

          <div class="device" bind:this={el.device} style:width="{L.geo.device.w}px" style:height="{L.geo.device.h}px">
            <div class="screen"><PosScreen {tapped} /></div>
            <span class="label" style:font-size="{L.label}px">Point of sale</span>
          </div>

          <div class="panel inv" bind:this={el.inv} style:width="{L.geo.inv.w}px" style:height="{L.geo.inv.h}px">
            <div class="ph">Update Stock <span>Snacks</span></div>
            <div class="row hot" class:sold>
              <span>Meat Pie</span>
              <span class="count"><s>10</s><b>9</b></span>
            </div>
            <div class="row"><span>Chicken Pie</span><span>7</span></div>
            <div class="row low"><span>Sausage Roll</span><span>3 <i>Low</i></span></div>
            <div class="row out"><span>Scotch Egg</span><span>0 <i>Out</i></span></div>
            <div class="row"><span>Jam Doughnut</span><span>12</span></div>
            <div class="foot">Low-stock alert at 3 · Sale −1</div>
            <span class="label" style:font-size="{L.label}px">Inventory</span>
          </div>

          <div class="panel kot" bind:this={el.kot} style:width="{L.geo.kot.w}px" style:height="{L.geo.kot.h}px">
            <div class="paper">
              <div class="kh">KITCHEN ORDER TICKET</div>
              <div class="kn">KOT #0142</div>
              <div class="km">Takeaway · 19:24</div>
              <div class="kr"></div>
              <div class="ki"><b>1 ×</b> Meat Pie</div>
              <div class="kn2">Warm, no sauce</div>
              <div class="kr"></div>
              <div class="km">Station: Pastry</div>
              <div class="km">By: Ada (Cashier)</div>
            </div>
            <span class="label" style:font-size="{L.label}px">Kitchen</span>
          </div>

          <div class="panel pay" class:paid bind:this={el.pay} style:width="{L.geo.pay.w}px" style:height="{L.geo.pay.h}px">
            <div class="ph">Received by Cash</div>
            <div class="amt">₦1,000</div>
            <div class="pl"><span>Bill Total</span><span>₦1,000</span></div>
            <div class="pl"><span>Change</span><span>₦0</span></div>
            <div class="modes"><span class="on">Cash</span><span>Card</span><span>Transfer</span></div>
            <div class="state"><span class="wait">Awaiting payment…</span><span class="ok">✓ Paid · synced</span></div>
            <span class="label" style:font-size="{L.label}px">Payments</span>
          </div>

          <div class="panel ana" bind:this={el.ana} style:width="{L.geo.ana.w}px" style:height="{L.geo.ana.h}px">
            <div class="ph">Today <span>Net sales</span></div>
            <div class="net">{naira(net)}</div>
            <div class="chart">
              {#each bars as v, i}
                <div class="b" style:--h={v} style:--i={i}><i></i><span>{hours[i]}</span></div>
              {/each}
            </div>
            <div class="top"><span>Top item</span><span>Meat Pie · 64 sold</span></div>
            <span class="label" style:font-size="{L.label}px">Reports</span>
          </div>

          <div class="token" bind:this={el.token} style:width="{L.geo.token.w}px" style:height="{L.geo.token.h}px">
            <b></b>Meat Pie · ₦1,000
          </div>

          <div class="mark" bind:this={el.mark} style:width="{L.geo.mark.w}px" style:height="{L.geo.mark.h}px">
            <img src="/favicon.png" alt="" />
          </div>
        </div>
        <div class="grade"></div>
      </div>
    </div>

    <!-- opening titles -->
    <div class="hero" bind:this={heroText}>
      <div class="hero-in wrap">
        <p class="eyebrow e1">Point of sale &amp; operations</p>
        <h1 id="film-title">
          <span class="gls" aria-label="GLS"><span>G</span><span>L</span><span>S</span></span>
          <span class="tag"><span>The system behind</span><span>the <em>counter.</em></span></span>
        </h1>
        <p class="lede">
          Sales, stock, kitchen tickets, payments and reports — one connected system that keeps selling
          when the signal drops.
        </p>
        <div class="ctas">
          <a class="btn" href="#talk">Book a demo <span class="arrow">→</span></a>
          <a class="btn ghost" href="#sale">Follow one sale <span class="arrow">↓</span></a>
        </div>
      </div>
      <div class="cue wrap" aria-hidden="true"><span class="ln"></span>Scroll — the camera follows one sale</div>
    </div>

    <!-- lower thirds -->
    <ol class="caps">
      {#each captions as c, i}
        <li bind:this={capEls[i]}>
          <span class="no">{c.no}</span><span class="eyebrow">{c.tag}</span>
          <span class="line display">{c.line}</span>
          {#if c.no === '07'}
            <span class="sub">Works offline · Every device live · Roles &amp; PINs · Synced to the cloud</span>
          {/if}
        </li>
      {/each}
    </ol>
    <div class="rule" aria-hidden="true"></div>
  </div>
</section>

<style>
  /* ------------------------------------------------ static (no-JS / reduced) */
  .track {
    position: relative;
    background: var(--ink);
    color: var(--cream);
  }
  .anchor {
    position: absolute;
    top: 0;
  }
  .hero {
    padding: 8rem 0 4rem;
  }
  .track:not(.live) {
    --print: 1;
    --bars: 1;
    --ring: 1;
    padding-bottom: 2rem;
  }
  .track:not(.live) .view {
    max-width: var(--max);
    margin: 0 auto 4rem;
    padding-inline: var(--gutter);
  }
  .track:not(.live) .world {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: flex-start;
    gap: 4rem 2rem;
  }
  .track:not(.live) .world > * {
    position: relative;
    max-width: 100%;
  }
  .track:not(.live) :is(.photo, .counter, .token, .mark, .grade) {
    display: none;
  }
  .track:not(.live) .label {
    top: calc(100% + 0.6rem);
    font-size: 0.72rem !important;
  }
  .track:not(.live) .device .label {
    top: calc(100% + 2.6rem);
  }
  .caps {
    list-style: none;
    margin: 0;
    padding: 0 var(--gutter) 6rem;
    display: grid;
    gap: 2.5rem;
    max-width: var(--max);
    margin-inline: auto;
  }
  .rule {
    display: none;
  }

  /* --------------------------------------------------------------- hero type */
  .eyebrow.e1 {
    color: var(--lime);
    margin: 0 0 1.2rem;
  }
  h1 {
    margin: 0;
    font-weight: inherit;
  }
  .gls {
    display: flex;
    font-family: var(--serif);
    font-optical-sizing: auto;
    font-variation-settings: 'SOFT' 30, 'WONK' 0;
    font-weight: 380;
    font-size: clamp(7rem, 17vw, 17.5rem);
    line-height: 0.78;
    letter-spacing: -0.06em;
    margin-left: -0.05em;
  }
  .gls > span {
    display: block;
  }
  .tag {
    display: block;
    margin-top: 1.4rem;
    font-family: var(--serif);
    font-weight: 330;
    font-size: clamp(1.9rem, 3.1vw, 3.1rem);
    line-height: 1.02;
    letter-spacing: -0.025em;
  }
  .tag > span {
    display: block;
  }
  .tag em {
    font-style: italic;
    font-variation-settings: 'SOFT' 100, 'WONK' 1;
    color: var(--lime);
  }
  .lede {
    max-width: 30rem;
    margin: 1.6rem 0 2.2rem;
    color: color-mix(in oklab, var(--cream) 78%, transparent);
  }
  .ctas {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
  }
  .cue {
    display: none;
  }

  /* ---------------------------------------------------------- lower thirds */
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
    font-size: clamp(2.1rem, 4.4vw, 4.6rem);
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

  /* ================================================================ LIVE */
  .live {
    height: 900vh;
    z-index: 1; /* stays above the finale, which waits underneath */
    background: transparent;
  }
  .live .anchor {
    top: 26%;
  }
  .live .pin {
    position: sticky;
    top: 0;
    height: 100vh;
    height: 100svh;
    overflow: hidden;
    background: var(--ink);
  }
  .live .view {
    display: block;
    position: absolute;
    inset: 0;
  }
  .live .scene-in {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .live .world {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
  }
  .live .world > * {
    position: absolute;
    left: 0;
    top: 0;
  }
  .grade {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(120% 90% at 50% 45%, transparent 55%, rgb(10 12 8 / 0.55)),
      linear-gradient(transparent 70%, rgb(10 12 8 / 0.35));
  }

  .photo img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .photo::after {
    /* warm practical light from the left, dark falloff right */
    content: '';
    position: absolute;
    inset: 0;
    background:
      radial-gradient(60% 70% at 32% 30%, rgb(255 196 120 / 0.16), transparent 70%),
      linear-gradient(rgb(14 16 10 / 0.5), rgb(14 16 10 / 0.72));
  }
  .counter {
    background:
      radial-gradient(18% 9% at 50% 2%, rgb(255 236 200 / 0.12), transparent 70%),
      linear-gradient(#3a2c1d, #1f1710 30%, #120d08);
    box-shadow: 0 -1px 0 rgb(255 230 190 / 0.25);
  }

  .device {
    padding: 14px;
    border-radius: 14px;
    background: linear-gradient(160deg, #2b2f27, #15170f 60%);
    box-shadow:
      inset 0 0 0 1px rgb(255 255 255 / 0.08),
      0 30px 60px -20px rgb(0 0 0 / 0.7),
      0 60px 80px -40px rgb(0 0 0 / 0.6);
  }
  .device::after {
    /* stand */
    content: '';
    position: absolute;
    left: 50%;
    top: 100%;
    width: 30%;
    height: 34px;
    translate: -50% 0;
    background: linear-gradient(#1b1d16, #0e0f0a);
    clip-path: polygon(30% 0, 70% 0, 100% 100%, 0 100%);
  }
  [data-lay='narrow'] .device {
    padding: 10px;
    border-radius: 22px;
  }
  [data-lay='narrow'] .device::after {
    height: 24px;
  }
  .screen {
    position: relative;
    width: 100%;
    height: 100%;
    border-radius: 4px;
    overflow: hidden;
  }
  [data-lay='narrow'] .screen {
    border-radius: 13px;
  }

  /* ----------------------------------------------- the unfolded software */
  .panel {
    background: #fff;
    color: #424242;
    border-radius: 6px;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    font-size: 13px;
    box-shadow:
      0 1px 0 rgb(255 255 255 / 0.4) inset,
      0 24px 50px -18px rgb(0 0 0 / 0.65);
  }
  .ph {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 12px 14px;
    background: #5aa02c;
    color: #fff;
    font-weight: 600;
    font-size: 15px;
    border-radius: 6px 6px 0 0;
  }
  .ph span {
    font-size: 11px;
    font-weight: 500;
    opacity: 0.85;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 11px 14px;
    border-bottom: 1px solid #eee;
    font-weight: 500;
  }
  .row i {
    font-style: normal;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 5px;
    margin-left: 4px;
    border-radius: 2px;
    color: #fff;
    background: #f44336;
  }
  .row.out i {
    background: #c62828;
  }
  .row.hot {
    font-weight: 700;
    color: #212121;
    transition: background-color 0.5s;
  }
  .row.hot.sold {
    background: #eaf4e0;
  }
  .count {
    position: relative;
    display: inline-grid;
    font-size: 20px;
    font-variant-numeric: tabular-nums;
  }
  .count > * {
    grid-area: 1 / 1;
    text-align: right;
    text-decoration: none;
    transition:
      translate 0.6s var(--ease),
      opacity 0.4s;
  }
  .count b {
    color: #3f7a1c;
    translate: 0 70%;
    opacity: 0;
  }
  .sold .count s {
    translate: 0 -70%;
    opacity: 0;
  }
  .sold .count b {
    translate: 0 0;
    opacity: 1;
  }
  .foot {
    padding: 10px 14px;
    font-size: 11px;
    color: #757575;
  }

  .kot {
    background: transparent;
    box-shadow: none;
  }
  .paper {
    height: 100%;
    padding: 16px 16px 26px;
    background: #fbfaf6;
    color: #1d1d1b;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 12px;
    line-height: 1.55;
    clip-path: inset(0 0 calc((1 - var(--print, 0)) * 100%) 0);
    translate: 0 calc((1 - var(--print, 0)) * -18px);
    mask: conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) 50% / 12px 100%;
    box-shadow: 0 20px 40px -18px rgb(0 0 0 / 0.6);
  }
  .kh {
    font-weight: 700;
    letter-spacing: 0.06em;
    text-align: center;
  }
  .kn {
    margin-top: 6px;
    font-size: 20px;
    font-weight: 700;
    text-align: center;
  }
  .km {
    text-align: center;
    color: #555;
  }
  .kr {
    margin: 10px 0;
    border-top: 1px dashed #999;
  }
  .ki {
    font-size: 17px;
  }
  .kn2 {
    padding-left: 2.2em;
    color: #555;
  }

  .amt {
    padding: 12px 14px 6px;
    font-size: 34px;
    font-weight: 700;
    color: #212121;
    letter-spacing: -0.01em;
  }
  .pl {
    display: flex;
    justify-content: space-between;
    padding: 2px 14px;
    color: #616161;
  }
  .modes {
    display: flex;
    gap: 6px;
    padding: 10px 14px 0;
  }
  .modes span {
    padding: 4px 9px;
    border: 1px solid #e0e0e0;
    border-radius: 3px;
    font-size: 11px;
    color: #757575;
  }
  .modes .on {
    border-color: #5aa02c;
    color: #3f7a1c;
    font-weight: 600;
  }
  .state {
    display: grid;
    padding: 10px 14px;
    font-weight: 600;
    font-size: 12px;
  }
  .state > * {
    grid-area: 1 / 1;
    transition: opacity 0.4s;
  }
  .wait {
    color: #9e9e9e;
  }
  .ok {
    color: #3f7a1c;
    opacity: 0;
  }
  .paid .ok {
    opacity: 1;
  }
  .paid .wait {
    opacity: 0;
  }

  .net {
    padding: 12px 14px 4px;
    font-size: 30px;
    font-weight: 700;
    color: #212121;
    font-variant-numeric: tabular-nums;
  }
  .chart {
    display: flex;
    align-items: flex-end;
    gap: 5px;
    height: 92px;
    padding: 0 14px;
  }
  .b {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    height: 100%;
  }
  .b i {
    display: block;
    height: calc(var(--h) * 78px);
    background: #5aa02c;
    border-radius: 2px 2px 0 0;
    transform-origin: bottom;
    scale: 1 clamp(0, calc(var(--bars, 0) * 1.6 - var(--i) * 0.05), 1);
  }
  .b span {
    height: 14px;
    font-size: 9px;
    color: #9e9e9e;
    text-align: center;
  }
  .top {
    display: flex;
    justify-content: space-between;
    padding: 10px 14px;
    font-size: 11px;
    color: #616161;
  }
  .top span:last-child {
    font-weight: 600;
    color: #3f7a1c;
  }

  /* the sale itself, travelling */
  .token {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: var(--lime);
    color: var(--ink);
    font-family: var(--sans);
    font-weight: 600;
    font-size: 14px;
    letter-spacing: 0.02em;
    border-radius: 2px;
    box-shadow:
      0 0 0 6px rgb(170 206 70 / 0.18),
      0 14px 30px -10px rgb(0 0 0 / 0.6);
    z-index: 3;
  }
  .token b {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ink);
  }

  .mark img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  /* station labels appear as the system converges */
  .label {
    position: absolute;
    left: 50%;
    top: calc(100% + 0.8em);
    translate: -50% 0;
    white-space: nowrap;
    font-family: var(--sans);
    font-weight: 600;
    font-stretch: 112%;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--cream);
    opacity: var(--ring, 0);
  }
  .device .label {
    top: calc(100% + 2.6em);
  }

  /* ------------------------------------------------------------- live hero */
  .live .hero {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 5rem 0 3rem;
    pointer-events: none;
  }
  .live .hero a {
    pointer-events: auto;
  }
  .live .hero-in {
    max-width: var(--max);
  }
  .live .hero-in > * {
    max-width: 44vw;
  }
  .live .cue {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 2rem;
    display: flex;
    align-items: center;
    gap: 1rem;
    font-size: 0.72rem;
    font-weight: 600;
    font-stretch: 112%;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: color-mix(in oklab, var(--cream) 60%, transparent);
  }
  .ln {
    position: relative;
    width: 4rem;
    height: 1px;
    background: color-mix(in oklab, var(--cream) 25%, transparent);
    overflow: hidden;
  }
  .ln::after {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--lime);
    animation: run 2.4s var(--ease-io) infinite;
  }
  @keyframes run {
    from {
      translate: -100% 0;
    }
    to {
      translate: 100% 0;
    }
  }

  .live .caps {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: block;
    padding: 0;
    pointer-events: none;
  }
  .live .caps li {
    position: absolute;
    left: 50%;
    bottom: 2.4rem;
    width: max-content;
    max-width: min(36rem, 80vw);
    translate: -50% 0;
    padding: 1.1rem 1.5rem 1.3rem;
    background: color-mix(in oklab, var(--ink) 90%, transparent);
    box-shadow: inset 3px 0 0 var(--lime);
    opacity: 0;
    visibility: hidden;
  }
  .live .caps li:last-child {
    background: transparent;
    box-shadow: none;
    left: 0;
    right: 0;
    bottom: 2.2rem;
    width: auto;
    translate: none;
    max-width: none;
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
  .live .line {
    font-size: clamp(2rem, 3.8vw, 3.9rem);
  }
  .live .rule {
    display: block;
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 2px;
    background: var(--lime);
    transform-origin: left;
    scale: var(--p, 0) 1;
  }

  /* ---------------------------------------------- opening sequence (once) */
  :global(html.cine) .scene-in {
    animation: open 1.8s var(--ease) 0.15s both;
  }
  :global(html.cine) .scene-in .world {
    animation: settle 2.6s var(--ease) 0.15s both;
  }
  @keyframes open {
    from {
      clip-path: inset(0 50% 0 50%);
    }
    to {
      clip-path: inset(0 0 0 0);
    }
  }
  @keyframes settle {
    from {
      opacity: 0.3;
      filter: brightness(0.4);
    }
    to {
      opacity: 1;
      filter: none;
    }
  }
  :global(html.cine) .gls > span,
  :global(html.cine) .tag > span,
  :global(html.cine) .e1,
  :global(html.cine) .lede,
  :global(html.cine) .ctas,
  :global(html.cine) .cue {
    animation: rise 1.4s var(--ease) both;
  }
  :global(html.cine) .e1 {
    animation-delay: 0.5s;
  }
  :global(html.cine) .gls > span:nth-child(1) {
    animation-delay: 0.6s;
  }
  :global(html.cine) .gls > span:nth-child(2) {
    animation-delay: 0.7s;
  }
  :global(html.cine) .gls > span:nth-child(3) {
    animation-delay: 0.8s;
  }
  :global(html.cine) .tag > span:nth-child(1) {
    animation-delay: 1.05s;
  }
  :global(html.cine) .tag > span:nth-child(2) {
    animation-delay: 1.15s;
  }
  :global(html.cine) .lede {
    animation-delay: 1.35s;
  }
  :global(html.cine) .ctas {
    animation-delay: 1.5s;
  }
  :global(html.cine) .cue {
    animation-delay: 2.1s;
  }
  @keyframes rise {
    from {
      opacity: 0;
      translate: 0 2.2rem;
    }
  }

  /* ------------------------------------------------------------- narrow */
  @media (max-width: 759px) {
    .live {
      height: 1000vh;
    }
    .live .hero {
      justify-content: flex-start;
      padding: 5.6rem 0 0;
    }
    .live .hero-in > * {
      max-width: none;
    }
    .gls {
      font-size: clamp(6.5rem, 34vw, 9rem);
    }
    .tag {
      margin-top: 0.8rem;
      font-size: clamp(1.6rem, 7.4vw, 2.1rem);
    }
    .live .lede {
      display: none;
    }
    .live .ctas {
      margin-top: 1.4rem;
    }
    .live .ctas .ghost {
      display: none;
    }
    .live .cue {
      display: none;
    }
    .live .caps li {
      top: 4.6rem;
      bottom: auto;
      left: var(--gutter);
      right: var(--gutter);
      width: auto;
      translate: none;
      max-width: none;
      padding: 1rem 1.15rem 1.15rem;
    }
    .live .caps li:last-child {
      top: auto;
      bottom: 1.6rem;
      padding: 0 var(--gutter);
    }
    .live .line {
      font-size: clamp(1.7rem, 7.6vw, 2.2rem);
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
