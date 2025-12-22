/**
 * Returns true if the current URL looks like an Amazon product detail page.
 *
 * Amazon product pages commonly look like:
 * - https://www.amazon.com/dp/B08N5WRWNW
 * - https://www.amazon.com/gp/product/B08N5WRWNW
 * - https://www.amazon.com/Some-Product-Name/dp/B08N5WRWNW
 */
function isProductPage(urlString = window.location.href, { detectCategory = false } = {}) {
  let url;

  try {
    url = new URL(urlString);
  } catch {
    // If the URL can't be parsed, treat it as not a product page.
    return false;
  }

  // Ensure we're on an amazon.com host (www.amazon.com, smile.amazon.com, etc.)
  // If you later want other Amazon TLDs (amazon.co.uk, amazon.ca, etc.), expand this.
  if (!/(^|\.)amazon\.com$/i.test(url.hostname)) return false;

  const path = url.pathname;

  // Explicitly exclude common non-product areas so we don't accidentally match.
  // (This list isn't exhaustive, but covers the main ones you asked about.)
  const excludedPrefixes = [
    "/s", // search results
    "/gp/cart", // cart
    "/cart", // cart (sometimes appears)
    "/gp/buy", // checkout flow
    "/checkout" // checkout
  ];

  // Home page: "/"
  if (path === "/") return false;
  if (excludedPrefixes.some((prefix) => path.startsWith(prefix))) return false;

  // Product pages typically include an ASIN (10 characters, letters/numbers).
  // We match two main patterns:
  // - /dp/ASIN
  // - /gp/product/ASIN
  const dpPattern = /\/dp\/([A-Z0-9]{10})(?:[/?]|$)/i;
  const gpProductPattern = /\/gp\/product\/([A-Z0-9]{10})(?:[/?]|$)/i;

  const isProduct = dpPattern.test(path) || gpProductPattern.test(path);

  // Optional: when you're on a product page, also detect category from page text.
  // Keeping this optional lets you reuse isProductPage() purely as a URL check.
  if (isProduct && detectCategory) {
    const category = getProductCategory();
    console.log(`Category detected: ${category}`);
  }

  return isProduct;
}

/**
 * Tries to infer the product category from page text.
 *
 * We use multiple sources because Amazon pages vary:
 * - Title: usually #productTitle
 * - Breadcrumbs: category/navigation links near the top
 * - Description: feature bullets + product description blocks
 */
function getProductCategory() {
  // Keyword lists (lowercase). Keep these small and easy to tweak.
  const keywordSets = {
    coffee: ["coffee", "espresso", "k-cup", "keurig", "beans"],
    candles: ["candle", "candles", "scented", "soy candle", "soy", "fragrance"]
  };

  // Helper: safely grab visible text content from a selector.
  const textFrom = (selector) => {
    const el = document.querySelector(selector);
    return el?.textContent ? el.textContent.trim() : "";
  };

  // 1) Product title
  const titleText = textFrom("#productTitle") || textFrom("h1#title") || "";

  // 2) Breadcrumbs / navigation (Amazon uses a few variations)
  // Common containers: #wayfinding-breadcrumbs_container, #wayfinding-breadcrumbs_feature_div
  // We also look for obvious breadcrumb-like links.
  const breadcrumbText =
    textFrom("#wayfinding-breadcrumbs_container") ||
    textFrom("#wayfinding-breadcrumbs_feature_div") ||
    textFrom(".a-breadcrumb") ||
    "";

  // Combine ONLY high-signal category cues.
  // Breadcrumbs are useful, but feature bullets/description can include unrelated content
  // (recommendations, promos, etc.) that can cause false positives.
  const haystack = `${titleText}\n${breadcrumbText}`.toLowerCase();

  // Score each category by counting how many keywords appear.
  const scoreCategory = (keywords) =>
    keywords.reduce((score, kw) => (haystack.includes(kw) ? score + 1 : score), 0);

  const coffeeScore = scoreCategory(keywordSets.coffee);
  const candleScore = scoreCategory(keywordSets.candles);

  if (coffeeScore === 0 && candleScore === 0) return "unknown";
  if (coffeeScore > candleScore) return "coffee";
  if (candleScore > coffeeScore) return "candles";

  // Tie-breaker: prefer title matches if both categories score equally.
  const titleLower = titleText.toLowerCase();
  const coffeeInTitle = keywordSets.coffee.some((kw) => titleLower.includes(kw));
  const candlesInTitle = keywordSets.candles.some((kw) => titleLower.includes(kw));
  if (coffeeInTitle && !candlesInTitle) return "coffee";
  if (candlesInTitle && !coffeeInTitle) return "candles";

  return "unknown";
}

