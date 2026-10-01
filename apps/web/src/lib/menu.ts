/**
 * Menu shown on the landing page. Prices are integer minor units (kobo) —
 * never floats — matching the POS money rule.
 *
 * TODO(owner): PLACEHOLDER items and prices. Long-term this should be read from
 * the store's catalog (Store Durable Object) so the POS stays the single source
 * of truth.
 */
export type MenuItem = {
  id: string;
  name: string;
  note: string;
  priceMinor: number;
  tag?: 'Signature' | 'Baked today' | 'Spicy' | 'Pre-order';
};

export type MenuCategory = { id: string; label: string; items: MenuItem[] };

export const menu: MenuCategory[] = [
  {
    id: 'rice',
    label: 'Rice & Mains',
    items: [
      { id: 'jollof', name: 'Party Jollof', note: 'Smoky, firewood-style, with fried plantain', priceMinor: 450000, tag: 'Signature' },
      { id: 'fried-rice', name: 'Nigerian Fried Rice', note: 'Liver, prawns, mixed vegetables', priceMinor: 480000 },
      { id: 'ofada', name: 'Ofada & Ayamase', note: 'Local rice, green pepper sauce, assorted meat', priceMinor: 550000, tag: 'Spicy' },
      { id: 'porridge', name: 'Yam Porridge', note: 'Slow-cooked asaro with smoked fish', priceMinor: 400000 }
    ]
  },
  {
    id: 'grill',
    label: 'Grills',
    items: [
      { id: 'suya', name: 'Beef Suya', note: 'Yaji-rubbed, onions, tomato, cabbage', priceMinor: 350000, tag: 'Spicy' },
      { id: 'pepper-chicken', name: 'Peppered Chicken', note: 'Grilled then tossed in rodo sauce', priceMinor: 420000, tag: 'Signature' },
      { id: 'fish', name: 'Grilled Croaker', note: 'Whole fish, pepper sauce, chips or plantain', priceMinor: 900000 }
    ]
  },
  {
    id: 'soup',
    label: 'Soups & Swallow',
    items: [
      { id: 'egusi', name: 'Egusi', note: 'Melon seed, ugu, assorted meat — with pounded yam', priceMinor: 600000 },
      { id: 'efo', name: 'Efo Riro', note: 'Rich spinach stew with iru and stockfish', priceMinor: 580000 },
      { id: 'banga', name: 'Banga', note: 'Palm fruit soup with fresh fish — with starch', priceMinor: 650000 }
    ]
  },
  {
    id: 'chops',
    label: 'Small Chops',
    items: [
      { id: 'small-chops', name: 'Small Chops Box', note: 'Puff-puff, samosa, spring rolls, gizdodo', priceMinor: 500000, tag: 'Signature' },
      { id: 'meat-pie', name: 'Meat Pie', note: 'Buttery shortcrust, minced beef & potato', priceMinor: 120000, tag: 'Baked today' },
      { id: 'puff', name: 'Puff-Puff (12)', note: 'Golden, nutmeg-scented, lightly sugared', priceMinor: 150000 }
    ]
  },
  {
    id: 'bakery',
    label: 'Bakery',
    items: [
      { id: 'croissant', name: 'Butter Croissant', note: 'Laminated over three days', priceMinor: 180000, tag: 'Baked today' },
      { id: 'agege', name: 'Agege Loaf', note: 'Soft, pillowy, the proper one', priceMinor: 150000, tag: 'Baked today' },
      { id: 'coconut-bread', name: 'Coconut Bread', note: 'Toasted coconut, brown sugar crust', priceMinor: 200000 },
      { id: 'chin-chin', name: 'Chin-Chin Jar', note: 'Crunchy, cardamom & nutmeg', priceMinor: 250000 }
    ]
  },
  {
    id: 'cakes',
    label: 'Cakes',
    items: [
      { id: 'choc-cake', name: 'Dark Chocolate Cake', note: '8", ganache, cocoa crumb', priceMinor: 2500000, tag: 'Pre-order' },
      { id: 'red-velvet', name: 'Red Velvet', note: '8", cream-cheese frosting', priceMinor: 2400000, tag: 'Pre-order' },
      { id: 'slice', name: 'Cake Slice', note: 'Ask what’s in the cabinet today', priceMinor: 300000 }
    ]
  }
];

const ngn = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });
/** Format integer kobo for display. */
export const formatMinor = (minor: number) => ngn.format(Math.round(minor) / 100);
