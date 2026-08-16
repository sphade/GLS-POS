import type { Item } from "./cart";

/**
 * Real GLS Kitchen & Bakery (Poka) menu, sourced from the restaurant's Azumi
 * page. Prices are integer minor units (₦ × 100). Every item is stock-tracked
 * at 10 with a low-stock alert at 3.
 */

export const categories = [
  { id: "cat_pizza", name: "Pizza", color: "#C62828" },
  { id: "cat_rice", name: "Rice", color: "#EF6C00" },
  { id: "cat_porridge", name: "Porridge", color: "#F9A825" },
  { id: "cat_swallow", name: "Swallow", color: "#6D4C41" },
  { id: "cat_bread", name: "Bread", color: "#8D6E63" },
  { id: "cat_shawarma", name: "Shawarma", color: "#0277BD" },
  { id: "cat_snacks", name: "Snacks", color: "#6A1B9A" },
  { id: "cat_drinks", name: "Drinks", color: "#00838F" },
];

const colorOf = Object.fromEntries(categories.map((c) => [c.id, c.color])) as Record<string, string>;
let seq = 0;

/** Build items for a category. `naira` is the whole-naira price; stored ×100. */
function group(categoryId: string, entries: [name: string, naira: number][]): Item[] {
  return entries.map(([name, naira]) => ({
    id: `gls_${++seq}`,
    name,
    price: naira * 100,
    currency: "NGN",
    stockQuantity: 10,
    lowStockAt: 3,
    categoryId,
    categoryColor: colorOf[categoryId]!,
  }));
}

export const mockItems: Item[] = [
  ...group("cat_pizza", [
    ["Beef Pizza Small", 5000],
    ["Beef Pizza", 9500],
    ["Chicken Pizza", 9500],
    ["Chicken Pizza Small", 5000],
    ["Special Pizza (Small)", 7000],
    ["Special Pizza", 13000],
  ]),
  ...group("cat_rice", [
    ["Jollof Rice - Per Spoon", 800],
    ["Stir Fry Spaghetti", 600],
    ["Fried Rice", 700],
    ["White Rice", 600],
    ["Ofada Rice", 800],
    ["Village Rice", 1000],
    ["Rice and Beans", 800],
    ["Coconut Rice", 1000],
  ]),
  ...group("cat_porridge", [
    ["Beans Porridge", 550],
    ["Yam Porridge", 950],
  ]),
  ...group("cat_swallow", [
    ["Eba", 350],
    ["Amala", 550],
    ["Fufu", 350],
    ["Semo", 350],
  ]),
  ...group("cat_bread", [
    ["Butter Bread", 1500],
    ["Sardine Bread", 3000],
  ]),
  ...group("cat_shawarma", [
    ["Double Sausage Shawarma", 4000],
    ["Single Sausage Shawarma", 3500],
  ]),
  ...group("cat_snacks", [
    ["Crispy Chicken", 3000],
    ["Scotch Egg", 1000],
    ["Meat Pie", 1000],
    ["Chicken Pie", 1100],
    ["Sausage Roll", 800],
    ["Frankroll", 800],
    ["Jam Doughnut", 800],
    ["Plain Doughnut", 600],
    ["Foil Cake", 2000],
    ["Fruit Parfait", 5000],
    ["Cake Parfait", 4000],
    ["Chicken and Chips", 6000],
    ["Plantain Chips", 3000],
    ["Burger", 2500],
    ["Chin-Chin", 3700],
  ]),
  ...group("cat_drinks", [
    ["Big Eva", 600],
    ["Bottle Water", 300],
    ["Coke", 600],
    ["Pepsi", 600],
    ["Fanta", 600],
    ["Can Malt", 1000],
    ["Fresh Yo", 1000],
    ["Monster", 1500],
    ["Schweppes Can", 700],
    ["Pulpy Orange Small", 1000],
    ["Pulpy Orange Big", 2000],
    ["Chi Exotic Can", 1000],
    ["Chi-Exotic 1 Litre", 2500],
    ["Chivita Active Can", 1000],
    ["Chivita Active 1 Litre", 2500],
    ["Hollandia Yoghurt", 3000],
    ["Peak Yoghurt", 3000],
    ["Fayrouz", 1000],
    ["Sosa", 2000],
    ["Lucozade Boost", 1500],
    ["Zobo Drink", 2500],
    ["Pineapple Juice", 3000],
    ["Vita Milk", 3000],
  ]),
];

export const paymentModes = ["Cash", "Debit Card", "Credit Card", "Credit", "UPI / BHIM"];
