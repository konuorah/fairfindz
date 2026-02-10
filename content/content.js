/**
 * Returns true if the current URL looks like an Amazon product detail page.
 *
 * Amazon product pages commonly look like:
 * - https://www.amazon.com/dp/B08N5WRWNW
 * - https://www.amazon.com/gp/product/B08N5WRWNW
 * - https://www.amazon.com/Some-Product-Name/dp/B08N5WRWNW
 */
try {
  globalThis.FairFindzContentScriptLoaded = true;
  globalThis.FairFindzContentScriptInjecting = false;
} catch {}

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
  const gpAwPattern = /\/gp\/aw\/d\/([A-Z0-9]{10})(?:[/?]|$)/i;

  const isProduct = dpPattern.test(path) || gpProductPattern.test(path) || gpAwPattern.test(path);

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
      /^\/gp\/aw\/d\/[A-Z0-9]{10}(?:[/?]|$)/i.test(url.pathname) ||
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
    "productUrl"
  ];

  // These fields are used as fallbacks. Live values can be hydrated from Amazon.
  const optionalFields = ["price", "rating", "reviewCount", "imageUrl"];
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

    for (const field of optionalFields) {
      if (p[field] === undefined || p[field] === null) {
        p[field] = field === "rating" || field === "reviewCount" ? 0 : "";
      }
    }

    if (typeof p.id !== "string") throw new Error(`products[${idx}].id must be a string`);
    if (seenIds.has(p.id)) throw new Error(`Duplicate product id '${p.id}'`);
    seenIds.add(p.id);

    if (typeof p.name !== "string") throw new Error(`products[${idx}].name must be a string`);
    if (typeof p.brand !== "string") throw new Error(`products[${idx}].brand must be a string`);

    if (typeof p.category !== "string" || !p.category.trim()) {
      throw new Error(`products[${idx}].category must be a non-empty string`);
    }

    if (p.price !== "") {
      if (typeof p.price !== "string" || !/^\$\d+(?:\.\d{2})?$/.test(p.price)) {
        throw new Error(`products[${idx}].price must be empty or a string like '$26.99'`);
      }
    }

    if (p.rating !== 0) {
      if (typeof p.rating !== "number" || !Number.isFinite(p.rating) || p.rating < 0 || p.rating > 5) {
        throw new Error(`products[${idx}].rating must be 0 or a number between 0 and 5`);
      }
    }

    if (p.reviewCount !== 0) {
      if (typeof p.reviewCount !== "number" || !Number.isFinite(p.reviewCount) || p.reviewCount < 0) {
        throw new Error(`products[${idx}].reviewCount must be 0 or a non-negative number`);
      }
    }

    if (p.availability !== undefined) {
      if (typeof p.availability !== "string" || !allowedAvailability.has(p.availability)) {
        throw new Error(`products[${idx}].availability must be 'in_stock' or 'out_of_stock' if provided`);
      }
    }

    if (p.imageUrl !== "") {
      if (typeof p.imageUrl !== "string" || !isValidAmazonImageUrl(p.imageUrl)) {
        throw new Error(`products[${idx}].imageUrl must be empty or a valid Amazon image URL`);
      }
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
      if (!Array.isArray(p.amazonKeywords)) {
        throw new Error(`products[${idx}].amazonKeywords must be an array`);
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

async function getSupabasePublicConfig() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(["ff_supabase_url", "ff_supabase_anon_key"], (items) => {
        const url = String(items?.ff_supabase_url || "").trim();
        const anonKey = String(items?.ff_supabase_anon_key || "").trim();
        resolve({ url, anonKey });
      });
    } catch {
      resolve({ url: "", anonKey: "" });
    }
  });
}

function formatUsdPrice(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "";
  return `$${n.toFixed(2)}`;
}