function isValidAmazonProductUrl(urlString) {
  try {
    const url = new URL(urlString);
    if (!/(^|\.)amazon\.com$/i.test(url.hostname)) return false;
    return /^\/dp\/[A-Z0-9]{10}(?:[/?]|$)/i.test(url.pathname) ||
      /^\/gp\/product\/[A-Z0-9]{10}(?:[/?]|$)/i.test(url.pathname) ||
      /\/dp\/[A-Z0-9]{10}(?:[/?]|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}

function isValidAmazonImageUrl(urlString) {
  try {
    const url = new URL(urlString);
    return /(^|\.)m\.media-amazon\.com$/i.test(url.hostname) && url.protocol === "https:";
  } catch {
    return false;
  }
}

function validateBusinessesData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("businesses.json must be an object with a 'products' array");
  }

  const products = data.products;
  if (!Array.isArray(products)) {
    throw new Error("businesses.json missing required 'products' array");
  }

  const requiredFields = [
    "id",
    "name",
    "brand",
    "category",
    "price",
    "rating",
    "reviewCount",
    "imageUrl",
    "productUrl"
  ];

  const allowedCategories = new Set(["coffee", "candles"]);
  const allowedAvailability = new Set(["in_stock", "out_of_stock"]);
  const seenIds = new Set();

  products.forEach((p, idx) => {
    if (!p || typeof p !== "object" || Array.isArray(p)) {
      throw new Error(`products[${idx}] must be an object`);
    }

    for (const field of requiredFields) {
      if (p[field] === undefined || p[field] === null || p[field] === "") {
        throw new Error(`products[${idx}] missing required field '${field}'`);
      }
    }

    if (typeof p.id !== "string") throw new Error(`products[${idx}].id must be a string`);
    if (seenIds.has(p.id)) throw new Error(`Duplicate product id '${p.id}'`);
    seenIds.add(p.id);

    if (typeof p.name !== "string") throw new Error(`products[${idx}].name must be a string`);
    if (typeof p.brand !== "string") throw new Error(`products[${idx}].brand must be a string`);

    if (typeof p.category !== "string" || !allowedCategories.has(p.category)) {
      throw new Error(`products[${idx}].category must be 'coffee' or 'candles'`);
    }

    if (typeof p.price !== "string" || !/^\$\d+(?:\.\d{2})?$/.test(p.price)) {
      throw new Error(`products[${idx}].price must be a string like '$26.99'`);
    }

    if (!Number.isInteger(p.rating) || p.rating < 1 || p.rating > 5) {
      throw new Error(`products[${idx}].rating must be an integer 1-5`);
    }

    if (typeof p.reviewCount !== "number" || !Number.isFinite(p.reviewCount) || p.reviewCount < 30) {
      throw new Error(`products[${idx}].reviewCount must be a number >= 30`);
    }

    if (p.availability !== undefined) {
      if (typeof p.availability !== "string" || !allowedAvailability.has(p.availability)) {
        throw new Error(`products[${idx}].availability must be 'in_stock' or 'out_of_stock' if provided`);
      }
    }

    if (typeof p.imageUrl !== "string" || !isValidAmazonImageUrl(p.imageUrl)) {
      throw new Error(`products[${idx}].imageUrl must be a valid Amazon image URL`);
    }

    if (typeof p.productUrl !== "string" || !isValidAmazonProductUrl(p.productUrl)) {
      throw new Error(`products[${idx}].productUrl must be a valid Amazon product URL`);
    }

    if (p.description !== undefined && typeof p.description !== "string") {
      throw new Error(`products[${idx}].description must be a string if provided`);
    }

    if (p.badges !== undefined) {
      if (!Array.isArray(p.badges) || !p.badges.every((b) => typeof b === "string" && b.trim().length > 0)) {
        throw new Error(`products[${idx}].badges must be an array of strings if provided`);
      }
    }

    if (p.amazonKeywords !== undefined) {
      if (!Array.isArray(p.amazonKeywords) || p.amazonKeywords.length < 3) {
        throw new Error(`products[${idx}].amazonKeywords must be an array with at least 3 keywords`);
      }
      if (!p.amazonKeywords.every((kw) => typeof kw === "string" && kw.trim().length > 0)) {
        throw new Error(`products[${idx}].amazonKeywords must only contain non-empty strings`);
      }
    }

    if (p.amazonCategories !== undefined) {
      if (!Array.isArray(p.amazonCategories) || !p.amazonCategories.every((c) => typeof c === "string" && c.trim().length > 0)) {
        throw new Error(`products[${idx}].amazonCategories must be an array of strings if provided`);
      }
    }
  });

  return products;
}

