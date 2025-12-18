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
    candles: ["candle", "scented", "soy candle", "wax"]
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

  // 3) Description / feature bullets
  // - #feature-bullets is very common and contains key product descriptors
  // - #productDescription sometimes exists for a longer paragraph
  const descriptionText =
    textFrom("#feature-bullets") || textFrom("#productDescription") || "";

  // Combine signals into one searchable blob.
  // Lowercasing keeps keyword matching simple.
  const haystack = `${titleText}\n${breadcrumbText}\n${descriptionText}`.toLowerCase();

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
function createModal() {
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

  const alternativeUrl =
    "https://www.amazon.com/BLK-Bold-Keurig-Premium-Arabica/dp/B0B6GQNMHC/";

  const category = getProductCategory();
  const footerInfoText =
    category !== "unknown"
      ? `💡 Supporting Black-owned businesses in ${category}`
      : "💡 Discover quality alternatives from Black-owned businesses";

  // Placeholder content for now (we'll replace this with real alternative listings later).
  container.innerHTML = `
    <div class="bbd-modal-header">
      <div class="bbd-modal-header-left">
        <div class="bbd-modal-icon" aria-hidden="true">🎯</div>
        <div class="bbd-modal-headline">Black-Owned Alternative Found!</div>
      </div>

      <button class="bbd-modal-close" type="button" aria-label="Close">&times;</button>
    </div>

    <div class="bbd-modal-body">
      <div class="bbd-product-card">
        <img
          class="bbd-product-image"
          src="https://via.placeholder.com/120"
          alt="Alternative product image"
        />

        <div class="bbd-product-info">
          <div class="bbd-product-title">BLK &amp; Bold Premium Coffee K-Cups, 40 Count</div>
          <div class="bbd-product-brand">By: BLK &amp; Bold</div>
          <div class="bbd-product-price">$26.99</div>
          <div class="bbd-product-rating">⭐⭐⭐⭐⭐ (2,847)</div>
          <div class="bbd-product-badge">🏷️ Black-Owned Business</div>
        </div>
      </div>

      <div class="bbd-cta">
        <button class="bbd-cta-primary" type="button">Shop This Alternative</button>
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
    window.open(alternativeUrl, "_blank");
    closeModal();
  });

  secondaryCtaBtn?.addEventListener("click", closeModal);
}

function logProductPageStatus() {
  if (isProductPage(window.location.href, { detectCategory: true })) {
    console.log("✅ Product page detected!");
    detectCartActions();

    // For testing: show the modal 1 second after page load.
    // (Later we'll show it based on detecting alternatives, toolbar action, etc.)
    window.setTimeout(() => {
      // Double-check we're still on a product page at display time.
      if (isProductPage()) createModal();
    }, 1000);
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
