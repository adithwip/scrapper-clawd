import { test, expect, describe } from "bun:test";
import {
  extractJanCodes,
  extractProductName,
  parseProductLinks,
  BASE_URL,
} from "./scraper";

// ---------------------------------------------------------------------------
// extractJanCodes
// ---------------------------------------------------------------------------

describe("extractJanCodes", () => {
  test("extracts JAN code from JANコード label in a spec table", () => {
    const html = `
      <table class="product-spec">
        <tr><th>JANコード</th><td>4902011743081</td></tr>
      </table>
    `;
    expect(extractJanCodes(html)).toEqual(["4902011743081"]);
  });

  test("extracts JAN code with colon separator", () => {
    const html = `<p>JANコード：4902011859881</p>`;
    expect(extractJanCodes(html)).toEqual(["4902011859881"]);
  });

  test("extracts JAN code from JAN: shorthand", () => {
    const html = `<span>JAN:4902011860801</span>`;
    expect(extractJanCodes(html)).toEqual(["4902011860801"]);
  });

  test("extracts multiple JAN codes from a page with variants", () => {
    const html = `
      <div class="variant" data-jan="4902011109269">M size</div>
      <div class="variant" data-jan="4902011842920">L size</div>
      <table>
        <tr><td>JANコード</td><td>4902011109269</td></tr>
        <tr><td>JANコード</td><td>4902011842920</td></tr>
      </table>
    `;
    const codes = extractJanCodes(html);
    expect(codes).toContain("4902011109269");
    expect(codes).toContain("4902011842920");
    // Should deduplicate
    const unique = [...new Set(codes)];
    expect(codes.length).toBe(unique.length);
  });

  test("finds 49-prefixed JAN codes even without label", () => {
    const html = `<td>4902011745009</td>`;
    expect(extractJanCodes(html)).toEqual(["4902011745009"]);
  });

  test("finds 45-prefixed JAN codes", () => {
    const html = `<span>4512345678901</span>`;
    expect(extractJanCodes(html)).toEqual(["4512345678901"]);
  });

  test("ignores non-JAN 13-digit numbers (wrong prefix)", () => {
    const html = `<span>1234567890123</span>`;
    expect(extractJanCodes(html)).toEqual([]);
  });

  test("ignores 12-digit or 14-digit numbers", () => {
    const html = `<span>490201174308</span><span>49020117430812</span>`;
    expect(extractJanCodes(html)).toEqual([]);
  });

  test("returns empty for HTML without JAN codes", () => {
    const html = `
      <html><body>
        <h1>グーン パンツ</h1>
        <p>体重目安：6kg〜12kg</p>
      </body></html>
    `;
    expect(extractJanCodes(html)).toEqual([]);
  });

  test("handles real-world HTML spec table patterns", () => {
    // Simulated elleair.jp product spec section
    const html = `
      <div class="p-product-detail__spec">
        <dl>
          <dt>内容量</dt><dd>14枚</dd>
          <dt>サイズ</dt><dd>スーパーBIG</dd>
          <dt>JANコード</dt><dd>4902011743081</dd>
        </dl>
      </div>
    `;
    expect(extractJanCodes(html)).toEqual(["4902011743081"]);
  });

  test("handles JAN codes in JSON-LD structured data", () => {
    const html = `
      <script type="application/ld+json">
        {"@type":"Product","gtin13":"4902011860825","name":"グーン スイミングパンツ"}
      </script>
    `;
    expect(extractJanCodes(html)).toContain("4902011860825");
  });
});

// ---------------------------------------------------------------------------
// extractProductName
// ---------------------------------------------------------------------------

