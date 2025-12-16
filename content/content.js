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

function logProductPageStatus() {
  if (isProductPage(window.location.href, { detectCategory: true })) {
    console.log("✅ Product page detected!");
    detectCartActions();
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
