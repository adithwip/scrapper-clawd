import { main } from "./scraper";

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