async function loadSupabaseProducts() {
  const { url, anonKey } = await getSupabasePublicConfig();
  if (!url || !anonKey) {
    throw new Error("Supabase public config missing (ff_supabase_url / ff_supabase_anon_key)");
  }

  const baseUrl = url.replace(/\/$/, "");

  // Use the Supabase PostgREST endpoint directly from the content script.
  const endpoint = `${baseUrl}/rest/v1/products2`;
  const qs = new URLSearchParams({
    select: [
      "id",
      "name",
      "brand",
      "category",
      "price",
      "rating",
      "review_count",
      "image_url",
      "product_url",
      "description",
      "badges",
      "amazon_keywords",
      "amazon_categories"
    ].join(","),
    is_active: "eq.true"
  });

  const res = await fetch(`${endpoint}?${qs.toString()}`, {
    method: "GET",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Accept: "application/json"
    }
  });

  if (!res.ok) {
    throw new Error(`Supabase products fetch failed: ${res.status} ${res.statusText}`);
  }

  const rows = await res.json();
  if (!Array.isArray(rows)) return [];

  // Map snake_case DB columns to the existing in-extension schema.
  return rows
    .map((r) => ({
      id: String(r?.id || "").trim(),
      name: String(r?.name || "").trim(),
      brand: String(r?.brand || "").trim(),
      category: String(r?.category || "").trim(),
      price: formatUsdPrice(r?.price),
      rating: typeof r?.rating === "number" ? r.rating : Number(r?.rating || 0),
      reviewCount: typeof r?.review_count === "number" ? r.review_count : Number(r?.review_count || 0),
      imageUrl: r?.image_url ? String(r.image_url).trim() : "",
      productUrl: r?.product_url ? String(r.product_url).trim() : "",
      description: r?.description ? String(r.description) : "",
      badges: Array.isArray(r?.badges) ? r.badges : [],
      amazonKeywords: Array.isArray(r?.amazon_keywords) ? r.amazon_keywords : [],
      amazonCategories: Array.isArray(r?.amazon_categories) ? r.amazon_categories : []
    }))
    .filter((p) => p.id && p.name && p.brand && p.category && p.productUrl);
}

let productDatabasePromise = null;

let cachedAmazonInfo = null;
let cachedMatches = null;
let lastObservedUrl = null;
let cachedUrl = null;
let cachedAsin = null;
let toastInitialized = false;
let toastClosedByUser = false;
let toastCountdownIntervalId = null;

function resetRecommendationStateForNavigation() {
  cachedAmazonInfo = null;
  cachedMatches = null;
  cachedUrl = null;
  cachedAsin = null;
  toastInitialized = false;
  toastClosedByUser = false;
  closeToast();
  // If we navigated away, clear any badge state until we recompute matches.
  sendBackgroundMessage({ type: "FAIRFINDZ_CLEAR_BADGE" });
}

function onPossibleUrlChange() {
  const href = window.location.href;
  if (href === lastObservedUrl) return;
  lastObservedUrl = href;
  resetRecommendationStateForNavigation();
  logProductPageStatus();
}

