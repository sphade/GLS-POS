/**
 * GLS Website CMS Admin Client.
 *
 * Manages login state, renders editable copy + R2 image upload slots grouped by
 * page, and persists changes to `/api/cms/content` (stored in Cloudflare R2).
 */
(function () {
  const SCHEMA = [
    {
      id: "home",
      label: "Home",
      sections: [
        {
          title: "Hero Section",
          desc: "Top banner on the home page.",
          images: [
            { key: "home_hero_img", label: "Hero Background Photo", hint: "Full-width banner behind the headline", fallback: "img/hero.webp" },
          ],
          fields: [
            { key: "home_hero_kicker", label: "Location Kicker", fallback: "Poka · Ora Community · Epe, Lagos" },
            { key: "home_hero_title_1", label: "Headline (Line 1)", fallback: "Come for the food." },
            { key: "home_hero_title_em", label: "Headline (Italic Accent)", fallback: "Stay for the moment." },
            { key: "home_hero_sub", label: "Subheadline", type: "textarea", fallback: "Nigerian favourites, fresh bakes and a place to enjoy them with people we care about." },
            { key: "home_hero_phones", label: "Phone Line Under Buttons", fallback: "Poka 0810 561 5458  ·  Ora Community 0906 396 9745" },
            { key: "home_rating_score", label: "Google Rating Score", fallback: "4.3★" },
            { key: "home_rating_label", label: "Rating Label", fallback: "on Google" },
          ],
        },
        {
          title: "Three Doors (Come Eat / Celebrate / Take Home)",
          desc: "The three large image cards under the hero.",
          images: [
            { key: "home_door1_img", label: "Card 1 Photo (Come eat)", fallback: "img/dish-swallow.webp" },
            { key: "home_door2_img", label: "Card 2 Photo (Come celebrate)", fallback: "img/bake-cake.webp" },
            { key: "home_door3_img", label: "Card 3 Photo (Take some home)", fallback: "img/bake-bread.webp" },
          ],
          fields: [
            { key: "home_doors_kicker", label: "Section Kicker", fallback: "More than somewhere to eat" },
            { key: "home_doors_heading", label: "Section Heading", fallback: "Come in for a meal. Stay for the company. Take something home." },
            { key: "home_door1_title", label: "Card 1 Title", fallback: "Come eat" },
            { key: "home_door1_desc", label: "Card 1 Description", fallback: "Rice, soups, swallow, proteins and fish. Priced per portion." },
            { key: "home_door2_title", label: "Card 2 Title", fallback: "Come celebrate" },
            { key: "home_door2_desc", label: "Card 2 Description", fallback: "Birthdays, dates and family moments, with the cake sorted." },
            { key: "home_door3_title", label: "Card 3 Title", fallback: "Take some home" },
            { key: "home_door3_desc", label: "Card 3 Description", fallback: "Fresh bread and meat pie from the GLS Bakery." },
          ],
        },
        {
          title: "From the Kitchen (4 Featured Dishes)",
          desc: "The four dishes highlighted on the home page.",
          images: [
            { key: "home_dish1_img", label: "Dish 1 Photo", fallback: "img/dish-turkey.webp" },
            { key: "home_dish2_img", label: "Dish 2 Photo", fallback: "img/dish-swallow.webp" },
            { key: "home_dish3_img", label: "Dish 3 Photo", fallback: "img/dish-chicken.webp" },
            { key: "home_dish4_img", label: "Dish 4 Photo", fallback: "img/dish-burger.webp" },
          ],
          fields: [
            { key: "home_dishes_kicker", label: "Section Kicker", fallback: "From the kitchen" },
            { key: "home_dishes_heading", label: "Section Heading", fallback: "What are you having?" },
            { key: "home_dish1_title", label: "Dish 1 Name", fallback: "Turkey in Pepper Stew" },
            { key: "home_dish1_desc", label: "Dish 1 Caption", fallback: "A GLS favourite for any day of the week." },
            { key: "home_dish2_title", label: "Dish 2 Name", fallback: "Pounded Yam & Egusi" },
            { key: "home_dish2_desc", label: "Dish 2 Caption", fallback: "The kind of plate that needs no introduction." },
            { key: "home_dish3_title", label: "Dish 3 Name", fallback: "Chicken & Spaghetti" },
            { key: "home_dish3_desc", label: "Dish 3 Caption", fallback: "A full plate when you want something different." },
            { key: "home_dish4_title", label: "Dish 4 Name", fallback: "The GLS Burger" },
            { key: "home_dish4_desc", label: "Dish 4 Caption", fallback: "For when you're not in the mood for rice and soup." },
          ],
        },
        {
          title: "GLS Ora Community Spotlight",
          desc: "Dark green split section on the home page (includes the 'Ora in the evening' photo slot).",
          images: [
            { key: "home_ora_img1", label: "Ora Photo 1 (Tall left)", fallback: "img/ora-booths.webp" },
            { key: "home_ora_img2", label: "Ora Photo 2 (Top right)", fallback: "img/ora-art.webp" },
            { key: "home_ora_img3", label: "Ora Photo 3 (Bottom right — currently 'Photo to come')", hint: "Upload a photo to replace the placeholder box", fallback: "" },
          ],
          fields: [
            { key: "home_ora_kicker", label: "Kicker", fallback: "GLS Ora Community" },
            { key: "home_ora_heading", label: "Heading", fallback: "Your table is waiting." },
            { key: "home_ora_lead", label: "Main Paragraph", type: "textarea", fallback: "At GLS Ora Community, there's room to do more than grab a meal and leave. Come for lunch. Bring the family. Take someone out. Sit down, order what you like and we bring it to your table. Take your time." },
            { key: "home_ora_pull", label: "Highlighted Quote", fallback: "Some meals are better with someone. Bring your person to GLS Ora." },
          ],
        },
        {
          title: "Customer Review & Branches Heading",
          desc: "Testimonial quote and the bottom branch intro.",
          fields: [
            { key: "home_review_kicker", label: "Review Kicker", fallback: "Don't take our word for it" },
            { key: "home_review_quote", label: "Featured Review Quote", type: "textarea", fallback: "“Really great place to eat if you're in Epe, with affordable prices too!”" },
            { key: "home_review_source", label: "Review Count Label", fallback: "Google · 43 reviews" },
            { key: "home_review_url", label: "See More Reviews URL", fallback: "https://www.google.com/search?q=GLS+Kitchen+and+Bakery+Epe" },
            { key: "home_visit_kicker", label: "Branches Kicker", fallback: "Visit us" },
            { key: "home_visit_heading", label: "Branches Heading", fallback: "One GLS. Two places to find it." },
          ],
        },
      ],
    },
    {
      id: "menu",
      label: "Menu & Bakery",
      sections: [
        {
          title: "Menu Page Header & Intro",
          desc: "Top banner and intro copy on menu.html.",
          images: [
            { key: "menu_banner_img", label: "Menu Header Banner", fallback: "img/kitchen-pots.webp" },
          ],
          fields: [
            { key: "menu_kicker", label: "Header Kicker", fallback: "Same menu, same prices at both branches" },
            { key: "menu_heading", label: "Header Title", fallback: "The GLS Menu" },
            { key: "menu_kitchen_lead", label: "Kitchen Tab Intro", type: "textarea", fallback: "Rice, swallow, sides and soups are priced per portion, so you build the plate you want." },
            { key: "menu_bakery_lead", label: "Bakery Tab Intro", type: "textarea", fallback: "Fresh from the GLS Bakery. Pick something up for breakfast, take a loaf home, or come in because you smelled something good." },
            { key: "menu_cta_title", label: "Bottom Callout Title", fallback: "Ready to eat?" },
            { key: "menu_cta_sub", label: "Bottom Callout Subtitle", fallback: "Call Poka or Ora Community to order or check what's available today." },
          ],
        },
        {
          title: "Bakery Showcase Items",
          desc: "All three bakery cards currently show 'Photo to come' — upload photos here to replace them.",
          images: [
            { key: "bakery_item1_img", label: "Item 1 Photo (Sardine Bread)", fallback: "" },
            { key: "bakery_item2_img", label: "Item 2 Photo (Sliced Bread)", fallback: "" },
            { key: "bakery_item3_img", label: "Item 3 Photo (Meat Pie)", fallback: "" },
          ],
          fields: [
            { key: "bakery_item1_name", label: "Item 1 Name", fallback: "Sardine Bread" },
            { key: "bakery_item1_price", label: "Item 1 Price", fallback: "₦2,500" },
            { key: "bakery_item2_name", label: "Item 2 Name", fallback: "Sliced Bread" },
            { key: "bakery_item2_price", label: "Item 2 Price", fallback: "₦1,500" },
            { key: "bakery_item3_name", label: "Item 3 Name", fallback: "Meat Pie" },
            { key: "bakery_item3_price", label: "Item 3 Price", fallback: "₦1,000" },
          ],
        },
      ],
    },
    {
      id: "celebrations",
      label: "Celebrations",
      sections: [
        {
          title: "Header & How We Help",
          desc: "Banner and the three cards on celebrations.html.",
          images: [
            { key: "celeb_banner_img", label: "Page Header Banner", fallback: "img/cake-2.webp" },
            { key: "celeb_card1_img", label: "Card 1 Photo (The space)", fallback: "img/ora-booths.webp" },
            { key: "celeb_card2_img", label: "Card 2 Photo (The food)", fallback: "img/kitchen-pots.webp" },
            { key: "celeb_card3_img", label: "Card 3 Photo (The cake)", fallback: "img/bake-cake.webp" },
          ],
          fields: [
            { key: "celeb_kicker", label: "Header Kicker", fallback: "Celebrations" },
            { key: "celeb_heading", label: "Header Title", fallback: "Birthdays. Family dinners. Big moments. Small ones." },
            { key: "celeb_sub", label: "Header Subtitle", type: "textarea", fallback: "Whatever you're celebrating, food usually ends up in the middle of the table. GLS can help with all of it." },
            { key: "celeb_help_kicker", label: "Section Kicker", fallback: "How we help" },
            { key: "celeb_help_heading", label: "Section Heading", fallback: "The space, the food and the cake." },
            { key: "celeb_card1_title", label: "Card 1 Title", fallback: "A table at Ora" },
            { key: "celeb_card1_desc", label: "Card 1 Description", type: "textarea", fallback: "Booths for two, tables for the family, and room for a small group. We can set up your table for the occasion. Tell us how many are coming." },
            { key: "celeb_card2_title", label: "Card 2 Title", fallback: "Food for the table" },
            { key: "celeb_card2_desc", label: "Card 2 Description", type: "textarea", fallback: "Plates from our menu, or party portions: soups and stews by the litre, seafood okra bowls and small chops." },
            { key: "celeb_card3_title", label: "Card 3 Title", fallback: "A cake for the day" },
            { key: "celeb_card3_desc", label: "Card 3 Description", type: "textarea", fallback: "Custom cakes from the GLS Bakery, made to your design, with your message on top." },
          ],
        },
        {
          title: "Cake Gallery & Planning Steps",
          desc: "Slots 3 and 4 are currently 'Photo to come' — upload cake photos to fill them.",
          images: [
            { key: "celeb_cake1_img", label: "Cake Gallery 1", fallback: "img/bake-cake.webp" },
            { key: "celeb_cake2_img", label: "Cake Gallery 2", fallback: "img/cake-2.webp" },
            { key: "celeb_cake3_img", label: "Cake Gallery 3 (Photo to come)", fallback: "" },
            { key: "celeb_cake4_img", label: "Cake Gallery 4 (Photo to come)", fallback: "" },
          ],
          fields: [
            { key: "celeb_cakes_kicker", label: "Gallery Kicker", fallback: "From our bakery" },
            { key: "celeb_cakes_heading", label: "Gallery Heading", fallback: "Cakes for the moment." },
            { key: "celeb_plan_heading", label: "Steps Heading", fallback: "Tell us what you're planning." },
            { key: "celeb_plan_sub", label: "Steps Subtitle", fallback: "We'll help you put it together." },
            { key: "celeb_step1", label: "Step 01", fallback: "Call GLS Ora. Tell us the date, the occasion and how many guests." },
            { key: "celeb_step2", label: "Step 02", fallback: "Choose your food, your cake design and how you want the table set up." },
            { key: "celeb_step3", label: "Step 03", fallback: "Arrive. Your table is set and your food is served to you." },
          ],
        },
      ],
    },
    {
      id: "story",
      label: "Our Story",
      sections: [
        {
          title: "Story Content & Video",
          desc: "Paste any YouTube link below to replace the 'Video to come' placeholder.",
          images: [
            { key: "story_banner_img", label: "Story Header Banner", fallback: "img/team.webp" },
            { key: "story_main_img", label: "Story Side Photo", fallback: "img/ora-exterior.webp" },
          ],
          fields: [
            { key: "story_kicker", label: "Header Kicker", fallback: "Our story" },
            { key: "story_heading", label: "Header Title", fallback: "It started with a kitchen in Poka." },
            { key: "story_body", label: "Story Paragraph", type: "textarea", fallback: "GLS opened in 2018 with a simple idea: serve good food, bake fresh bread and create a place people are happy to return to. Today there are two GLS locations, and the idea hasn't changed." },
            { key: "story_pull", label: "Pull Quote", type: "textarea", fallback: "Good food should bring people together. And a meal doesn't need an occasion to be worth enjoying." },
            { key: "story_film_kicker", label: "Film Section Kicker", fallback: "Our story on film" },
            { key: "story_film_heading", label: "Film Section Heading", fallback: "Coming soon." },
            { key: "story_youtube_url", label: "YouTube Video URL", fallback: "", hint: "e.g. https://www.youtube.com/watch?v=... — leave blank to keep placeholder" },
          ],
        },
      ],
    },
    {
      id: "visit",
      label: "Visit & Branches",
      sections: [
        {
          title: "Visit Page Header & Bottom Banner",
          desc: "Shared across the Visit page and Home branch cards.",
          images: [
            { key: "visit_banner_img", label: "Visit Page Header Banner", fallback: "img/ora-exterior.webp" },
            { key: "branch_ora_img", label: "GLS Ora Community Exterior Photo", fallback: "img/ora-exterior.webp" },
            { key: "branch_poka_img", label: "GLS Poka Shopfront Photo (currently 'Photo to come')", hint: "Updates both Home and Visit Us pages", fallback: "" },
          ],
          fields: [
            { key: "visit_kicker", label: "Header Kicker", fallback: "Visit us" },
            { key: "visit_heading", label: "Header Title", fallback: "Two locations. One GLS." },
            { key: "visit_sub", label: "Header Subtitle", fallback: "Same menu at both. Call either branch to order or plan your visit." },
            { key: "visit_band_heading", label: "Bottom Banner Heading", fallback: "Good food is better when there's someone to share it with." },
            { key: "visit_band_sub", label: "Bottom Banner Subtext", fallback: "Come hungry. We'll take care of the rest." },
          ],
        },
        {
          title: "GLS Ora Community Details",
          desc: "Updates Home, Visit Us, Footer and Call buttons everywhere.",
          fields: [
            { key: "ora_name", label: "Branch Name", fallback: "GLS Ora Community" },
            { key: "ora_kicker", label: "Branch Tag", fallback: "Our newest home" },
            { key: "ora_note", label: "Short Description", fallback: "More space to sit, eat, meet and make a moment of it." },
            { key: "ora_address", label: "Full Address (Visit page)", fallback: "Odoshiwola Junction, Epe-Ijebu Ode Road, Epe, Lagos" },
            { key: "ora_short_address", label: "Short Address (Footer)", fallback: "Odoshiwola Junction, Epe" },
            { key: "ora_hours", label: "Opening Hours", fallback: "To be confirmed" },
            { key: "ora_phone", label: "Phone Number", fallback: "0906 396 9745" },
            { key: "ora_extra", label: "Extra Note", fallback: "Also at this location: GLS Autocare, with an automated car wash, EV charging and a service centre." },
            { key: "ora_maps_url", label: "Google Maps URL", fallback: "https://www.google.com/maps/search/GLS+Kitchen+%26+Bakery+Ora+Community+Epe" },
          ],
        },
        {
          title: "GLS Poka Details",
          desc: "Updates Home, Visit Us, Footer and Call buttons everywhere.",
          fields: [
            { key: "poka_name", label: "Branch Name", fallback: "GLS Poka" },
            { key: "poka_kicker", label: "Branch Tag", fallback: "Where GLS began" },
            { key: "poka_note", label: "Short Description", fallback: "Everyday meals, fresh bread and the food you already know." },
            { key: "poka_address", label: "Full Address (Visit page)", fallback: "Poka, beside Foltar Filling Station, Epe-Ijebu Ode Road, Epe 106101, Lagos" },
            { key: "poka_short_address", label: "Short Address (Footer)", fallback: "Beside Foltar Filling Station, Epe-Ijebu Ode Road, Poka, Epe" },
            { key: "poka_hours", label: "Opening Hours", fallback: "To be confirmed" },
            { key: "poka_phone", label: "Phone Number", fallback: "0810 561 5458" },
            { key: "poka_maps_url", label: "Google Maps URL", fallback: "https://www.google.com/maps/search/?api=1&query=6.6167567,3.9862417" },
          ],
        },
      ],
    },
    {
      id: "shared",
      label: "Logo, Footer & Social",
      sections: [
        {
          title: "Brand & Footer",
          desc: "Shared across every page on the website.",
          images: [
            { key: "site_logo", label: "Site Logo", hint: "Shown in the header and footer of all pages", fallback: "img/logo.png" },
          ],
          fields: [
            { key: "footer_tagline", label: "Footer Tagline", fallback: "GLS makes every moment worth sharing." },
            { key: "footer_copyright", label: "Copyright Line", fallback: "© 2026 GLS Kitchen & Bakery · Poka · Ora Community · Epe, Lagos" },
            { key: "social_instagram", label: "Instagram URL", fallback: "https://www.instagram.com/glskitchen_epe/" },
            { key: "social_facebook", label: "Facebook URL", fallback: "https://www.facebook.com/search/top?q=GLS%20Kitchen%20and%20Bakery%20Epe" },
            { key: "social_tiktok", label: "TikTok URL", fallback: "" },
          ],
        },
      ],
    },
  ];

  let saved = {};
  let draft = {};
  let activeTab = SCHEMA[0].id;
  let saving = false;

  const loginView = document.getElementById("loginView");
  const appView = document.getElementById("appView");
  const loginForm = document.getElementById("loginForm");
  const loginErr = document.getElementById("loginErr");
  const loginBtn = document.getElementById("loginBtn");
  const whoLabel = document.getElementById("whoLabel");
  const tabBar = document.getElementById("tabBar");
  const editorRoot = document.getElementById("editorRoot");
  const saveBar = document.getElementById("saveBar");
  const dirtyLabel = document.getElementById("dirtyLabel");
  const topSaveBtn = document.getElementById("topSaveBtn");
  const barSaveBtn = document.getElementById("barSaveBtn");
  const discardBtn = document.getElementById("discardBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const toastEl = document.getElementById("toast");

  let toastTimer = null;
  function showToast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.className = "toast show" + (isError ? " error" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3200);
  }

  function changedKeys() {
    const keys = new Set([...Object.keys(saved), ...Object.keys(draft)]);
    const diff = [];
    keys.forEach((k) => {
      if ((saved[k] || "") !== (draft[k] || "")) diff.push(k);
    });
    return diff;
  }

  function updateDirtyUI() {
    const count = changedKeys().length;
    saveBar.classList.toggle("show", count > 0);
    dirtyLabel.textContent =
      count === 1
        ? "1 unsaved change."
        : count + " unsaved changes.";
  }

  function setValue(key, val) {
    const cleaned = typeof val === "string" ? val.trim() : "";
    if (cleaned) draft[key] = cleaned;
    else delete draft[key];
    updateDirtyUI();
  }

  function renderTabs() {
    tabBar.innerHTML = "";
    SCHEMA.forEach((tab) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = tab.label;
      if (tab.id === activeTab) btn.className = "on";
      btn.onclick = () => {
        activeTab = tab.id;
        renderTabs();
        renderEditor();
      };
      tabBar.appendChild(btn);
    });
  }

  function renderImageCard(slot) {
    const card = document.createElement("div");
    card.className = "img-card";

    const currentUrl = draft[slot.key] || slot.fallback || "";
    const isCustom = Boolean(draft[slot.key]);

    const preview = document.createElement("div");
    preview.className = "img-preview";
    if (currentUrl) {
      const img = document.createElement("img");
      img.src = currentUrl;
      img.alt = slot.label;
      preview.appendChild(img);
    } else {
      preview.textContent = "Photo to come (no image yet)";
    }
    card.appendChild(preview);

    const meta = document.createElement("div");
    meta.className = "img-meta";

    const title = document.createElement("b");
    title.textContent = slot.label;
    if (isCustom) {
      const badge = document.createElement("span");
      badge.className = "badge-custom";
      badge.textContent = "R2";
      title.appendChild(badge);
    }
    meta.appendChild(title);

    if (slot.hint) {
      const hint = document.createElement("span");
      hint.textContent = slot.hint;
      meta.appendChild(hint);
    }

    const btns = document.createElement("div");
    btns.className = "img-btns";

    const uploadLabel = document.createElement("label");
    uploadLabel.className = "btn btn-forest btn-sm";
    uploadLabel.textContent = "Upload Photo";

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp,image/gif,image/avif";
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const overlay = document.createElement("div");
      overlay.className = "uploading";
      overlay.textContent = "Uploading to R2…";
      preview.appendChild(overlay);
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("slot", slot.key);
        const res = await fetch("/api/cms/upload", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok || !data.url) {
          throw new Error(data.error || "Upload failed");
        }
        setValue(slot.key, data.url);
        renderEditor();
        showToast("Photo uploaded to R2. Click Save Changes to publish.");
      } catch (err) {
        overlay.remove();
        showToast(err instanceof Error ? err.message : "Upload failed", true);
      } finally {
        input.value = "";
      }
    };
    uploadLabel.appendChild(input);
    btns.appendChild(uploadLabel);

    if (isCustom) {
      const resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "btn btn-out btn-sm";
      resetBtn.textContent = "Reset";
      resetBtn.onclick = () => {
        setValue(slot.key, "");
        renderEditor();
      };
      btns.appendChild(resetBtn);
    }

    meta.appendChild(btns);
    card.appendChild(meta);
    return card;
  }

  function renderTextField(field) {
    const wrap = document.createElement("div");
    wrap.className = "field";

    const head = document.createElement("div");
    head.className = "field-head";

    const label = document.createElement("label");
    label.setAttribute("for", "f_" + field.key);
    label.textContent = field.label;
    if (draft[field.key]) {
      const badge = document.createElement("span");
      badge.className = "badge-custom";
      badge.textContent = "Edited";
      label.appendChild(badge);
    }
    head.appendChild(label);

    if (draft[field.key]) {
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "reset-link";
      reset.textContent = "Reset to default";
      reset.onclick = () => {
        setValue(field.key, "");
        renderEditor();
      };
      head.appendChild(reset);
    }
    wrap.appendChild(head);

    const input = document.createElement(field.type === "textarea" ? "textarea" : "input");
    input.id = "f_" + field.key;
    input.value = draft[field.key] || "";
    input.placeholder = field.fallback || "(empty)";
    input.oninput = () => {
      const val = input.value;
      if (val.trim() && val.trim() !== field.fallback) {
        draft[field.key] = val.trim();
      } else {
        delete draft[field.key];
      }
      updateDirtyUI();
    };
    wrap.appendChild(input);

    if (field.hint) {
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = field.hint;
      wrap.appendChild(hint);
    }

    return wrap;
  }

  function renderEditor() {
    const tab = SCHEMA.find((t) => t.id === activeTab) || SCHEMA[0];
    editorRoot.innerHTML = "";
    tab.sections.forEach((sec) => {
      const card = document.createElement("section");
      card.className = "section-card";

      const h2 = document.createElement("h2");
      h2.textContent = sec.title;
      card.appendChild(h2);

      if (sec.desc) {
        const p = document.createElement("p");
        p.className = "desc";
        p.textContent = sec.desc;
        card.appendChild(p);
      }

      if (sec.images && sec.images.length) {
        const imgGrid = document.createElement("div");
        imgGrid.className = "grid-img";
        imgGrid.style.marginBottom = sec.fields && sec.fields.length ? "1.5rem" : "0";
        sec.images.forEach((slot) => imgGrid.appendChild(renderImageCard(slot)));
        card.appendChild(imgGrid);
      }

      if (sec.fields && sec.fields.length) {
        const fieldGrid = document.createElement("div");
        fieldGrid.className = "grid-2";
        sec.fields.forEach((f) => fieldGrid.appendChild(renderTextField(f)));
        card.appendChild(fieldGrid);
      }

      editorRoot.appendChild(card);
    });
  }

  async function saveChanges() {
    if (saving) return;
    saving = true;
    topSaveBtn.disabled = true;
    barSaveBtn.disabled = true;
    topSaveBtn.textContent = "Saving…";
    barSaveBtn.textContent = "Saving…";
    try {
      const res = await fetch("/api/cms/content", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save changes.");
      saved = { ...draft };
      updateDirtyUI();
      renderEditor();
      showToast("Saved! Your changes are live on the website.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Save failed", true);
    } finally {
      saving = false;
      topSaveBtn.disabled = false;
      barSaveBtn.disabled = false;
      topSaveBtn.textContent = "Save Changes";
      barSaveBtn.textContent = "Save Changes";
    }
  }

  async function loadContent() {
    const res = await fetch("/api/cms/content", { cache: "no-cache" });
    const data = res.ok ? await res.json() : {};
    saved = data && typeof data === "object" ? { ...data } : {};
    draft = { ...saved };
    renderTabs();
    renderEditor();
    updateDirtyUI();
  }

  function showApp(user) {
    whoLabel.textContent = "Signed in as " + user;
    loginView.style.display = "none";
    appView.classList.add("show");
  }

  function showLogin() {
    appView.classList.remove("show");
    loginView.style.display = "grid";
  }

  loginForm.onsubmit = async (e) => {
    e.preventDefault();
    loginErr.classList.remove("show");
    loginBtn.disabled = true;
    loginBtn.textContent = "Signing in…";
    try {
      const username = document.getElementById("u").value.trim();
      const password = document.getElementById("p").value;
      const res = await fetch("/api/cms/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sign in failed.");
      document.getElementById("p").value = "";
      showApp(data.user || username);
      await loadContent();
    } catch (err) {
      loginErr.textContent = err instanceof Error ? err.message : "Sign in failed.";
      loginErr.classList.add("show");
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = "Sign In";
    }
  };

  topSaveBtn.onclick = saveChanges;
  barSaveBtn.onclick = saveChanges;
  discardBtn.onclick = () => {
    draft = { ...saved };
    renderEditor();
    updateDirtyUI();
    showToast("Unsaved changes discarded.");
  };
  logoutBtn.onclick = async () => {
    await fetch("/api/cms/logout", { method: "POST" }).catch(() => {});
    showLogin();
  };

  // Boot: check existing session
  fetch("/api/cms/me", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : { authenticated: false }))
    .then((me) => {
      if (me && me.authenticated) {
        showApp(me.user || "admin");
        return loadContent();
      }
      showLogin();
    })
    .catch(() => showLogin());
})();
