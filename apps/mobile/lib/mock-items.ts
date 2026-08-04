import type { Item } from "./cart";

export const categories = [
  { id: "c1", name: "Coffee", color: "#8D6E63" },
  { id: "c2", name: "Food", color: "#EF6C00" },
  { id: "c3", name: "Pizza", color: "#C62828" },
  { id: "c4", name: "Drinks", color: "#F9A825" },
  { id: "c5", name: "Desserts", color: "#6D4C41" },
];

/** Placeholder catalog so screens render instantly on device. */
export const mockItems: Item[] = [
  { id: "p1", name: "Espresso", price: 350, currency: "USD", stockQuantity: null, unit: "cup", categoryId: "c1", categoryColor: "#8D6E63", taxRateBps: 750 },
  { id: "p2", name: "Cappuccino", price: 450, currency: "USD", stockQuantity: 12, unit: "cup", categoryId: "c1", categoryColor: "#8D6E63", taxRateBps: 750 },
  { id: "p3", name: "Latte", price: 480, currency: "USD", stockQuantity: 3, unit: "cup", categoryId: "c1", categoryColor: "#8D6E63", taxRateBps: 750 },
  { id: "p4", name: "Cheeseburger", price: 890, currency: "USD", stockQuantity: 0, unit: "pc", categoryId: "c2", categoryColor: "#EF6C00", taxRateBps: 750 },
  { id: "p5", name: "Fries", price: 350, currency: "USD", stockQuantity: 40, unit: "reg", categoryId: "c2", categoryColor: "#EF6C00" },
  { id: "p6", name: "Margherita Pizza", price: 1200, currency: "USD", stockQuantity: 5, unit: '12"', categoryId: "c3", categoryColor: "#C62828", taxRateBps: 750 },
  { id: "p7", name: "Caesar Salad", price: 760, currency: "USD", stockQuantity: null, categoryId: "c2", categoryColor: "#EF6C00" },
  { id: "p8", name: "Orange Juice", price: 300, currency: "USD", stockQuantity: 2, unit: "glass", categoryId: "c4", categoryColor: "#F9A825" },
  { id: "p9", name: "Chicken Wings", price: 990, currency: "USD", stockQuantity: 8, unit: "6pc", categoryId: "c2", categoryColor: "#EF6C00" },
  { id: "p10", name: "Chocolate Cake", price: 550, currency: "USD", stockQuantity: 0, unit: "slice", categoryId: "c5", categoryColor: "#6D4C41" },
  { id: "p11", name: "Sparkling Water", price: 250, currency: "USD", stockQuantity: null, categoryId: "c4", categoryColor: "#0277BD" },
  { id: "p12", name: "Iced Tea", price: 320, currency: "USD", stockQuantity: 15, unit: "glass", categoryId: "c4", categoryColor: "#F9A825" },
  { id: "p13", name: "Pepperoni Pizza", price: 1400, currency: "USD", stockQuantity: 4, unit: '12"', categoryId: "c3", categoryColor: "#C62828", taxRateBps: 750 },
  { id: "p14", name: "Tiramisu", price: 620, currency: "USD", stockQuantity: 6, unit: "slice", categoryId: "c5", categoryColor: "#6D4C41" },
  { id: "p15", name: "Americano", price: 380, currency: "USD", stockQuantity: null, unit: "cup", categoryId: "c1", categoryColor: "#8D6E63" },
];

export const paymentModes = ["Cash", "Debit Card", "Credit Card", "Credit", "UPI / BHIM"];