function loadProductDatabase() {
  if (!productDatabasePromise) {
    productDatabasePromise = (async () => {
      let cfg = { url: "", anonKey: "" };
      try {
        cfg = await getSupabasePublicConfig();
      } catch {
        cfg = { url: "", anonKey: "" };
      }

      console.log("🔧 FairFindz product DB load starting", {
        hasSupabaseUrl: Boolean(cfg?.url),
        hasSupabaseAnonKey: Boolean(cfg?.anonKey)
      });

      try {
        const supabaseProducts = await loadSupabaseProducts();
        if (Array.isArray(supabaseProducts) && supabaseProducts.length) {
          console.log(`✅ Loaded ${supabaseProducts.length} products from Supabase`);
          return supabaseProducts;
        }
        console.warn("⚠️ Supabase returned 0 products, falling back to businesses.json");
      } catch (err) {
        console.warn("⚠️ Supabase products load failed, falling back to businesses.json:", err?.message || err);
      }

      return loadBusinessesProducts();
    })();
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

function extractAmazonAsinFromUrl(url) {
  if (!url) return null;
  const s = String(url);

  // Common Amazon patterns:
  // - /dp/B012345678
  // - /gp/product/B012345678
  // - ?asin=B012345678
  const dp = s.match(/\/dp\/([A-Z0-9]{10})(?:[/?]|$)/i);
  if (dp?.[1]) return dp[1].toUpperCase();

  const gp = s.match(/\/gp\/product\/([A-Z0-9]{10})(?:[/?]|$)/i);
  if (gp?.[1]) return gp[1].toUpperCase();

  const q = s.match(/[?&]asin=([A-Z0-9]{10})(?:&|$)/i);
  if (q?.[1]) return q[1].toUpperCase();

  return null;
}

function isCurrentAmazonProductInDatabase(products) {
  const currentAsin = extractAmazonAsinFromUrl(window.location.href);
  if (!currentAsin) return false;

  for (const p of products || []) {
    const asin = extractAmazonAsinFromUrl(p?.productUrl);
    if (asin && asin === currentAsin) return true;
  }
  return false;
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

  const haystack = amazonInfo.combinedText;

  const keywords = Array.isArray(product.amazonKeywords) ? product.amazonKeywords : [];
  const fallbackKeywords = [];
  if (!keywords.length) {
    // Only use name + brand for fallback keywords.
    // Category strings in the DB can be generic and cause false positives (e.g., "home", "grocery").
    const raw = `${product.name || ""} ${product.brand || ""}`;
    const stopwords = new Set([
      "with",
      "from",
      "that",
      "this",
      "your",
      "their",
      "amazon",
      "com",
      "pack",
      "count",
      "size",
      "ounce",
      "ounces",
      "pound",
      "pounds",
      "grams",
      "fresh",
      "medium",
      "large",
      "small",
      "black",
      "owned"
    ]);
    raw
      .split(/[^a-z0-9]+/i)
      .map((t) => t.trim())
      .filter(Boolean)
      .forEach((t) => {
        // Avoid noisy tokens.
        if (t.length < 5) return;
        const lower = t.toLowerCase();
        if (stopwords.has(lower)) return;
        fallbackKeywords.push(t);
      });
  }

  const effectiveKeywords = keywords.length ? keywords : Array.from(new Set(fallbackKeywords));

  const matched = [];
  for (const kwRaw of effectiveKeywords) {
    const kw = normalizeText(kwRaw);
    if (!kw) continue;
    if (haystack.includes(kw)) matched.push(kwRaw);
  }

  const keywordMatches = matched.length;
  let score = 0;

  const brandText = normalizeText(product.brand || "");
  const brandMatches = brandText && haystack.includes(brandText);

  const productTextForIntent = normalizeText(
    `${product?.name || ""} ${product?.category || ""} ${Array.isArray(product?.amazonCategories) ? product.amazonCategories.join(" ") : ""}`
  );
  const pageTextForIntent = normalizeText(
    `${amazonInfo?.title || ""} ${amazonInfo?.breadcrumbs || ""} ${amazonInfo?.features || ""} ${amazonInfo?.description || ""}`
  );
  const pageWantsCollagen = pageTextForIntent.includes("collagen") || pageTextForIntent.includes("peptides");

  // Generic terms like "coffee" or "candle" can appear in navigation, ads, or recommendations
  // on unrelated pages. We require at least one *non-generic* keyword match to consider a
  // product relevant.
  const genericKeywordSet = new Set(["coffee", "candle", "candles"]);
  const nonGenericKeywordMatches = matched.filter((kw) => !genericKeywordSet.has(normalizeText(kw))).length;

  // Minimum relevance gate:
  // - If we don't know the page category, we require stronger evidence (>= 2 keyword matches)
  //   to avoid surfacing unrelated products (e.g., balloons matching candles).
  // - If we do know the category, require at least 1 keyword match.
  // Relevance gate:
  // - If brand matches, allow >= 1 keyword match
  // - If the page is in a known supported domain and we're already domain-filtered,
  //   allow >= 1 keyword match (helps cross-brand matches like toothpaste).
  // - Otherwise require >= 2 meaningful keyword matches to avoid false positives.
  const pageDomains = amazonInfo?.pageDomains instanceof Set ? amazonInfo.pageDomains : null;
  const allowSingleKeywordByDomain =
    pageDomains &&
    (pageDomains.has("oralcare") || pageDomains.has("skincare") || pageDomains.has("household") || pageDomains.has("coffee") || pageDomains.has("supplements"));
  const minKeywordMatches = brandMatches || allowSingleKeywordByDomain ? 1 : 2;
  if (keywordMatches < minKeywordMatches || nonGenericKeywordMatches < 1) {
    return { score: 0, keywordMatches, matchedKeywords: matched };
  }

  // Intent boost: if the page is clearly about collagen/peptides, heavily prefer collagen items.
  // Option B: still allow other supplements from the same brand, but keep them below collagen.
  if (pageWantsCollagen) {
    if (productTextForIntent.includes("collagen") || productTextForIntent.includes("peptides")) {
      score += 80;
    } else {
      // If it's not collagen, only allow it when it's the same brand (brand match), and do not boost.
      if (!brandMatches) {
        return { score: 0, keywordMatches, matchedKeywords: matched };
      }
    }
  }

  score += (amazonInfo.category !== "unknown" && product.category === amazonInfo.category ? 60 : 20);
  score += keywordMatches * 12;

  if (brandMatches) score += 20;

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

function detectDomainsFromText(text) {
  const t = normalizeText(text || "");
  const domains = new Set();

  const hasAny = (arr) => arr.some((w) => t.includes(w));

  if (hasAny(["collagen", "peptides", "supplement", "supplements", "vitamin", "vitamins", "multivitamin", "protein powder"])) {
    domains.add("supplements");
  }
  if (hasAny(["coffee", "espresso", "beans", "roast", "k-cup", "keurig"])) {
    domains.add("coffee");
  }
  if (hasAny(["olive oil", "extra virgin", "evoo", "cold pressed", "cold-pressed", "avocado oil", "cooking oil", "sunflower oil", "grapeseed oil", "sesame oil"])) {
    domains.add("grocery");
  }
  if (hasAny(["toothpaste", "tooth paste", "mouthwash", "oral care", "toothbrush", "teeth", "gum", "gingivitis"])) {
    domains.add("oralcare");
  }
  if (hasAny(["laundry", "detergent", "dish soap", "cleaner", "cleaning", "soap"])) {
    domains.add("household");
  }
  if (hasAny(["skincare", "moisturizer", "serum", "cleanser", "sunscreen", "lotion", "brightening"])) {
    domains.add("skincare");
  }
  if (hasAny(["luggage", "suitcase", "travel", "wheels", "accessories", "accessory"])) {
    domains.add("travel");
  }

  if (hasAny(["vacuum", "vacuuming", "robot vacuum", "robotic vacuum", "mop", "mopping", "suction", "dustbin", "self-emptying"])) {
    domains.add("appliances");
  }

  if (hasAny(["candle", "candles", "wax", "scented", "aroma", "fragrance", "pillar", "votive", "tin", "jar candle"])) {
    domains.add("candle");
  }

  return domains;
}

function getProductDomains(product) {
  const text = `${product?.name || ""} ${product?.brand || ""} ${Array.isArray(product?.amazonCategories) ? product.amazonCategories.join(" ") : ""} ${product?.category || ""}`;
  return detectDomainsFromText(text);
}

function matchProducts(amazonInfo, products, { limit = 3 } = {}) {
  const inStock = (products || []).filter((p) => p.availability !== "out_of_stock");

  // Domain detection must be conservative.
  // Using full page text can pick up unrelated words from recommendations/ads (e.g., "coffee")
  // and cause irrelevant alternatives to show.
  const pageDomainText = `${amazonInfo?.title || ""} ${amazonInfo?.breadcrumbs || ""}`;
  const pageDomains = detectDomainsFromText(pageDomainText);

  const currentBrandText = normalizeText(amazonInfo?.title || "");

  // If we can't infer any domain from the page, do not show recommendations.
  // This prevents false positives on unrelated pages (e.g., vacuums).
  if (!pageDomains.size) {
    return { top: [], scored: [] };
  }

  const anyDomainOverlapInDb = inStock.some((p) => {
    const pd = getProductDomains(p);
    return Array.from(pageDomains).some((d) => pd.has(d));
  });

  if (!anyDomainOverlapInDb) {
    return { top: [], scored: [] };
  }

  const categoryPool = inStock.filter((p) => {
    const productDomains = getProductDomains(p);

    // Allow overlap.
    const overlaps = Array.from(pageDomains).some((d) => productDomains.has(d));
    if (overlaps) return true;

    // Option B: on supplements pages, allow other supplements from the same brand.
    if (pageDomains.has("supplements") && productDomains.has("supplements")) {
      const brandText = normalizeText(p.brand || "");
      if (brandText && currentBrandText.includes(brandText)) return true;
    }

    return false;
  });

  const scored = categoryPool
    .map((p) => {
      const { score, keywordMatches, matchedKeywords } = scoreProduct(p, { ...amazonInfo, pageDomains });
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

function sendBackgroundMessage(message) {
  try {
    chrome.runtime?.sendMessage?.(message);
  } catch {
    // Ignore; background/service worker may not be available in some contexts.
  }
}

function escapeHtmlAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getImageFallbackDataUrl() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
      <rect width="120" height="120" rx="10" ry="10" fill="#edf2f7"/>
      <path d="M30 82l18-20 14 16 10-12 18 22H30z" fill="#cbd5e0"/>
      <circle cx="46" cy="44" r="7" fill="#cbd5e0"/>
      <text x="60" y="104" font-family="system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="10" text-anchor="middle" fill="#718096">Image unavailable</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const resolvedImageUrlCache = new Map();

function loadImageUrl(url) {
  return new Promise((resolve, reject) => {
    if (!url) return reject(new Error("Missing image URL"));
    const img = new Image();
    img.decoding = "async";
    img.loading = "eager";
    img.referrerPolicy = "strict-origin-when-cross-origin";
    img.onload = () => resolve(url);
    img.onerror = () => reject(new Error("Image failed to load"));
    img.src = url;
  });
}

function resolveMetaViaBackground(productUrl) {
  return new Promise((resolve) => {
    try {
      chrome.runtime?.sendMessage?.(
        { type: "FAIRFINDZ_RESOLVE_PRODUCT_META", productUrl },
        (response) => {
          if (chrome.runtime?.lastError) {
            resolve({ rating: null, reviewCount: null, priceText: null });
            return;
          }

          resolve({
            rating: typeof response?.rating === "number" ? response.rating : null,
            reviewCount: typeof response?.reviewCount === "number" ? response.reviewCount : null,
            priceText: typeof response?.priceText === "string" ? response.priceText : null
          });
        }
      );
    } catch {
      resolve({ rating: null, reviewCount: null, priceText: null });
    }
  });
}

function resolveImageViaBackground(productUrl) {
  return new Promise((resolve) => {
    try {
      chrome.runtime?.sendMessage?.(
        { type: "FAIRFINDZ_RESOLVE_PRODUCT_IMAGE", productUrl },
        (response) => {
          if (chrome.runtime?.lastError) {
            resolve(null);
            return;
          }
          resolve(typeof response?.imageUrl === "string" && response.imageUrl.trim() ? response.imageUrl.trim() : null);
        }
      );
    } catch {
      resolve(null);
    }
  });
}

function renderStarsHtml(rating) {
  const safe = typeof rating === "number" && !Number.isNaN(rating) ? Math.max(0, Math.min(5, rating)) : 0;
  const fullStars = Math.floor(safe);
  const frac = safe - fullStars;
  const hasHalf = frac >= 0.25 && frac < 0.75;
  const effectiveFullStars = frac >= 0.75 ? fullStars + 1 : fullStars;

  const stars = [];
  for (let i = 0; i < 5; i += 1) {
    if (i < effectiveFullStars) {
      stars.push('<span class="bbd-star bbd-star-full">★</span>');
    } else if (i === effectiveFullStars && hasHalf) {
      stars.push('<span class="bbd-star bbd-star-half">★</span>');
    } else {
      stars.push('<span class="bbd-star bbd-star-empty">★</span>');
    }
  }

  return `<span class="bbd-stars" aria-label="${safe.toFixed(1)} out of 5">${stars.join("")}</span>`;
}

function hydrateModalProductMeta(overlayEl) {
  if (!overlayEl) return;

  const urls = new Set(
    Array.from(
      overlayEl.querySelectorAll("[data-product-url]")
    )
      .map((el) => el.getAttribute("data-product-url") || "")
      .filter(Boolean)
  );

  urls.forEach(async (productUrl) => {
    const ratingEl = overlayEl.querySelector(`.bbd-product-rating[data-product-url="${CSS.escape(productUrl)}"]`);
    const priceEl = overlayEl.querySelector(`.bbd-product-price[data-product-url="${CSS.escape(productUrl)}"]`);

    const { rating, reviewCount, priceText } = await resolveMetaViaBackground(productUrl);

    if (ratingEl) {
      const fallbackRatingRaw = ratingEl.getAttribute("data-fallback-rating");
      const fallbackReviewRaw = ratingEl.getAttribute("data-fallback-review-count");
      const fallbackRating = fallbackRatingRaw != null ? Number(fallbackRatingRaw) : null;
      const fallbackReviewCount = fallbackReviewRaw != null ? Number(fallbackReviewRaw) : null;

      const finalRating = typeof rating === "number" ? rating : (Number.isFinite(fallbackRating) ? fallbackRating : null);
      const finalReviewCount = typeof reviewCount === "number" ? reviewCount : (Number.isFinite(fallbackReviewCount) ? fallbackReviewCount : null);

      if (typeof finalRating === "number" && typeof finalReviewCount === "number") {
        ratingEl.innerHTML = `${renderStarsHtml(finalRating)} <span class="bbd-review-count">(${finalReviewCount.toLocaleString()})</span>`;
      } else {
        ratingEl.textContent = "";
      }
    }

    if (priceEl) {
      const fallbackPrice = priceEl.getAttribute("data-fallback-price") || "";
      const finalPrice = typeof priceText === "string" && priceText.trim() ? priceText.trim() : (fallbackPrice.trim() ? fallbackPrice.trim() : "");
      priceEl.textContent = finalPrice;
    }
  });
}

async function hydrateModalProductImages(overlayEl) {
  if (!overlayEl) return;

  const imgs = Array.from(overlayEl.querySelectorAll("img.bbd-product-image"));
  await Promise.all(
    imgs.map(async (imgEl) => {
      const primarySrc = imgEl.getAttribute("data-primary-src") || "";
      const productUrl = imgEl.getAttribute("data-product-url") || "";

      if (primarySrc || productUrl) {
        console.log("🖼️ FairFindz image hydrate:", { primarySrc, productUrl });
      }

      // First try the DB-provided image URL (fast path if valid).
      try {
        await loadImageUrl(primarySrc);
        imgEl.src = primarySrc;
        console.log("🖼️ FairFindz image loaded from DB imageUrl");
        return;
      } catch {
        // continue
      }

      // Fallback: fetch the product page and use og:image.
      const resolvedFromBg = await resolveImageViaBackground(productUrl);
      if (resolvedFromBg) console.log("🖼️ FairFindz resolved image via background:", resolvedFromBg);

      const resolved = resolvedFromBg || (await resolveAmazonOgImage(productUrl));
      if (!resolvedFromBg && resolved) console.log("🖼️ FairFindz resolved og:image:", resolved);
      try {
        await loadImageUrl(resolved);
        imgEl.src = resolved;
        console.log("🖼️ FairFindz image loaded from productUrl resolution");
      } catch {
        // leave placeholder
        console.log("🖼️ FairFindz image failed to load; leaving placeholder");
      }
    })
  );
}

function closeToast() {
  const existing = document.getElementById("bbd-toast");
  if (existing) existing.remove();
  toastInitialized = false;
  if (toastCountdownIntervalId) {
    window.clearInterval(toastCountdownIntervalId);
    toastCountdownIntervalId = null;
  }
}

function createToast({ onOpenFullModal } = {}) {
  if (toastInitialized) return;
  toastInitialized = true;

  // If a toast already exists (SPA navigation), reuse the guard.
  if (document.getElementById("bbd-toast")) return;

  const toast = document.createElement("div");
  toast.id = "bbd-toast";
  toast.className = "bbd-toast";

  toast.innerHTML = `
    <div class="bbd-toast-header">
      <div class="bbd-toast-header-left">
        <div class="bbd-toast-icon" aria-hidden="true">🎯</div>
        <div class="bbd-toast-title">FairFindz</div>
      </div>
      <button class="bbd-toast-close" type="button" aria-label="Close">&times;</button>
    </div>
    <div class="bbd-toast-body">
      <button class="bbd-toast-primary" type="button">Alternative Found</button>
      <div class="bbd-toast-countdown" aria-live="polite">05</div>
    </div>
  `;

  document.body.appendChild(toast);

  const closeBtn = toast.querySelector(".bbd-toast-close");
  const primaryBtn = toast.querySelector(".bbd-toast-primary");
  const countdownEl = toast.querySelector(".bbd-toast-countdown");

  const stopFlashing = () => sendBackgroundMessage({ type: "FAIRFINDZ_STOP_FLASHING" });
  const startFlashing = () => sendBackgroundMessage({ type: "FAIRFINDZ_START_FLASHING" });

  const closeByUser = () => {
    toastClosedByUser = true;
    closeToast();
    // If user closes the toast manually, we still want the icon to indicate availability.
    startFlashing();
  };

  closeBtn?.addEventListener("click", closeByUser);

  primaryBtn?.addEventListener("click", () => {
    stopFlashing();
    closeToast();
    onOpenFullModal?.();
  });

  const formatSeconds = (n) => String(Math.max(0, n)).padStart(2, "0");

  // Countdown: 5 seconds, then dismiss and start flashing badge dot.
  let remaining = 5;
  toastCountdownIntervalId = window.setInterval(() => {
    remaining -= 1;
    if (countdownEl) countdownEl.textContent = formatSeconds(Math.max(remaining, 0));

    if (remaining <= 0) {
      window.clearInterval(toastCountdownIntervalId);
      toastCountdownIntervalId = null;
      closeToast();
      if (!toastClosedByUser) startFlashing();
    }
  }, 1000);
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
  if (document.getElementById("bbd-modal-overlay")) return;

  if (modalInitialized) {
    console.warn("⚠️ FairFindz: modalInitialized=true but overlay missing; resetting");
    modalInitialized = false;
  }

  modalInitialized = true;

  try {
    const overlay = document.createElement("div");
    overlay.id = "bbd-modal-overlay";
    overlay.className = "bbd-modal-overlay";

    const container = document.createElement("div");
    container.className = "bbd-modal-container";
    container.setAttribute("role", "dialog");
    container.setAttribute("aria-modal", "true");

    const category = amazonInfo?.category || getProductCategory();
    const footerInfoText =
      category && category !== "unknown"
        ? `💡 Supporting Black-owned businesses in ${category}`
        : "💡 Supporting Black-owned businesses";

    const items = Array.isArray(matches) ? matches : [];

    const productCardsHtml = items.length
      ? items
          .map(({ product }) => {
            const imageSrc = escapeHtmlAttr(product.imageUrl || "");
            const fallbackSrc = escapeHtmlAttr(getImageFallbackDataUrl());
            const productUrlAttr = escapeHtmlAttr(product.productUrl || "");
            const badges = Array.isArray(product.badges) && product.badges.length
              ? product.badges.map((b) => `<span class="bbd-product-badge">🏷️ ${b}</span>`).join(" ")
              : "";

            const priceText = escapeHtmlAttr(product.price || "");
            const ratingText = renderStarsHtml(
              typeof product.rating === "number" ? product.rating : Number(product.rating || 0)
            );
            const reviewCountText =
              typeof product.reviewCount === "number" ? product.reviewCount : Number(product.reviewCount || 0);

            return `
          <div class="bbd-product-card">
            <img
              class="bbd-product-image"
              src="${imageSrc || fallbackSrc}"
              data-fallback-src="${fallbackSrc}"
              data-primary-src="${imageSrc}"
              data-product-url="${productUrlAttr}"
              alt="${escapeHtmlAttr(product.name)}"
            />

            <div class="bbd-product-info">
              <div class="bbd-product-title">${product.name}</div>
              <div class="bbd-product-brand">By: ${product.brand}</div>
              <div class="bbd-product-price">${priceText}</div>
              <div class="bbd-product-rating">${ratingText} <span class="bbd-review-count">(${Number.isFinite(reviewCountText) ? reviewCountText.toLocaleString() : "0"})</span></div>
              <div class="bbd-product-badges">${badges}</div>

              <button
                class="bbd-product-cta-button"
                type="button"
                data-product-url="${productUrlAttr}"
              >
                Shop This Alternative →
              </button>
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

      <div class="bbd-modal-info">${footerInfoText}</div>
    </div>

    <div class="bbd-modal-footer">
      <button class="bbd-modal-footer-close" type="button">
        No, I’m not interested in supporting small business today
      </button>
    </div>
  `;

    overlay.appendChild(container);

    document.body.appendChild(overlay);

    overlay.classList.add("bbd-modal-show");

    hydrateModalProductImages(overlay);

    window.requestAnimationFrame(() => {
      overlay.classList.add("bbd-modal-show");
    });

    const closeModal = () => {
      const existingOverlay = document.getElementById("bbd-modal-overlay");
      if (!existingOverlay) return;

      if (existingOverlay.classList.contains("bbd-modal-hide")) return;

      existingOverlay.classList.add("bbd-modal-hide");
      existingOverlay.classList.remove("bbd-modal-show");

      const containerEl = existingOverlay.querySelector(".bbd-modal-container");
      const onDone = () => {
        existingOverlay.remove();
        modalInitialized = false;
      };

      if (containerEl) {
        containerEl.addEventListener("transitionend", onDone, { once: true });
      } else {
        window.setTimeout(onDone, 220);
      }
    };

    const closeBtn = overlay.querySelector(".bbd-modal-close");
    closeBtn?.addEventListener("click", closeModal);

    const productCtaButtons = overlay.querySelectorAll(".bbd-product-cta-button");
    productCtaButtons.forEach((btn) => {
      btn.addEventListener("click", function () {
        const url = this.getAttribute("data-product-url");

        if (!url || !isValidAmazonProductUrl(url)) {
          console.error("❌ Invalid product URL:", url);
          return;
        }

        this.textContent = "Opening...";
        this.disabled = true;

        window.open(url, "_blank", "noopener,noreferrer");
        setTimeout(() => {
          closeModal();
        }, 500);
      });
    });
  } catch (err) {
    modalInitialized = false;
    console.error("❌ FairFindz: createModal failed", err);
  }
}

async function logProductPageStatus() {
  if (isProductPage(window.location.href, { detectCategory: true })) {
    console.log("✅ Product page detected!");
    detectCartActions();

    try {
      const products = await loadProductDatabase();
      const activeProducts = products.filter((p) => p.availability !== "out_of_stock");
      console.log(`✅ Loaded ${products.length} products (${activeProducts.length} in-stock, ${products.length - activeProducts.length} out-of-stock)`);

      // If the user is already on a product that exists in our database,
      // do not surface alternatives.
      if (isCurrentAmazonProductInDatabase(products)) {
        sendBackgroundMessage({ type: "FAIRFINDZ_STOP_FLASHING" });
        sendBackgroundMessage({ type: "FAIRFINDZ_CLEAR_BADGE" });
        closeToast();
        return;
      }

      const amazonInfo = extractAmazonProduct();
      cachedAmazonInfo = amazonInfo;
      cachedUrl = window.location.href;
      cachedAsin = extractAmazonAsinFromUrl(window.location.href);
      console.log("🧾 Amazon product info:", {
        title: amazonInfo.title,
        category: amazonInfo.category,
        priceText: amazonInfo.priceText
      });

      const { top, scored } = matchProducts(amazonInfo, products, { limit: 3 });
      cachedMatches = top;
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

      // UX: show a small toast 2 seconds after load if we found alternatives.
      // The toast auto-dismisses after 5 seconds and then the toolbar icon flashes.
      maybePromptAuthOnceOnProductPage();
      window.setTimeout(() => {
        if (!isProductPage()) return;
        // Avoid showing stale toasts when Amazon navigates without a full reload.
        if (cachedUrl && cachedUrl !== window.location.href) return;
        const currentAsin = extractAmazonAsinFromUrl(window.location.href);
        if (cachedAsin && currentAsin && cachedAsin !== currentAsin) return;
        if (!Array.isArray(top) || top.length === 0) return;
        createToast({
          onOpenFullModal: () => createModal({ amazonInfo: cachedAmazonInfo, matches: cachedMatches || [] })
        });
      }, 2000);
      return;
    } catch (err) {
      console.error("❌ Invalid businesses.json:", err);
      return;
    }
  } else {
    console.log("❌ Not a product page");
    // Clear badge state on non-product pages.
    sendBackgroundMessage({ type: "FAIRFINDZ_CLEAR_BADGE" });
  }
}

chrome.runtime?.onMessage?.addListener((message) => {
  if (!message || typeof message !== "object") return;
  if (message.type !== "FAIRFINDZ_SHOW_MODAL") return;

  console.log("📩 FairFindz received FAIRFINDZ_SHOW_MODAL", { href: window.location.href });

  const forceOpen = Boolean(message.force);

  // Non-product pages: do nothing (silent) per UX requirements.
  if (!isProductPage()) {
    console.log("ℹ️ FairFindz: isProductPage() is false; not opening modal", { href: window.location.href });
    return;
  }

  const openAlternativesModal = () => {
    // Stop any flashing indicator when the user opens the modal.
    sendBackgroundMessage({ type: "FAIRFINDZ_STOP_FLASHING" });

    // If we already computed matches for this page, reuse them.
    if (cachedAmazonInfo && Array.isArray(cachedMatches)) {
      const currentHref = window.location.href;
      const currentAsin = extractAmazonAsinFromUrl(currentHref);

      // If the user navigated (Amazon SPA), our cached matches may be for a different page.
      // Do not no-op; clear cache and recompute below.
      if (cachedUrl && cachedUrl !== currentHref) {
        cachedAmazonInfo = null;
        cachedMatches = null;
      } else if (cachedAsin && currentAsin && cachedAsin !== currentAsin) {
        cachedAmazonInfo = null;
        cachedMatches = null;
      } else {
        closeToast();
        createModal({ amazonInfo: cachedAmazonInfo, matches: cachedMatches });
        return;
      }
    }

    // Fallback: compute matches on demand.
    (async () => {
      try {
        const products = await loadProductDatabase();

        // If the user is already on a product that exists in our database,
        // do not surface alternatives (even via icon click).
        if (!forceOpen && isCurrentAmazonProductInDatabase(products)) {
          sendBackgroundMessage({ type: "FAIRFINDZ_STOP_FLASHING" });
          sendBackgroundMessage({ type: "FAIRFINDZ_CLEAR_BADGE" });
          closeToast();
          return;
        }

        const amazonInfo = extractAmazonProduct();
        cachedAmazonInfo = amazonInfo;
        cachedUrl = window.location.href;
        cachedAsin = extractAmazonAsinFromUrl(window.location.href);
        const { top } = matchProducts(amazonInfo, products, { limit: 3 });
        cachedMatches = top;
        closeToast();
        createModal({ amazonInfo, matches: Array.isArray(top) ? top : [] });
      } catch (err) {
        console.error("❌ Failed to open modal:", err);
      }
    })();
  };

  // Auth gate: if the user is not signed in and has not chosen guest mode,
  // show the signup modal first.
  const authApi = globalThis.FairFindzAuth;
  if (forceOpen) {
    openAlternativesModal();
    return;
  }
  if (authApi && typeof authApi.ensureAuthOrGuest === "function") {
    authApi.ensureAuthOrGuest({
      forcePrompt: true,
      onAuthed: () => openAlternativesModal(),
      onGuest: () => openAlternativesModal()
    });
    return;
  }

  // If auth modal isn't available for some reason, fall back to current behavior.
  openAlternativesModal();
});

// Prompt once on the first eligible product page visit (optional UX requirement).
// We keep this lightweight: only show if the user is neither authenticated nor in guest mode
// AND if we found alternatives.
async function maybePromptAuthOnceOnProductPage() {
  const authApi = globalThis.FairFindzAuth;
  if (!authApi || typeof authApi.ensureAuthOrGuest !== "function" || typeof authApi.getAuthState !== "function") {
    return;
  }
  if (!isProductPage()) return;

  try {
    const state = await authApi.getAuthState();
    if (state.isAuthenticated || state.guest) return;
  } catch {
    return;
  }

  // Only prompt if there are alternatives available.
  if (!Array.isArray(cachedMatches) || cachedMatches.length === 0) return;

  // Do not force; only show once per user/device.
  authApi.ensureAuthOrGuest({
    forcePrompt: false
  });
}

// Run once when the page loads.
// Content scripts are usually injected after navigation, but DOM readiness can vary.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", logProductPageStatus, { once: true });
} else {
  logProductPageStatus();
}

// Amazon sometimes navigates between product pages via History API without a full reload.
// Recompute matches when the URL changes.
try {
  lastObservedUrl = window.location.href;

  window.addEventListener("popstate", onPossibleUrlChange);

  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    const ret = originalPushState.apply(this, args);
    onPossibleUrlChange();
    return ret;
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    const ret = originalReplaceState.apply(this, args);
    onPossibleUrlChange();
    return ret;
  };

  window.setInterval(onPossibleUrlChange, 1000);
} catch {
  // ignore
}
