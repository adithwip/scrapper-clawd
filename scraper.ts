/**
 * Elleair Baby Product JAN Code Scraper
 *
 * Scrapes JAN codes from all baby product detail pages on elleair.jp.
 * Uses only Bun built-in APIs: fetch + HTMLRewriter (zero external deps).
 *
 * URL structure:
 *   Listing:  https://www.elleair.jp/product/list/baby
 *   Detail:   https://www.elleair.jp/product/detail/{slug}
 */

export const BASE_URL = "https://www.elleair.jp";
export const LISTING_URL = `${BASE_URL}/product/list/baby`;
export const DELAY_MS = 1000; // polite delay between requests

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
  "Accept-Encoding": "gzip, deflate, br",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProductLink {
  slug: string;
  url: string;
}

export interface ProductResult {
  slug: string;
  url: string;
  name: string;
  janCodes: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(url: string): Promise<Response> {
  const resp = await fetch(url, { headers: HEADERS, redirect: "follow" });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} for ${url}`);
  }
  return resp;
}

// ---------------------------------------------------------------------------
// Step 1 – Discover product detail links from the listing page
// ---------------------------------------------------------------------------

export async function discoverProductLinks(): Promise<ProductLink[]> {
  console.log(`[1/3] Fetching listing page: ${LISTING_URL}`);

  const resp = await fetchPage(LISTING_URL);
  const links = new Set<string>();

  const rewriter = new HTMLRewriter().on('a[href*="/product/detail/"]', {
    element(el) {
      const href = el.getAttribute("href");
      if (href) links.add(href);
    },
  });

  await rewriter.transform(resp).text();

  const products = parseProductLinks([...links]);
  console.log(`       Found ${products.length} product detail links`);
  return products;
}

/** Parse raw href strings into ProductLink objects (exported for testing) */
export function parseProductLinks(hrefs: string[]): ProductLink[] {
  return hrefs.map((href) => {
    const fullUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`;
    const slug = href.split("/product/detail/").pop() ?? href;
    return { slug, url: fullUrl };
  });
}

// ---------------------------------------------------------------------------
// Step 2 – Extract JAN codes from HTML (exported for testing)
// ---------------------------------------------------------------------------

/** Extract the product name from the HTML <title> tag */
export function extractProductName(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    return titleMatch[1]!.split("｜")[0]!.trim();
  }
  return "";
}

/** Extract JAN codes from raw HTML using multiple strategies */
export function extractJanCodes(html: string): string[] {
  const janCodes: string[] = [];

  // Strategy 1: JANコード label near a 13-digit number
  const janLabelRegex = /JAN[コード：:\s]*[：:\s]*(\d{13})/gi;
  let match: RegExpExecArray | null;
  while ((match = janLabelRegex.exec(html)) !== null) {
    janCodes.push(match[1]!);
  }

  // Strategy 2: 13-digit numbers starting with 49 (Japan JAN prefix)
  const allJanRegex = /\b(49\d{11})\b/g;
  while ((match = allJanRegex.exec(html)) !== null) {
    if (!janCodes.includes(match[1]!)) {
      janCodes.push(match[1]!);
    }
  }

  // Strategy 3: 13-digit numbers starting with 45 (alternate Japan prefix)
  const altJanRegex = /\b(45\d{11})\b/g;
  while ((match = altJanRegex.exec(html)) !== null) {
    if (!janCodes.includes(match[1]!)) {
      janCodes.push(match[1]!);
    }
  }

  return janCodes;
}

/** Scrape a single product detail page for JAN codes */
export async function scrapeProductDetail(
  product: ProductLink
): Promise<ProductResult> {
  const result: ProductResult = {
    slug: product.slug,
    url: product.url,
    name: "",
    janCodes: [],
  };

  try {
    const resp = await fetchPage(product.url);
    const html = await resp.text();

    result.name = extractProductName(html);
    result.janCodes = extractJanCodes(html);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Step 3 – Run the full scrape
// ---------------------------------------------------------------------------

export async function main() {
  console.log("=== Elleair Baby Product JAN Code Scraper ===\n");

  const products = await discoverProductLinks();

  if (products.length === 0) {
    console.error(
      "No product links found. The page may require JavaScript rendering."
    );
    console.error(
      "Try running with a headless browser or check the listing page manually."
    );
    process.exit(1);
  }

  console.log(`\n[2/3] Scraping ${products.length} product detail pages...\n`);

  const results: ProductResult[] = [];

  for (let i = 0; i < products.length; i++) {
    const product = products[i]!;
    const progress = `[${i + 1}/${products.length}]`;

    process.stdout.write(`  ${progress} ${product.slug} ... `);

    const result = await scrapeProductDetail(product);
    results.push(result);

    if (result.error) {
      console.log(`ERROR: ${result.error}`);
    } else if (result.janCodes.length === 0) {
      console.log(`no JAN codes found`);
    } else {
      console.log(`${result.janCodes.join(", ")}`);
    }

    if (i < products.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  // Summary
  console.log("\n[3/3] Results Summary\n");
  console.log("=".repeat(80));

  const withJan = results.filter((r) => r.janCodes.length > 0);
  const withErrors = results.filter((r) => r.error);
  const withoutJan = results.filter(
    (r) => r.janCodes.length === 0 && !r.error
  );

  console.log(`${"Product".padEnd(50)} ${"JAN Code(s)".padEnd(30)}`);
  console.log("-".repeat(80));

  for (const r of results) {
    const name = (r.name || r.slug).slice(0, 48);
    if (r.error) {
      console.log(`${name.padEnd(50)} ERROR: ${r.error}`);
    } else if (r.janCodes.length > 0) {
      console.log(`${name.padEnd(50)} ${r.janCodes.join(", ")}`);
    } else {
      console.log(`${name.padEnd(50)} (none found)`);
    }
  }

  console.log("-".repeat(80));
  console.log(
    `Total: ${results.length} products | ${withJan.length} with JAN | ${withoutJan.length} without JAN | ${withErrors.length} errors`
  );

  // Write JSON output
  const outputPath = "results.json";
  const output = {
    scrapedAt: new Date().toISOString(),
    source: LISTING_URL,
    totalProducts: results.length,
    productsWithJan: withJan.length,
    products: results.map((r) => ({
      slug: r.slug,
      url: r.url,
      name: r.name,
      janCodes: r.janCodes,
      ...(r.error ? { error: r.error } : {}),
    })),
  };

  await Bun.write(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nJSON output written to ${outputPath}`);
}
