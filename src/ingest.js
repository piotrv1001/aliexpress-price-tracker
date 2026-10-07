// Scrape every product on the watchlist and store one price snapshot per product.
//   npm run ingest                 run the Actor on watchlist.txt
//   npm run ingest -- <datasetId>  import a dataset from an earlier Actor run instead
import { readFile } from 'node:fs/promises';
import { ApifyClient } from 'apify-client';
import { db } from './db.js';

const ACTOR_ID = 'piotrv1001/aliexpress-product-details-scraper';
const { SHIP_TO = 'US', CURRENCY = 'USD' } = process.env;

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

async function scrapeWatchlist() {
    const urls = (await readFile('watchlist.txt', 'utf8'))
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));

    console.log(`Scraping ${urls.length} products (ship to ${SHIP_TO}, ${CURRENCY})...`);
    const run = await client.actor(ACTOR_ID).call({
        productUrls: urls.map((url) => ({ url })),
        shipTo: SHIP_TO,
        currency: CURRENCY,
        maxItems: urls.length,
    }, { log: null });
    console.log(`Run ${run.status}: https://console.apify.com/actors/runs/${run.id}`);
    return run.defaultDatasetId;
}

async function save(item) {
    await db.query(
        `INSERT INTO products (product_id, url, title, image, store)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (product_id) DO UPDATE
         SET title = EXCLUDED.title, image = EXCLUDED.image, store = EXCLUDED.store`,
        [item.productId, item.url, item.title, item.images?.[0], item.store?.name],
    );
    await db.query(
        `INSERT INTO snapshots (product_id, scraped_at, currency, price, price_max, original_price,
                                discount_percent, stock, rating, reviews, sold)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT DO NOTHING`,
        [
            item.productId, item.scrapedAt, item.currency, item.price.min, item.price.max,
            item.originalPrice?.min, item.discountPercent, item.totalStock,
            item.rating, item.reviewCount, item.sold,
        ],
    );
}

const datasetIds = process.argv.length > 2 ? process.argv.slice(2) : [await scrapeWatchlist()];

for (const datasetId of datasetIds) {
    const { items } = await client.dataset(datasetId).listItems();
    let saved = 0;
    for (const item of items) {
        // Skip removed or region-locked products, and prices in another currency
        // (they would break the price history).
        if (item.status !== 'ok' || !item.price) {
            console.log(`  skipped ${item.url}: ${item.status}`);
        } else if (item.currency !== CURRENCY) {
            console.log(`  skipped ${item.url}: priced in ${item.currency}, not ${CURRENCY}`);
        } else {
            await save(item);
            saved++;
        }
    }
    console.log(`Saved ${saved} of ${items.length} products from dataset ${datasetId}`);
}

await db.end();
