/**
 * Azumi source image URLs for the seeded GLS menu, keyed by item name.
 * Used once at first launch to hydrate base64 images into SQLite (see
 * catalog.tsx). After hydration the images live in the local DB — no bucket.
 */
const B = "https://bucket.azumi.com.ng/";

export const ITEM_IMAGES: Record<string, string> = {
  // Pizza
  "Beef Pizza Small": B + "1786463768800-6sl0ai.jpg",
  "Beef Pizza": B + "1783242778978-16ay0v.jpg",
  "Chicken Pizza": B + "1783242810506-kyu4zi.jpg",
  "Chicken Pizza Small": B + "1786463675035-0y9uqp.jpg",
  "Special Pizza (Small)": B + "1786463993782-xuejoz.jpg",
  "Special Pizza": B + "1783242853769-qwu8ep.jpg",

  // Rice
  "Jollof Rice - Per Spoon": B + "1771670543965-ctc38d.png",
  "Stir Fry Spaghetti": B + "1781602666120-cxkmxn.jpg",
  "Fried Rice": B + "1771670468836-uhketr.png",
  "White Rice": B + "1771670712600-sedus0.png",
  "Ofada Rice": B + "1775168095158-13fpkn.jpg",
  "Village Rice": B + "1775166318323-xm469u.jpg",
  "Rice and Beans": B + "1775215637552-fbx3yp.png",
  "Coconut Rice": B + "1775167957946-hatm1o.jpg",

  // Porridge
  "Beans Porridge": B + "1775166772840-4o4u6t.jpg",
  "Yam Porridge": B + "1775168603171-ddygdg.jpg",

  // Swallow
  "Eba": B + "1775168878341-yt5pm9.jpg",
  "Amala": B + "1771671975878-jpu3n8.png",
  "Fufu": B + "1773655778808-t990mb.png",
  "Semo": B + "1771835016583-zmoper.png",

  // Bread
  "Butter Bread": B + "1775213647512-8qn5bq.png",
  "Sardine Bread": B + "1775213531849-qh6izm.png",

  // Shawarma
  "Double Sausage Shawarma": B + "1775211983191-sgfgqz.png",
  "Single Sausage Shawarma": B + "1775211821915-htwrln.jfif",

  // Snacks
  "Crispy Chicken": B + "1785149035757-nvxoog.jpg",
  "Scotch Egg": B + "1786354918807-594tgy.jpg",
  "Meat Pie": B + "1771671158381-8uohgz.png",
  "Chicken Pie": B + "1775174163580-l1amx3.jpg",
  "Sausage Roll": B + "1771671595469-ue4a89.png",
  "Frankroll": B + "1771834906715-zl4ips.png",
  "Jam Doughnut": B + "1771671814250-xozu6z.png",
  "Plain Doughnut": B + "1775173574424-97weem.jpg",
  "Foil Cake": B + "1775174475456-y8og5e.jpg",
  "Fruit Parfait": B + "1775173192164-eyascz.jpg",
  "Cake Parfait": B + "1775172952116-wcglkb.jpg",
  "Chicken and Chips": B + "1775168289532-ha80h9.jpg",
  "Plantain Chips": B + "1775174584985-bxw42h.jpg",
  "Burger": B + "1775172801750-q0d8t0.jpg",
  "Chin-Chin": B + "1775215073166-clzhna.png",

  // Drinks
  "Big Eva": B + "1771835597238-jqdzrg.png",
  "Bottle Water": B + "1786614666299-ywkg2i.jpg",
  "Coke": B + "1773656705935-op8bul.png",
  "Pepsi": B + "1771835554907-ldykdg.png",
  "Fanta": B + "1775206577324-9ldjo3.jfif",
  "Can Malt": B + "1771835859390-6sgd2d.png",
  "Fresh Yo": B + "1775209198504-svojqy.png",
  "Monster": B + "1773656773130-35nixp.png",
  "Schweppes Can": B + "1775206764747-ydbj6h.png",
  "Pulpy Orange Small": B + "1775209437944-0a9tfl.png",
  "Pulpy Orange Big": B + "1775209934472-5trs2x.jfif",
  "Chi Exotic Can": B + "1775209859144-schkay.jfif",
  "Chi-Exotic 1 Litre": B + "1775207277146-d0wwbl.jfif",
  "Chivita Active Can": B + "1775207129968-e569xq.jfif",
  "Chivita Active 1 Litre": B + "1775206922534-lh45jp.jfif",
  "Hollandia Yoghurt": B + "1775210616314-fd4tu6.jfif",
  "Peak Yoghurt": B + "1775211115522-dm0kgz.jfif",
  "Fayrouz": B + "1775209084641-j1f1g7.png",
  "Sosa": B + "1775207949108-i8z4do.png",
  "Lucozade Boost": B + "1775208311608-zi2u9o.png",
  "Zobo Drink": B + "1775214265655-gicejn.png",
  "Pineapple Juice": B + "1775214397890-t59fuy.png",
  "Vita Milk": B + "1775208131897-8uf3ly.png",
};
