import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseDotEnvFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split(/\r?\n/);
    const env = {};
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
    return env;
  } catch {
    return {};
  }
}

function getEnv() {
  const repoRoot = path.resolve(__dirname, "..");
  const envLocalPath = path.join(repoRoot, ".env.local");
  const fromFile = parseDotEnvFile(envLocalPath);

  return {
    SUPABASE_URL: process.env.SUPABASE_URL || fromFile.SUPABASE_URL || "",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || fromFile.SUPABASE_SERVICE_ROLE_KEY || ""
  };
}

function parsePriceToNumeric(priceText) {
  if (priceText == null) return null;
  const s = String(priceText).trim();
  if (!s) return null;

  // Accept formats like "$25.00" or "25.00".
  const cleaned = s.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

function toTextArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((v) => (v == null ? "" : String(v).trim()))
      .filter(Boolean);
  }
  return [];
}

function toNullableText(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function toNullableNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toNullableInt(value) {
  const n = toNullableNumber(value);
  if (n == null) return null;
  const i = Math.trunc(n);
  return Number.isFinite(i) ? i : null;
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getEnv();

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Create .env.local (see .env.example)."
    );
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const repoRoot = path.resolve(__dirname, "..");
  const sourcePath = path.join(repoRoot, "data", "businesses.json");

  let json;
  try {
    json = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  } catch (err) {
    console.error("Failed to read/parse data/businesses.json:", err?.message || err);
    process.exit(1);
  }

  const products = Array.isArray(json?.products) ? json.products : [];
  if (!products.length) {
    console.log("No products found in businesses.json");
    return;
  }

  const rows = [];
  let skippedMissingUrl = 0;
  let skippedMissingBasics = 0;

  for (const p of products) {
    const id = toNullableText(p?.id);
    const name = toNullableText(p?.name);
    const brand = toNullableText(p?.brand);
    const category = toNullableText(p?.category);
    const productUrl = toNullableText(p?.productUrl);

    if (!productUrl) {
      skippedMissingUrl += 1;
      continue;
    }

    if (!id || !name || !brand || !category) {
      skippedMissingBasics += 1;
      continue;
    }

    rows.push({
      id,
      name,
      brand,
      category,
      price: parsePriceToNumeric(p?.price),
      rating: toNullableNumber(p?.rating),
      review_count: toNullableInt(p?.reviewCount),
      image_url: toNullableText(p?.imageUrl),
      product_url: productUrl,
      description: toNullableText(p?.description),
      badges: toTextArray(p?.badges),
      amazon_keywords: toTextArray(p?.amazonKeywords),
      amazon_categories: toTextArray(p?.amazonCategories),
      is_active: true
    });
  }

  console.log("Import plan:");
  console.log(`- Total in JSON: ${products.length}`);
  console.log(`- To upsert: ${rows.length}`);
  console.log(`- Skipped (missing productUrl): ${skippedMissingUrl}`);
  console.log(`- Skipped (missing id/name/brand/category): ${skippedMissingBasics}`);

  if (!rows.length) {
    console.log("No valid rows to import.");
    return;
  }

  const batchSize = 200;
  let upserted = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    const { error } = await supabase
      .from("products")
      .upsert(batch, { onConflict: "id" });

    if (error) {
      console.error("Upsert failed:", error);
      process.exit(1);
    }

    upserted += batch.length;
    console.log(`Upserted ${upserted}/${rows.length}...`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("Importer crashed:", err);
  process.exit(1);
});
