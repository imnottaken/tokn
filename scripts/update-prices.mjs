// Regenerates data/prices.json (the snapshot shipped with the package).
// Run before each release: npm run prices
import { fileURLToPath } from "node:url";
import { refreshPrices } from "../dist/prices.js";

const dest = fileURLToPath(new URL("../data/prices.json", import.meta.url));
const book = await refreshPrices(dest);
console.log(`Wrote ${Object.keys(book.models).length} models to data/prices.json`);
