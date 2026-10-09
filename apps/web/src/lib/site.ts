/**
 * Single source of truth for brand facts shown on the site.
 *
 * TODO(owner): everything marked PLACEHOLDER must be replaced with the real
 * details before launch — these were not available in the repo.
 */
export const site = {
  name: 'GLS Kitchen & Bakery',
  established: 2018,
  tagline: 'Freshly made. Beautifully served.',
  currency: 'NGN',
  // International format, digits only (used for wa.me + tel:)
  whatsapp: '2348105615458',
  phoneDisplay: '0810 561 5458',
  email: 'glskitchenandbakery@gmail.com',
  address: ['GLS Kitchen & Bakery', 'Poka, Epe', 'Lagos, Nigeria'],
  mapsUrl: 'https://maps.google.com/?q=6.6167567,3.9862417',
  instagram: 'https://instagram.com/', // PLACEHOLDER
  hours: [
    { days: 'Mon – Sat', time: '9:30 – 21:00' },
    { days: 'Sunday', time: '10:00 – 21:00' }
  ]
} as const;

/**
 * Branches. Open ones show their address; "soon" ones tell customers a new
 * location is on the way. TODO(owner): confirm names/areas — only Poka is known
 * from the POS menu data; the coming-soon entries are placeholders.
 */
export const branches = [
  { name: 'Poka', area: 'Our first kitchen & bakery', status: 'open' },
  { name: 'Odoshola', area: 'Our new branch, opening soon', status: 'soon' }
] as const;

/**
 * Editorial photography. Hot-linked from Unsplash (their licence asks for
 * hot-linking). Swap for GLS's own photography when it exists — only this map
 * needs to change.
 */
// GLS's own food photos, from their Azumi listing. Keys kept stable.
const G = (file: string) => `https://bucket.azumi.com.ng/${file}`;
export const photo = {
  croissants: G('1775174163580-l1amx3.jpg'), // chicken pie (hero)
  jollof: G('1771670543965-ctc38d.png'),
  suya: G('1775211983191-sgfgqz.png'), // double sausage shawarma
  pepperedChicken: G('1783242853769-qwu8ep.jpg'), // special pizza
  spread: G('1775166318323-xm469u.jpg'), // village rice
  chefFlame: G('1783242778978-16ay0v.jpg'), // beef pizza
  chopping: G('1775168095158-13fpkn.jpg'), // ofada rice
  sourdough: G('1775213647512-8qn5bq.png'), // butter bread
  chocolateCake: G('1775172952116-wcglkb.jpg'), // cake parfait
  raspberrySlice: G('1775173192164-eyascz.jpg'), // fruit parfait
  breadBasket: G('1775213531849-qh6izm.png'), // sardine bread
  cookies: G('1775215073166-clzhna.png'), // chin-chin
  orangeCake: G('1775174475456-y8og5e.jpg'), // foil cake
  bakeryShelf: G('1771671158381-8uohgz.png'), // meat pie
  dining: G('1775167957946-hatm1o.jpg') // coconut rice
} as const;

const resize = (base: string, w: number) =>
  `https://azumi.com.ng/cdn-cgi/image/format=auto,width=${w},quality=82,fit=scale-down,onerror=redirect/${base}`;

/** Responsive srcset for a photo. */
export function srcset(base: string, widths = [640, 960, 1400, 2000]) {
  return widths.map((w) => `${resize(base, w)} ${w}w`).join(', ');
}
export function src(base: string, w = 1400) {
  return resize(base, w);
}