async function loadBusinessesProducts() {
  if (!chrome?.runtime?.getURL) {
    throw new Error("chrome.runtime.getURL not available (content script context required)");
  }

  const url = chrome.runtime.getURL("data/businesses.json");
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(
      `Failed to fetch businesses.json. Ensure it is listed in manifest.json web_accessible_resources. URL: ${url}. Underlying error: ${err?.message || String(err)}`
    );
  }
  if (!res.ok) {
    throw new Error(`Failed to load businesses.json: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return validateBusinessesData(data);
}

let productDatabasePromise = null;

function loadProductDatabase() {
  if (!productDatabasePromise) {
    productDatabasePromise = loadBusinessesProducts();
  }
  return productDatabasePromise;
}

function normalizeText(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[\u2019']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAmazonProduct() {
  const textFrom = (selector) => {
    const el = document.querySelector(selector);
    return el?.textContent ? el.textContent.trim() : "";
  };

  const title =
    textFrom("#productTitle") ||
    textFrom("h1#title") ||
    textFrom("h1") ||
    document.title.replace(/\s*:\s*Amazon\.com\s*$/i, "").trim();

  const breadcrumbText =
    textFrom("#wayfinding-breadcrumbs_feature_div") ||
    textFrom("#wayfinding-breadcrumbs_container") ||
    textFrom(".a-breadcrumb") ||
    "";

  const featureBullets = textFrom("#feature-bullets") || "";
  const description = textFrom("#productDescription") || "";

  const priceText =
    textFrom("#corePriceDisplay_desktop_feature_div .a-price .a-offscreen") ||
    textFrom("#corePrice_feature_div .a-price .a-offscreen") ||
    textFrom("#priceblock_ourprice") ||
    textFrom("#priceblock_dealprice") ||
    "";

  const category = getProductCategory();

  // IMPORTANT: exclude breadcrumbs from keyword matching to avoid generic breadcrumb text
  // (e.g., "Home & Kitchen") causing irrelevant matches.
  const combinedText = normalizeText(`${title}\n${featureBullets}\n${description}`);

  return {
    category,
    title: title.trim(),
    breadcrumbs: breadcrumbText.trim(),
    features: featureBullets.trim(),
    description: description.trim(),
    priceText: priceText.trim(),
    combinedText
  };
}

function scoreProduct(product, amazonInfo) {
  if (!product || !amazonInfo) return { score: 0, keywordMatches: 0, matchedKeywords: [] };

  const categoryMatches = amazonInfo.category === "unknown" || product.category === amazonInfo.category;
  if (!categoryMatches) return { score: 0, keywordMatches: 0, matchedKeywords: [] };

  const haystack = amazonInfo.combinedText;
  const keywords = Array.isArray(product.amazonKeywords) ? product.amazonKeywords : [];

  const matched = [];
  for (const kwRaw of keywords) {
    const kw = normalizeText(kwRaw);
    if (!kw) continue;
    if (haystack.includes(kw)) matched.push(kwRaw);
  }

  const keywordMatches = matched.length;
  let score = 0;

  // Generic terms like "coffee" or "candle" can appear in navigation, ads, or recommendations
  // on unrelated pages. We require at least one *non-generic* keyword match to consider a
  // product relevant.
  const genericKeywordSet = new Set(["coffee", "candle", "candles"]);
  const nonGenericKeywordMatches = matched.filter((kw) => !genericKeywordSet.has(normalizeText(kw))).length;

  // Minimum relevance gate:
  // - If we don't know the page category, we require stronger evidence (>= 2 keyword matches)
  //   to avoid surfacing unrelated products (e.g., balloons matching candles).
  // - If we do know the category, require at least 1 keyword match.
  const minKeywordMatches = amazonInfo.category === "unknown" ? 2 : 1;
  if (keywordMatches < minKeywordMatches || nonGenericKeywordMatches < 1) {
    return { score: 0, keywordMatches, matchedKeywords: matched };
  }

  score += (product.category === amazonInfo.category ? 60 : 20);
  score += keywordMatches * 12;

  if (product.rating >= 5) score += 10;
  else if (product.rating >= 4.5) score += 7;
  else if (product.rating >= 4.2) score += 4;
  else if (product.rating >= 4.0) score += 2;

  if (product.reviewCount >= 5000) score += 10;
  else if (product.reviewCount >= 1000) score += 7;
  else if (product.reviewCount >= 300) score += 4;
  else if (product.reviewCount >= 100) score += 2;

  return { score, keywordMatches, matchedKeywords: matched };
}

function matchProducts(amazonInfo, products, { limit = 3 } = {}) {
  const inStock = (products || []).filter((p) => p.availability !== "out_of_stock");

  const categoryPool = amazonInfo.category === "unknown"
    ? inStock
    : inStock.filter((p) => p.category === amazonInfo.category);

  const scored = categoryPool
    .map((p) => {
      const { score, keywordMatches, matchedKeywords } = scoreProduct(p, amazonInfo);
      return { product: p, score, keywordMatches, matchedKeywords };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.keywordMatches !== a.keywordMatches) return b.keywordMatches - a.keywordMatches;
      if (b.product.rating !== a.product.rating) return b.product.rating - a.product.rating;
      return b.product.reviewCount - a.product.reviewCount;
    });

  const top = scored.slice(0, limit);
  return { top, scored };
}

let cartActionsInitialized = false;
let lastCartActionAt = 0;

let modalInitialized = false;

/**
 * Sets up listeners that detect “Add to Cart” / “Buy Now” clicks on Amazon.
 *
 * Why event delegation?
 * - Amazon often injects/re-renders buttons after page load.
 * - Instead of adding listeners to the buttons directly (which may not exist yet),
 *   we attach ONE listener to `document` and check what was clicked.
 */
function detectCartActions() {
  if (cartActionsInitialized) return;
  cartActionsInitialized = true;

  const getProductTitle = () => {
    const titleEl = document.querySelector("#productTitle") || document.querySelector("h1#title");
    return titleEl?.textContent?.trim() || "(unknown title)";
  };

  // Capture phase means we see the interaction as early as possible in the event flow,
  // before many site handlers run (we still do NOT block anything).
  //
  // We listen to `pointerdown` (fires before `click`) so we can log even if Amazon
  // navigates immediately (e.g., Buy Now -> checkout).
  const handler = (event) => {
    if (!isProductPage()) return;

    // Prevent duplicate logs when both pointerdown and click fire for the same action.
    const now = Date.now();
    if (now - lastCartActionAt < 400) return;

    // `closest(...)` lets us detect clicks on nested elements inside the button,
    // like spans/icons inside the clickable control.
    const addToCartEl = event.target?.closest?.(
      "#add-to-cart-button, input[name=\"submit.add-to-cart\"]"
    );
    if (addToCartEl) {
      lastCartActionAt = now;
      console.log(`🛒 Add to Cart button clicked! (${getProductTitle()})`);
      return;
    }

    // Buy Now has a few variants depending on experiment/layout.
    const buyNowEl = event.target?.closest?.(
      "#buy-now-button, input[name=\"submit.buy-now\"], input[name=\"submit.buy-now\"]"
    );
    if (buyNowEl) {
      lastCartActionAt = now;
      console.log(`⚡ Buy Now button clicked! (${getProductTitle()})`);
    }
  };

  document.addEventListener("pointerdown", handler, true);
  document.addEventListener("click", handler, true);
}

/**
 * Injects a modal overlay into the current page.
 *
 * Notes:
 * - We inject into `document.body` so it sits above Amazon's content.
 * - The modal is `position: fixed` and uses a very high z-index, so it’s always on top.
 * - We do NOT implement close behavior yet (next user story).
 */
function createModal({ amazonInfo, matches } = {}) {
  if (modalInitialized) return;
  modalInitialized = true;

  // If the overlay already exists (e.g., due to SPA navigation), don't add another.
  if (document.getElementById("bbd-modal-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "bbd-modal-overlay";
  overlay.className = "bbd-modal-overlay";

  const container = document.createElement("div");
  container.className = "bbd-modal-container";
  container.setAttribute("role", "dialog");
  container.setAttribute("aria-modal", "true");

  const category = amazonInfo?.category || getProductCategory();
  const footerInfoText =
    category !== "unknown"
      ? `💡 Supporting Black-owned businesses in ${category}`
      : "💡 Discover quality alternatives from Black-owned businesses";

  const items = Array.isArray(matches) ? matches : [];
  const primary = items[0]?.product || null;
  const primaryUrl = primary?.productUrl || "https://www.amazon.com/";

  const productCardsHtml = items.length
    ? items
      .map(({ product }) => {
        const badges = Array.isArray(product.badges) && product.badges.length
          ? product.badges.map((b) => `<span class="bbd-product-badge">🏷️ ${b}</span>`).join(" ")
          : "";

        return `
          <div class="bbd-product-card">
            <img
              class="bbd-product-image"
              src="${product.imageUrl}"
              alt="Alternative product image"
            />
            <div class="bbd-product-info">
              <div class="bbd-product-title">${product.name}</div>
              <div class="bbd-product-brand">By: ${product.brand}</div>
              <div class="bbd-product-price">${product.price}</div>
              <div class="bbd-product-rating">${"⭐".repeat(product.rating)} (${product.reviewCount.toLocaleString()})</div>
              <div class="bbd-product-badges">${badges}</div>
            </div>
          </div>
        `;
      })
      .join("")
    : `
        <div class="bbd-product-card">
          <div class="bbd-product-info">
            <div class="bbd-product-title">No Black-owned alternatives found</div>
            <div class="bbd-product-brand">We’ll keep searching as we expand the database.</div>
          </div>
        </div>
      `;

  container.innerHTML = `
    <div class="bbd-modal-header">
      <div class="bbd-modal-header-left">
        <div class="bbd-modal-icon" aria-hidden="true">🎯</div>
        <div class="bbd-modal-headline">${items.length ? "Black-Owned Alternative Found!" : "No Alternative Found"}</div>
      </div>

      <button class="bbd-modal-close" type="button" aria-label="Close">&times;</button>
    </div>

    <div class="bbd-modal-body">
      ${productCardsHtml}

      <div class="bbd-cta">
        <button class="bbd-cta-primary" type="button" ${items.length ? "" : "disabled"}>Shop This Alternative</button>
        <button class="bbd-cta-secondary" type="button">Maybe Later</button>
      </div>

      <div class="bbd-modal-info">${footerInfoText}</div>
    </div>

    <div class="bbd-modal-footer">
      <button class="bbd-modal-footer-close" type="button">
        No, I’m not interested in supporting small business today
      </button>
    </div>
  `;

  overlay.appendChild(container);

  // Append at the end of <body> so it sits above the page.
  // We avoid touching Amazon's existing DOM structure.
  document.body.appendChild(overlay);

  // Trigger entrance animation.
  // We add the element in its initial hidden state, then on the next frame
  // we add the class that transitions it to the visible state.
  window.requestAnimationFrame(() => {
    overlay.classList.add("bbd-modal-show");
  });

  const closeModal = () => {
    const existingOverlay = document.getElementById("bbd-modal-overlay");
    if (!existingOverlay) return;

    // If we're already closing, do nothing.
    if (existingOverlay.classList.contains("bbd-modal-hide")) return;

    // Exit animation: remove the visible class and add the hide class
    // (hide class uses a faster duration and ease-in).
    existingOverlay.classList.add("bbd-modal-hide");
    existingOverlay.classList.remove("bbd-modal-show");

    const containerEl = existingOverlay.querySelector(".bbd-modal-container");
    const onDone = () => {
      existingOverlay.remove();
      modalInitialized = false;
    };

    // Clean up after the container finishes its transition (most reliable signal).
    if (containerEl) {
      containerEl.addEventListener("transitionend", onDone, { once: true });
    } else {
      // Fallback: remove after exit duration.
      window.setTimeout(onDone, 220);
    }
  };

  const closeBtn = overlay.querySelector(".bbd-modal-close");
  const footerCloseBtn = overlay.querySelector(".bbd-modal-footer-close");
  closeBtn?.addEventListener("click", closeModal);
  footerCloseBtn?.addEventListener("click", closeModal);

  const primaryCtaBtn = overlay.querySelector(".bbd-cta-primary");
  const secondaryCtaBtn = overlay.querySelector(".bbd-cta-secondary");

  primaryCtaBtn?.addEventListener("click", () => {
    if (!items.length) return;
    window.open(primaryUrl, "_blank");
    closeModal();
  });

  secondaryCtaBtn?.addEventListener("click", closeModal);
}

async function logProductPageStatus() {
  if (isProductPage(window.location.href, { detectCategory: true })) {
    console.log("✅ Product page detected!");
    detectCartActions();

    try {
      const products = await loadProductDatabase();
      const activeProducts = products.filter((p) => p.availability !== "out_of_stock");
      console.log(`✅ Loaded ${products.length} products (${activeProducts.length} in-stock, ${products.length - activeProducts.length} out-of-stock)`);

      const amazonInfo = extractAmazonProduct();
      console.log("🔎 Amazon product info:", {
        category: amazonInfo.category,
        title: amazonInfo.title,
        priceText: amazonInfo.priceText
      });

      const { top, scored } = matchProducts(amazonInfo, products, { limit: 3 });
      console.log(
        "🏁 Match results:",
        top.map((m) => ({
          id: m.product.id,
          name: m.product.name,
          score: m.score,
          keywordMatches: m.keywordMatches
        }))
      );

      if (scored.length) {
        console.log(
          "📊 Top scored (debug):",
          scored.slice(0, 10).map((m) => ({ id: m.product.id, score: m.score, keywordMatches: m.keywordMatches }))
        );
      }

      window.setTimeout(() => {
        if (!isProductPage()) return;
        createModal({ amazonInfo, matches: top });
      }, 1000);
      return;
    } catch (err) {
      console.error("❌ Invalid businesses.json:", err);
      return;
    }
  } else {
    console.log("❌ Not a product page");
  }
}

// Run once when the page loads.
// Content scripts are usually injected after navigation, but DOM readiness can vary.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", logProductPageStatus, { once: true });
} else {
  logProductPageStatus();
}
