/**
 * Lightweight runtime loader for GLS Website CMS overrides.
 *
 * Fetches `/api/cms/content` (stored in Cloudflare R2) and updates any element
 * marked with `data-cms*` attributes. If nothing has been customised or the
 * endpoint is unavailable, the static HTML defaults remain untouched.
 */
(function () {
  function safeUrl(raw) {
    if (typeof raw !== "string") return "";
    const u = raw.trim();
    if (!u) return "";
    if (
      u.startsWith("/") ||
      u.startsWith("img/") ||
      u.startsWith("https://") ||
      u.startsWith("http://") ||
      u.startsWith("tel:") ||
      u.startsWith("mailto:")
    ) {
      return u;
    }
    return "";
  }

  function toYouTubeEmbed(raw) {
    if (typeof raw !== "string") return "";
    const u = raw.trim();
    if (!u) return "";
    let id = "";
    const m1 = u.match(/(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/);
    if (m1) id = m1[1];
    return id ? "https://www.youtube-nocookie.com/embed/" + id : "";
  }

  function applyContent(data) {
    if (!data || typeof data !== "object") return;

    // Text overrides
    document.querySelectorAll("[data-cms]").forEach(function (el) {
      const key = el.getAttribute("data-cms");
      if (key && typeof data[key] === "string" && data[key].trim()) {
        el.textContent = data[key];
      }
    });

    // Image overrides (supports both <img> and .ph placeholder boxes)
    document.querySelectorAll("[data-cms-img]").forEach(function (el) {
      const key = el.getAttribute("data-cms-img");
      const url = key ? safeUrl(data[key]) : "";
      if (!url) return;

      if (el.tagName === "IMG") {
        el.setAttribute("src", url);
      } else {
        // Placeholder div (.ph) -> convert into a real .pic with <img>
        const alt = el.getAttribute("data-cms-alt") || "GLS Kitchen & Bakery";
        el.classList.remove("ph");
        el.classList.add("pic");
        el.innerHTML = "";
        const img = document.createElement("img");
        img.src = url;
        img.alt = alt;
        el.appendChild(img);
      }
    });

    // Page-header background images
    document.querySelectorAll("[data-cms-bg]").forEach(function (el) {
      const key = el.getAttribute("data-cms-bg");
      const url = key ? safeUrl(data[key]) : "";
      if (url) {
        el.style.backgroundImage = 'url("' + url.replace(/"/g, "") + '")';
      }
    });

    // Hero ::before background image via CSS custom property
    document.querySelectorAll("[data-cms-hero-bg]").forEach(function (el) {
      const key = el.getAttribute("data-cms-hero-bg");
      const url = key ? safeUrl(data[key]) : "";
      if (url) {
        el.style.setProperty("--hero-img", 'url("' + url.replace(/"/g, "") + '")');
      }
    });

    // Link href overrides (social links, Google Maps, etc.)
    document.querySelectorAll("[data-cms-href]").forEach(function (el) {
      const key = el.getAttribute("data-cms-href");
      const url = key ? safeUrl(data[key]) : "";
      if (url) {
        el.setAttribute("href", url);
      }
    });

    // Phone tel: href overrides (normalizes "0906 396 9745" -> "tel:+2349063969745")
    document.querySelectorAll("[data-cms-tel]").forEach(function (el) {
      const key = el.getAttribute("data-cms-tel");
      const val = key && typeof data[key] === "string" ? data[key].trim() : "";
      if (!val) return;
      const digits = val.replace(/[^0-9+]/g, "");
      if (!digits) return;
      const href = digits.startsWith("+")
        ? "tel:" + digits
        : digits.startsWith("0")
          ? "tel:+234" + digits.slice(1)
          : "tel:+" + digits;
      el.setAttribute("href", href);
    });

    // YouTube video embed override (Story page)
    document.querySelectorAll("[data-cms-video]").forEach(function (el) {
      const key = el.getAttribute("data-cms-video");
      const embed = key ? toYouTubeEmbed(data[key]) : "";
      if (!embed) return;
      el.innerHTML = "";
      const iframe = document.createElement("iframe");
      iframe.src = embed;
      iframe.title = "GLS Kitchen & Bakery Story";
      iframe.style.width = "100%";
      iframe.style.height = "100%";
      iframe.style.border = "0";
      iframe.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture");
      iframe.setAttribute("allowfullscreen", "");
      el.appendChild(iframe);
    });
  }

  fetch("/api/cms/content", { cache: "no-cache" })
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(applyContent)
    .catch(function () {
      // Offline or local dev without Worker: keep static defaults.
    });
})();
