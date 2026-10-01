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
  // PLACEHOLDER — international format, digits only (used for wa.me + tel:)
  whatsapp: '2340000000000',
  phoneDisplay: '+234 000 000 0000', // PLACEHOLDER
  email: 'hello@glskitchen.example', // PLACEHOLDER
  address: ['GLS Kitchen & Bakery', 'Street address', 'City, Nigeria'], // PLACEHOLDER
  mapsUrl: 'https://maps.google.com/?q=GLS+Kitchen+and+Bakery', // PLACEHOLDER
  instagram: 'https://instagram.com/', // PLACEHOLDER
  hours: [
    { days: 'Mon – Fri', time: '8:00 – 21:00' },
    { days: 'Saturday', time: '9:00 – 22:00' },
    { days: 'Sunday', time: '12:00 – 20:00' }
  ] // PLACEHOLDER
} as const;

/**
 * Editorial photography. Hot-linked from Unsplash (their licence asks for
 * hot-linking). Swap for GLS's own photography when it exists — only this map
 * needs to change.
 */
const U = (id: string) => `https://images.unsplash.com/photo-${id}`;
export const photo = {
  croissants: U('1555507036-ab1f4038808a'),
  jollof: U('1512058564366-18510be2db19'),
  suya: U('1599487488170-d11ec9c172f0'),
  pepperedChicken: U('1604908176997-125f25cc6f3d'),
  spread: U('1504674900247-0877df9cc836'),
  chefFlame: U('1600565193348-f74bd3c7ccdf'),
  chopping: U('1551218808-94e220e084d2'),
  sourdough: U('1509440159596-0249088772ff'),
  chocolateCake: U('1578985545062-69928b1d9587'),
  raspberrySlice: U('1565958011703-44f9829ba187'),
  breadBasket: U('1608198093002-ad4e005484ec'),
  cookies: U('1558961363-fa8fdf82db35'),
  orangeCake: U('1542826438-bd32f43d626f'),
  bakeryShelf: U('1517433670267-08bbd4be890f'),
  dining: U('1414235077428-338989a2e8c0')
} as const;

/** Build a responsive srcset for an Unsplash base URL. */
export function srcset(base: string, widths = [640, 960, 1400, 2000]) {
  return widths.map((w) => `${base}?auto=format&fit=crop&w=${w}&q=72 ${w}w`).join(', ');
}
export function src(base: string, w = 1400) {
  return `${base}?auto=format&fit=crop&w=${w}&q=72`;
}
