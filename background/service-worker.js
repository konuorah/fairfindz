const chromeApi = globalThis.chrome;

if (!chromeApi) {
  // If the extension APIs are unavailable for any reason, do nothing.
} 

const actionApi = chromeApi && (chromeApi.action || chromeApi.browserAction);

function isMissingReceiverError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("receiving end does not exist") ||
    msg.includes("could not establish connection")
  );
}

function isNoResponsePortClosedError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("the message port closed") && msg.includes("before a response was received");
}

async function ensureContentScriptsInjected(tabId) {
  const scripting = chromeApi?.scripting;
  if (!scripting || !tabId) return;

  let shouldInject = true;
  try {
    const result = await scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: () => {
        try {
          const g = globalThis;
          if (g.FairFindzContentScriptLoaded) return { shouldInject: false, reason: "already_loaded" };
          if (g.FairFindzContentScriptInjecting) return { shouldInject: false, reason: "inject_in_progress" };
          g.FairFindzContentScriptInjecting = true;
          return { shouldInject: true, reason: "not_loaded" };
        } catch {
          return { shouldInject: true, reason: "marker_check_failed" };
        }
      }
    });
    const payload = Array.isArray(result) ? result[0]?.result : null;
    if (payload && typeof payload === "object" && payload.shouldInject === false) {
      shouldInject = false;
    }
  } catch {
    // If marker checks fail for any reason, proceed with injection.
    shouldInject = true;
  }

  if (!shouldInject) return;

  if (typeof scripting.insertCSS === "function") {
    try {
      const p = scripting.insertCSS({ target: { tabId }, files: ["content/content.css", "content/auth-modal.css"] });
      if (p && typeof p.catch === "function") await p;
    } catch {
    }
  }

  if (typeof scripting.executeScript === "function") {
    try {
      const p = scripting.executeScript({
        target: { tabId },
        world: "ISOLATED",
        files: ["content/auth-modal.js", "content/content.js"]
      });
      if (p && typeof p.catch === "function") await p;
    } catch {
    }
  }
}

function swallowNoTabError(tabId, err) {
  const msg = String(err?.message || err || "");
  if (msg.toLowerCase().includes("no tab with id")) {
    stopFlashing(tabId);
    return true;
  }
  return false;
}

function safeActionCall(tabId, fn, args) {
  if (!fn) return;
  try {
    const result = fn(args);
    // Some Chrome MV3 extension APIs return Promises in newer environments.
    if (result && typeof result.then === "function") {
      result.catch((err) => {
        swallowNoTabError(tabId, err);
      });
    }
  } catch (err) {
    swallowNoTabError(tabId, err);
  }
}

function isAmazonUrl(urlString) {
  try {
    const u = new URL(urlString);
    return /(^|\.)amazon\.com$/i.test(u.hostname) && (u.protocol === "https:" || u.protocol === "http:");
  } catch {
    return false;
  }
}

function extractAsinFromUrl(urlString) {
  try {
    const u = new URL(urlString);
    const m = u.pathname.match(/\b(?:dp|gp\/product)\/([A-Z0-9]{10})\b/i);
    return m?.[1] || null;
  } catch {
    return null;
  }
}

function isPlausibleAmazonPriceText(priceText) {
  if (typeof priceText !== "string") return false;
  const trimmed = priceText.trim();
  // Amazon main prices virtually always include cents. This avoids coupon amounts like "$10".
  // Accept formats like "$15.99" or "$1,234.00".
  return /^\$\s*\d[\d,]*\.\d{2}$/.test(trimmed);
}