describe("extractProductName", () => {
  test("extracts name from typical elleair title", () => {
    const html = `<title>グーン スーパーBIG パンツタイプ｜ベビー用品｜商品情報｜エリエール｜大王製紙</title>`;
    expect(extractProductName(html)).toBe("グーン スーパーBIG パンツタイプ");
  });

  test("handles title without separators", () => {
    const html = `<title>Product Name Only</title>`;
    expect(extractProductName(html)).toBe("Product Name Only");
  });

  test("returns empty string when no title", () => {
    const html = `<html><body>No title here</body></html>`;
    expect(extractProductName(html)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// parseProductLinks
// ---------------------------------------------------------------------------

describe("parseProductLinks", () => {
  test("converts relative hrefs to full URLs", () => {
    const links = parseProductLinks(["/product/detail/baby_superbig_pants"]);
    expect(links).toEqual([
      {
        slug: "baby_superbig_pants",
        url: `${BASE_URL}/product/detail/baby_superbig_pants`,
      },
    ]);
  });

  test("preserves absolute URLs", () => {
    const fullUrl = "https://www.elleair.jp/product/detail/goon_08_0001";
    const links = parseProductLinks([fullUrl]);
    expect(links).toEqual([{ slug: "goon_08_0001", url: fullUrl }]);
  });

  test("handles multiple links", () => {
    const links = parseProductLinks([
      "/product/detail/baby_babywipe",
      "/product/detail/goon_08_0012",
    ]);
    expect(links).toHaveLength(2);
    expect(links[0]!.slug).toBe("baby_babywipe");
    expect(links[1]!.slug).toBe("goon_08_0012");
  });
});

// ---------------------------------------------------------------------------
// results.json validation
// ---------------------------------------------------------------------------

describe("results.json", () => {
  test("exists and has valid structure", async () => {
    const file = Bun.file("results.json");
    expect(await file.exists()).toBe(true);

    const data = await file.json();
    expect(data.source).toBe("https://www.elleair.jp/product/list/baby");
    expect(data.totalProducts).toBeGreaterThan(0);
    expect(data.products).toBeInstanceOf(Array);
    expect(data.products.length).toBe(data.totalProducts);
  });

  test("all products have required fields", async () => {
    const data = await Bun.file("results.json").json();
    for (const p of data.products) {
      expect(p.slug).toBeDefined();
      expect(p.url).toMatch(/^https:\/\/www\.elleair\.jp\/product\/detail\//);
      expect(p.name).toBeDefined();
      expect(p.janCodes).toBeInstanceOf(Array);
      expect(p.janCodes.length).toBeGreaterThan(0);
    }
  });

  test("all JAN codes are valid 13-digit numbers starting with 49", async () => {
    const data = await Bun.file("results.json").json();
    for (const p of data.products) {
      for (const jan of p.janCodes) {
        expect(jan).toMatch(/^49\d{11}$/);
      }
    }
  });

  test("JAN codes are unique across products (no accidental duplicates except shared products)", async () => {
    const data = await Bun.file("results.json").json();
    const allJanCodes = data.products.flatMap(
      (p: { janCodes: string[] }) => p.janCodes
    );
    // Allow some duplicates (e.g. baby_pants_gungun_big and goon_08_0015 share JAN)
    // but most should be unique
    const unique = [...new Set(allJanCodes)];
    const dupeRatio = unique.length / allJanCodes.length;
    expect(dupeRatio).toBeGreaterThan(0.9);
  });

  test("contains expected known products", async () => {
    const data = await Bun.file("results.json").json();
    const slugs = data.products.map((p: { slug: string }) => p.slug);

    // Spot check key products
    expect(slugs).toContain("baby_superbig_pants");
    expect(slugs).toContain("baby_babywipe");
    expect(slugs).toContain("goon_08_0001");
    expect(slugs).toContain("baby_swimming_m");
    expect(slugs).toContain("baby_night_jr_pants");
  });

  test("known JAN code matches expected product", async () => {
    const data = await Bun.file("results.json").json();
    const superBig = data.products.find(
      (p: { slug: string }) => p.slug === "baby_superbig_pants"
    );
    expect(superBig).toBeDefined();
    expect(superBig.janCodes).toContain("4902011743081");
  });
});
