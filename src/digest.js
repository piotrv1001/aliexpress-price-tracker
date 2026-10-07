// Ask Claude for a buy / wait / watch call on every product, based on its price history.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { db } from './db.js';

if (!process.env.ANTHROPIC_API_KEY) {
    console.log('ANTHROPIC_API_KEY is not set, skipping the AI digest.');
    process.exit(0);
}

const Digest = z.object({
    summary: z.string().describe('Two or three sentences on what changed across the watchlist'),
    products: z.array(z.object({
        productId: z.string(),
        verdict: z.enum(['buy_now', 'wait', 'watch']),
        reason: z.string().describe('One sentence, citing the numbers that drove the call'),
    })),
});

const { rows: products } = await db.query('SELECT * FROM price_report ORDER BY title');
const { rows: history } = await db.query(
    `SELECT product_id, to_char(scraped_at, 'YYYY-MM-DD') AS day, min(price) AS price
     FROM snapshots
     WHERE scraped_at > now() - interval '90 days'
     GROUP BY 1, 2 ORDER BY 1, 2`,
);

const watchlist = products.map((p) => ({
    productId: p.product_id,
    title: p.title,
    currency: p.currency,
    price: Number(p.price),
    previousPrice: p.prev_price && Number(p.prev_price),
    lowestSeen: Number(p.lowest_price),
    highestSeen: Number(p.highest_price),
    listPrice: p.original_price && Number(p.original_price),
    stock: p.stock,
    previousStock: p.prev_stock,
    rating: p.rating && Number(p.rating),
    reviews: p.reviews,
    sold: p.sold,
    dailyLowestPrice: Object.fromEntries(
        history.filter((h) => h.product_id === p.product_id).map((h) => [h.day, Number(h.price)]),
    ),
}));

const client = new Anthropic();
const response = await client.messages.parse({
    model: process.env.CLAUDE_MODEL ?? 'claude-opus-5-5',
    max_tokens: 16000,
    output_config: { effort: 'low', format: zodOutputFormat(Digest) },
    system: `You review an AliExpress price watchlist for a shopper.
For each product decide:
- buy_now: the price is at or near its lowest seen, or stock is running out
- wait: the price is above its usual level and likely to drop again
- watch: not enough history or nothing notable
"listPrice" is the crossed-out price AliExpress shows, which is often inflated, so trust the history more than the discount.`,
    messages: [{ role: 'user', content: JSON.stringify(watchlist) }],
});

if (response.stop_reason !== 'end_turn' || !response.parsed_output) {
    console.error(`No digest: Claude stopped with "${response.stop_reason}".`);
    process.exit(1);
}

const { summary, products: verdicts } = response.parsed_output;
const createdAt = new Date();
await db.query('INSERT INTO digests (created_at, summary) VALUES ($1, $2)', [createdAt, summary]);
for (const v of verdicts) {
    if (!products.some((p) => p.product_id === v.productId)) continue;
    await db.query(
        'INSERT INTO verdicts (product_id, created_at, verdict, reason) VALUES ($1, $2, $3, $4)',
        [v.productId, createdAt, v.verdict, v.reason],
    );
    console.log(`${v.verdict.padEnd(7)} ${v.productId}  ${v.reason}`);
}
console.log(`\n${summary}`);

await db.end();