function extractImageUrlFromHtml(html) {
  if (!html) return null;

  // If Amazon served a bot/consent/interstitial page, image extraction will fail.
  // Detect common markers to avoid wasting cycles.
  const lowered = html.toLowerCase();
  if (
    lowered.includes("type the characters you see") ||
    lowered.includes("enter the characters you see") ||
    lowered.includes("automated access") ||
    lowered.includes("robot check") ||
    lowered.includes("captcha")
  ) {
    return null;
  }

  const patterns = [
    // Amazon product pages often include a dynamic image map.
    // Example: data-a-dynamic-image='{"https://...jpg":[500,500],...}'
    /data-a-dynamic-image\s*=\s*"([^"]+)"/i,
    /data-a-dynamic-image\s*=\s*'([^']+)'/i,

    // Common attributes on the main image element.
    /data-old-hires\s*=\s*"(https?:[^\"]+)"/i,
    /data-old-hires\s*=\s*'(https?:[^']+)'/i,
    /id=\"landingImage\"[^>]+src=\"(https?:[^\"]+)\"/i,
    /id='landingImage'[^>]+src='(https?:[^']+)'/i,

    // JSON-like keys that appear in inline scripts.
    /"landingImage"\s*:\s*"(https?:\\\/\\\/[^\"]+)"/i,
    /"mainImage"\s*:\s*"(https?:\\\/\\\/[^\"]+)"/i,
    /"hiRes"\s*:\s*"(https?:\\\/\\\/[^\"]+)"/i,
    /"large"\s*:\s*"(https?:\\\/\\\/[^\"]+)"/i,
    /"mainUrl"\s*:\s*"(https?:\\\/\\\/[^\"]+)"/i,
    /"displayUrl"\s*:\s*"(https?:\\\/\\\/[^\"]+)"/i
  ];

  for (const re of patterns) {
    const m = html.match(re);
    const raw = m?.[1];
    if (!raw) continue;

    // Special handling for the dynamic-image attribute map.
    if (/data-a-dynamic-image/i.test(re.source)) {
      // Unescape common HTML entities.
      const decoded = raw
        .replace(/&quot;/g, '"')
        .replace(/&#34;/g, '"')
        .replace(/&amp;/g, "&");

      // Prefer the largest image in the map if we can parse it.
      // Map shape: { "https://...jpg": [500, 500], ... }
      try {
        const parsed = JSON.parse(decoded);
        if (parsed && typeof parsed === "object") {
          let bestUrl = null;
          let bestArea = -1;
          for (const [u, dims] of Object.entries(parsed)) {
            if (typeof u !== "string") continue;
            const url = u.includes("\\/") ? u.replace(/\\\//g, "/") : u;
            const w = Array.isArray(dims) ? Number(dims[0]) : NaN;
            const h = Array.isArray(dims) ? Number(dims[1]) : NaN;
            const area = Number.isFinite(w) && Number.isFinite(h) ? w * h : 0;
            if (area > bestArea) {
              bestArea = area;
              bestUrl = url;
            }
          }
          if (bestUrl) return bestUrl;
        }
      } catch {
        // Ignore JSON parsing errors.
      }

      // Fallback: find the first https URL inside the JSON map.
      const urlMatchEscaped = decoded.match(/https?:\\\/\\\/[^\"\\s]+/i);
      if (urlMatchEscaped?.[0]) return urlMatchEscaped[0].replace(/\\\//g, "/");

      const urlMatchPlain = decoded.match(/https?:\/\/[^\"\s]+/i);
      if (urlMatchPlain?.[0]) return urlMatchPlain[0];
      continue;
    }

    const url = raw.includes("\\/") ? raw.replace(/\\\//g, "/") : raw;
    return url;
  }

  // Last resort: pick the first Amazon CDN product image-like URL.
  const cdn = html.match(/https?:\/\/m\.media-amazon\.com\/images\/I\/[^\"'\s]+\.(?:jpg|jpeg|png|webp)/i);
  if (cdn?.[0]) return cdn[0];

  // Meta tag extraction where attribute order can vary.
  // Example: <meta content="..." property="og:image" />
  // We do this late because og:image can sometimes point to a brand tile/logo
  // rather than the actual main product image.
  const metaNames = ["og:image:secure_url", "og:image", "twitter:image"];
  for (const name of metaNames) {
    const re1 = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      "i"
    );
    const re2 = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["'][^>]*>`,
      "i"
    );
    const m1 = html.match(re1);
    if (m1?.[1]) return m1[1];
    const m2 = html.match(re2);
    if (m2?.[1]) return m2[1];
  }

  return null;
}

function extractPriceFromMobileHtml(html) {
  if (!html) return null;

  const lowered = html.toLowerCase();
  if (
    lowered.includes("type the characters you see") ||
    lowered.includes("enter the characters you see") ||
    lowered.includes("automated access") ||
    lowered.includes("robot check") ||
    lowered.includes("captcha")
  ) {
    return null;
  }

  const patterns = [
    // Mobile PDP often uses these blocks.
    /id=["']priceblock_(?:ourprice|dealprice|saleprice)["'][^>]*>\s*([^<\s][^<]{0,20})\s*</i,
    /id=["']newBuyBoxPrice["'][^>]*>\s*([^<\s][^<]{0,20})\s*</i,
    /id=["']buyBoxInner["'][\s\S]{0,3000}?\$\s*\d[\d,]*\.?\d{0,2}/i
  ];

  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1] && /^\$\s*\d/.test(m[1].trim())) {
      return m[1].trim();
    }
  }

  // Generic: find a $xx.xx that is NOT followed by a unit price marker nearby.
  const dollar = /\$\s*\d[\d,]*\.?\d{0,2}/g;
  let m;
  while ((m = dollar.exec(html))) {
    const text = m[0].trim();
    const numeric = Number(text.replace(/[^0-9.]/g, ""));
    if (Number.isNaN(numeric) || numeric < 5) continue;

    const start = Math.max(0, m.index - 120);
    const end = Math.min(html.length, m.index + 240);
    const ctx = html.slice(start, end).toLowerCase();
    // Avoid coupon/savings amounts like "Save $10".
    if (
      ctx.includes("coupon") ||
      ctx.includes("save ") ||
      ctx.includes("save$") ||
      ctx.includes("savings") ||
      ctx.includes("discount") ||
      ctx.includes("promo") ||
      ctx.includes("promotion") ||
      ctx.includes("off")
    ) {
      continue;
    }
    if (ctx.includes("/ounce") || ctx.includes("per ounce") || ctx.includes("/oz") || ctx.includes("/ oz")) {
      continue;
    }

    return text;
  }

  return null;
}

function extractRatingReviewFromHtml(html) {
  if (!html) return { rating: null, reviewCount: null };

  const lowered = html.toLowerCase();
  if (
    lowered.includes("type the characters you see") ||
    lowered.includes("enter the characters you see") ||
    lowered.includes("automated access") ||
    lowered.includes("robot check") ||
    lowered.includes("captcha")
  ) {
    return { rating: null, reviewCount: null };
  }

  let rating = null;
  let reviewCount = null;

  // Constrain parsing to the canonical review widget area if present.
  // This avoids accidentally matching ratings/reviews from other modules on the page.
  const avgBlockMatch = html.match(/id=["']averageCustomerReviews["'][\s\S]{0,2500}/i);
  const scope = avgBlockMatch?.[0] || html;

  const ratingMatch = scope.match(/([0-9]+(?:\.[0-9]+)?)\s*out of\s*5\s*stars/i);
  if (ratingMatch?.[1]) {
    const parsed = Number(ratingMatch[1]);
    if (!Number.isNaN(parsed)) rating = parsed;
  }

  const acrMatch = scope.match(
    /id=["']acrCustomerReviewText["'][^>]*>\s*([0-9,]+)\s+(?:global\s+ratings|ratings|rating)\s*</i
  );
  if (acrMatch?.[1]) {
    const parsed = Number(String(acrMatch[1]).replace(/,/g, ""));
    if (!Number.isNaN(parsed)) reviewCount = parsed;
  }

  // Fallback (still scoped) in case Amazon changes element IDs.
  if (reviewCount == null) {
    const fallback = scope.match(/([0-9,]+)\s+(?:global\s+ratings|ratings|rating)\b/i);
    if (fallback?.[1]) {
      const parsed = Number(String(fallback[1]).replace(/,/g, ""));
      if (!Number.isNaN(parsed)) reviewCount = parsed;
    }
  }

  return { rating, reviewCount };
}

function extractPriceFromHtml(html) {
  if (!html) return null;

  const lowered = html.toLowerCase();
  if (
    lowered.includes("type the characters you see") ||
    lowered.includes("enter the characters you see") ||
    lowered.includes("automated access") ||
    lowered.includes("robot check") ||
    lowered.includes("captcha")
  ) {
    return null;
  }

  // Prefer JSON-embedded priceToPay displayPrice when present.
  // Amazon can include multiple displayPrice values (including unit price), so we:
  // - collect all displayPrice values near priceToPay
  // - prefer a plausible main price (>= $5)
  const jsonAnchors = ["\"priceToPay\"", "\"apexPriceToPay\""];
  for (const anchor of jsonAnchors) {
    const idx = html.indexOf(anchor);
    if (idx === -1) continue;

    const window = html.slice(idx, idx + 15000);
    const displayRe = /"displayPrice"\s*:\s*"(\$\s*\d[\d,]*\.?\d{0,2})"/gi;

    const candidates = [];
    let m;
    while ((m = displayRe.exec(window))) {
      const text = String(m[1] || "").trim();
      const numeric = Number(text.replace(/[^0-9.]/g, ""));
      if (Number.isNaN(numeric)) continue;
      if (numeric < 5) continue;

      const start = Math.max(0, m.index - 160);
      const end = Math.min(window.length, m.index + 300);
      const ctx = window.slice(start, end).toLowerCase();

      // Exclude coupon/savings/discount amounts inside the same JSON blob.
      if (
        ctx.includes("coupon") ||
        ctx.includes("save") ||
        ctx.includes("savings") ||
        ctx.includes("discount") ||
        ctx.includes("promo") ||
        ctx.includes("promotion")
      ) {
        continue;
      }

      candidates.push({ text, numeric });
    }

    // Prefer prices with cents (e.g. $15.99) over whole-dollar values (often coupon amounts).
    const withCents = candidates.find((c) => /\.[0-9]{2}$/.test(c.text));
    if (withCents) return withCents.text;
    if (candidates[0]) return candidates[0].text;
  }

  const priceBlockMatch = html.match(/id=["']corePriceDisplay_desktop_feature_div["'][\s\S]{0,5000}/i);
  const scope = priceBlockMatch?.[0] || html;

  // First: try to grab the primary "price to pay" value (selected offer/variation)
  // This is more accurate than picking the lowest price from variation tiles.
  const priceToPay = scope.match(
    /priceToPay[\s\S]{0,1200}?class=["']a-offscreen["'][^>]*>\s*([^<\s][^<]{0,20})\s*</i
  );
  if (priceToPay?.[1] && /^\$\s*\d/.test(priceToPay[1].trim())) {
    return priceToPay[1].trim();
  }

  // Some templates place the main price outside the corePriceDisplay block.
  // As a fallback, search for the apex price-to-pay container.
  const apexPrice = html.match(
    /apexPriceToPay[\s\S]{0,2000}?class=["']a-offscreen["'][^>]*>\s*([^<\s][^<]{0,20})\s*</i
  );
  if (apexPrice?.[1] && /^\$\s*\d/.test(apexPrice[1].trim())) {
    return apexPrice[1].trim();
  }

  const apexPriceAlt = html.match(
    /id=["']apexPriceToPay["'][\s\S]{0,3500}?class=["']a-offscreen["'][^>]*>\s*([^<\s][^<]{0,20})\s*</i
  );
  if (apexPriceAlt?.[1] && /^\$\s*\d/.test(apexPriceAlt[1].trim())) {
    return apexPriceAlt[1].trim();
  }

  // Most reliable: a-offscreen contains a fully formatted price.
  // BUT Amazon often includes a unit price (e.g. "$1.33") near strings like "/ounce".
  // We scan all a-offscreen values and pick a plausible *main* price.
  const priceCandidates = [];
  const re = /class=["']a-offscreen["'][^>]*>\s*([^<\s][^<]{0,20})\s*</gi;
  let m;
  while ((m = re.exec(scope))) {
    const text = String(m[1] || "").trim();
    if (!/^\$\s*\d/.test(text)) continue;

    const numeric = Number(text.replace(/[^0-9.]/g, ""));
    if (Number.isNaN(numeric)) continue;

    const start = Math.max(0, m.index - 80);
    const end = Math.min(scope.length, m.index + 220);
    const ctx = scope.slice(start, end).toLowerCase();

    // Exclude unit prices like "$1.33" that are shown as "($1.33 / ounce)".
    // IMPORTANT: the main price is often displayed right next to the unit price,
    // so only exclude when the candidate matches the unit price in parentheses.
    if (ctx.includes("/ounce") || ctx.includes("/ oz") || ctx.includes("/oz") || ctx.includes("per ounce")) {
      const unit = ctx.match(/\(\s*(\$\s*\d[\d,]*\.?\d{0,2})\s*\/\s*ounce/);
      if (unit?.[1]) {
        const unitText = unit[1].replace(/\s+/g, "");
        const candidateText = text.replace(/\s+/g, "");
        if (unitText === candidateText) {
          continue;
        }
      }
    }

    // Exclude list-price/strike-through contexts.
    if (ctx.includes("list price") || ctx.includes("was:") || ctx.includes("a-text-price") || ctx.includes("price was")) {
      continue;
    }

    priceCandidates.push({ text, numeric });
  }

  if (priceCandidates.length) {
    // Avoid selecting a random variation tile price. Prefer a "larger" price when
    // multiple plausible candidates exist, since small values are more likely to be unit prices.
    // (Unit prices should be filtered above, but this is an extra guard.)
    priceCandidates.sort((a, b) => b.numeric - a.numeric);
    return priceCandidates[0].text;
  }

  const priceblock = scope.match(
    /id=["']priceblock_(?:ourprice|dealprice|saleprice)["'][^>]*>\s*([^<\s][^<]{0,20})\s*</i
  );
  if (priceblock?.[1]) return priceblock[1].trim();

  // Fallback: reconstruct from whole + fraction.
  const wholeFrac = scope.match(
    /class=["']a-price-whole["'][^>]*>\s*([0-9][0-9,\.]*)\s*<\/span>[\s\S]{0,120}?class=["']a-price-fraction["'][^>]*>\s*([0-9]{2})\s*<\/span>/i
  );
  if (wholeFrac?.[1] && wholeFrac?.[2]) {
    return `$${String(wholeFrac[1]).replace(/,/g, "")}.${wholeFrac[2]}`;
  }

  return null;
}

function safeTabsSendMessage(tabId, message) {
  if (!chromeApi || !chromeApi.tabs || !chromeApi.tabs.sendMessage) return Promise.resolve();
  try {
    return new Promise((resolve, reject) => {
      try {
        const maybePromise = chromeApi.tabs.sendMessage(tabId, message, (response) => {
          const err = chromeApi.runtime?.lastError;
          if (err) {
            if (isNoResponsePortClosedError(err)) {
              resolve();
              return;
            }
            swallowNoTabError(tabId, err);
            reject(err);
            return;
          }
          resolve(response);
        });

        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.then(resolve).catch((err) => {
            if (isNoResponsePortClosedError(err)) {
              resolve();
              return;
            }
            swallowNoTabError(tabId, err);
            reject(err);
          });
        }
      } catch (err) {
        if (isNoResponsePortClosedError(err)) {
          resolve();
          return;
        }
        swallowNoTabError(tabId, err);
        reject(err);
      }
    });
  } catch (err) {
    swallowNoTabError(tabId, err);
    return Promise.resolve();
  }
}

if (actionApi && actionApi.onClicked && actionApi.onClicked.addListener) {
  actionApi.onClicked.addListener(async (tab) => {
    const tabId = tab && tab.id;
    if (!tabId) return;

    const tabUrl = tab?.url || "";
    if (!isAmazonUrl(tabUrl)) {
      return;
    }

    try {
      console.log("🔘 FairFindz action clicked", { tabId, url: tabUrl || null });
      await safeTabsSendMessage(tabId, { type: "FAIRFINDZ_SHOW_MODAL", force: true, trigger: "action" });
      console.log("📨 FairFindz sent FAIRFINDZ_SHOW_MODAL", { tabId });
    } catch (err) {
      console.warn("⚠️ FairFindz failed to send FAIRFINDZ_SHOW_MODAL", { tabId, err: err?.message || err });

      if (isMissingReceiverError(err)) {
        await ensureContentScriptsInjected(tabId);
        try {
          await safeTabsSendMessage(tabId, { type: "FAIRFINDZ_SHOW_MODAL", force: true, trigger: "action" });
          console.log("📨 FairFindz resent FAIRFINDZ_SHOW_MODAL after inject", { tabId });
        } catch (err2) {
          console.warn("⚠️ FairFindz resend failed after inject", { tabId, err: err2?.message || err2 });
        }
      }
      // Content script may not be injected/ready (non-product page, restricted page, etc.)
      // Keep silent per UX requirements.
    }
  });
}

const flashIntervalsByTabId = new Map();

function stopFlashing(tabId) {
  const existing = flashIntervalsByTabId.get(tabId);
  if (existing) {
    clearInterval(existing);
    flashIntervalsByTabId.delete(tabId);
  }

  if (actionApi && actionApi.setBadgeText) {
    safeActionCall(tabId, actionApi.setBadgeText.bind(actionApi), { tabId, text: "" });
  }
}

function startFlashing(tabId) {
  if (flashIntervalsByTabId.has(tabId)) return;

  // Use a badge dot and toggle visibility to simulate flashing.
  if (actionApi && actionApi.setBadgeBackgroundColor) {
    safeActionCall(tabId, actionApi.setBadgeBackgroundColor.bind(actionApi), { tabId, color: "#f97316" });
  }

  let on = false;
  const intervalId = setInterval(() => {
    on = !on;
    if (actionApi && actionApi.setBadgeText) {
      safeActionCall(tabId, actionApi.setBadgeText.bind(actionApi), { tabId, text: on ? "•" : "" });
    }
  }, 500);

  flashIntervalsByTabId.set(tabId, intervalId);
}

if (chromeApi && chromeApi.runtime && chromeApi.runtime.onMessage && chromeApi.runtime.onMessage.addListener) {
  chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender?.tab?.id;
  if (!message || typeof message !== "object") return;

  if (message.type === "FAIRFINDZ_RESOLVE_PRODUCT_IMAGE") {
    const productUrl = message.productUrl;
    if (!productUrl || !isAmazonUrl(productUrl)) {
      sendResponse({ imageUrl: null });
      return;
    }

    (async () => {
      try {
        const res = await fetch(productUrl, {
          method: "GET",
          credentials: "include",
          redirect: "follow",
          headers: {
            Accept: "text/html,application/xhtml+xml"
          }
        });
        if (!res.ok) {
          console.warn("FairFindz: image resolver fetch not ok", res.status, productUrl);
          sendResponse({ imageUrl: null });
          return;
        }
        const html = await res.text();
        const imageUrl = extractImageUrlFromHtml(html);
        if (!imageUrl) console.warn("FairFindz: image resolver found no image", productUrl);
        sendResponse({ imageUrl: imageUrl || null });
      } catch {
        console.warn("FairFindz: image resolver fetch failed", productUrl);
        sendResponse({ imageUrl: null });
      }
    })();

    // Keep the message channel open for async sendResponse.
    return true;
  }

  if (message.type === "FAIRFINDZ_RESOLVE_PRODUCT_META") {
    const productUrl = message.productUrl;
    if (!productUrl || !isAmazonUrl(productUrl)) {
      sendResponse({ rating: null, reviewCount: null, priceText: null });
      return;
    }

    (async () => {
      try {
        const res = await fetch(productUrl, {
          method: "GET",
          credentials: "include",
          redirect: "follow",
          headers: {
            Accept: "text/html,application/xhtml+xml"
          }
        });

        if (!res.ok) {
          sendResponse({ rating: null, reviewCount: null, priceText: null });
          return;
        }

        const html = await res.text();
        const { rating, reviewCount } = extractRatingReviewFromHtml(html);
        let priceText = extractPriceFromHtml(html);

        if (typeof priceText === "string" && !isPlausibleAmazonPriceText(priceText)) {
          priceText = null;
        }

        // If we still got a unit price (e.g. $1.33 / ounce), fall back to the mobile page.
        // The mobile HTML is usually more static and reliably contains the main purchase price.
        if (typeof priceText === "string") {
          const numeric = Number(priceText.replace(/[^0-9.]/g, ""));
          if (!Number.isNaN(numeric) && numeric > 0 && numeric < 5) {
            const asin = extractAsinFromUrl(productUrl);
            if (asin) {
              try {
                const mobileUrl = `https://www.amazon.com/gp/aw/d/${asin}?psc=1`;
                const mobileRes = await fetch(mobileUrl, {
                  method: "GET",
                  credentials: "include",
                  redirect: "follow",
                  headers: {
                    Accept: "text/html,application/xhtml+xml"
                  }
                });
                if (mobileRes.ok) {
                  const mobileHtml = await mobileRes.text();
                  const mobilePrice =
                    extractPriceFromMobileHtml(mobileHtml) ||
                    extractPriceFromHtml(mobileHtml);

                  const validatedMobilePrice =
                    typeof mobilePrice === "string" && isPlausibleAmazonPriceText(mobilePrice)
                      ? mobilePrice
                      : null;

                  const mobileNumeric = typeof mobilePrice === "string"
                    ? Number(mobilePrice.replace(/[^0-9.]/g, ""))
                    : NaN;

                  if (validatedMobilePrice && !Number.isNaN(mobileNumeric) && mobileNumeric >= 5) {
                    priceText = validatedMobilePrice;
                  } else {
                    console.warn("FairFindz: mobile price fallback did not find main price", {
                      productUrl,
                      asin,
                      mobileStatus: mobileRes.status,
                      extracted: mobilePrice || null
                    });
                  }
                } else {
                  console.warn("FairFindz: mobile price fallback fetch not ok", {
                    productUrl,
                    asin,
                    mobileStatus: mobileRes.status
                  });
                }
              } catch {
                // Ignore mobile fallback failures.
              }
            }
          }
        }

        // If after all strategies we still have a unit-like price, discard it.
        // This ensures the UI falls back to the JSON fallback price rather than showing $1.xx.
        if (typeof priceText === "string") {
          const numeric = Number(priceText.replace(/[^0-9.]/g, ""));
          if (!Number.isNaN(numeric) && numeric > 0 && numeric < 5) {
            priceText = null;
          }
        }

        // Targeted debug: if we extracted a suspiciously small price, it's likely a unit price.
        // Log minimal diagnostics so we can iterate without dumping full HTML.
        if (typeof priceText === "string") {
          const numeric = Number(priceText.replace(/[^0-9.]/g, ""));
          if (!Number.isNaN(numeric) && numeric > 0 && numeric < 5) {
            const hasUnitMarkers = /\/\s*ounce|per\s+ounce|\/\s*oz/i.test(html);
            console.warn(
              "FairFindz: suspicious price extracted (likely unit price)",
              { productUrl, priceText, hasUnitMarkers, status: res.status }
            );
          }
        }

        sendResponse({ rating, reviewCount, priceText: priceText || null });
      } catch {
        sendResponse({ rating: null, reviewCount: null, priceText: null });
      }
    })();

    return true;
  }

  if (!tabId) return;

  if (message.type === "FAIRFINDZ_START_FLASHING") {
    startFlashing(tabId);
  }

  if (message.type === "FAIRFINDZ_STOP_FLASHING") {
    stopFlashing(tabId);
  }

  if (message.type === "FAIRFINDZ_CLEAR_BADGE") {
    stopFlashing(tabId);
  }
  });
}

if (chromeApi && chromeApi.tabs && chromeApi.tabs.onRemoved && chromeApi.tabs.onRemoved.addListener) {
  chromeApi.tabs.onRemoved.addListener((tabId) => {
    stopFlashing(tabId);
  });
}
