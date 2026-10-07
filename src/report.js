// Write reports/index.html: every product with its price trend, stock and Claude's latest call.
import { mkdir, writeFile } from 'node:fs/promises';
import { db } from './db.js';

const { rows: products } = await db.query(
    `SELECT r.*, v.verdict, v.reason
     FROM price_report r
     LEFT JOIN LATERAL (
         SELECT verdict, reason FROM verdicts
         WHERE product_id = r.product_id ORDER BY created_at DESC LIMIT 1
     ) v ON true
     ORDER BY (r.price - r.prev_price) / r.prev_price NULLS LAST, r.title`,
);
const { rows: history } = await db.query(
    `SELECT product_id, min(price)::float AS price
     FROM snapshots
     WHERE scraped_at > now() - interval '90 days'
     GROUP BY product_id, date_trunc('day', scraped_at)
     ORDER BY product_id, date_trunc('day', scraped_at)`,
);
const { rows: [digest] } = await db.query('SELECT * FROM digests ORDER BY created_at DESC LIMIT 1');
await db.end();

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const money = (n, currency) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);

function sparkline(prices, w = 140, h = 36) {
    if (prices.length < 2) return '<span class="muted">collecting history</span>';
    const min = Math.min(...prices);
    const range = Math.max(...prices) - min || 1;
    const xy = prices.map((p, i) => [
        (i / (prices.length - 1)) * w,
        h - 3 - ((p - min) / range) * (h - 6),
    ]);
    const [lx, ly] = xy.at(-1);
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
        <polyline points="${xy.map((p) => p.join(',')).join(' ')}" fill="none" stroke="#6366f1" stroke-width="1.8" stroke-linejoin="round"/>
        <circle cx="${lx}" cy="${ly}" r="3" fill="#6366f1"/></svg>`;
}

function change(p) {
    if (p.prev_price == null) return '<span class="badge">new</span>';
    const pct = ((p.price - p.prev_price) / p.prev_price) * 100;
    if (Math.abs(pct) < 0.5) return '<span class="badge">no change</span>';
    return `<span class="badge ${pct < 0 ? 'down' : 'up'}">${pct < 0 ? '▼' : '▲'} ${Math.abs(pct).toFixed(1)}%</span>`;
}

const VERDICTS = { buy_now: 'Buy now', wait: 'Wait', watch: 'Watch' };

const rows = products.map((p) => {
    const atLow = Number(p.price) <= Number(p.lowest_price) && Number(p.highest_price) > Number(p.lowest_price);
    const stockDelta = p.prev_stock != null && p.stock !== p.prev_stock ? ` (${p.stock > p.prev_stock ? '+' : ''}${p.stock - p.prev_stock})` : '';
    return `<tr>
        <td><div class="product">
            <img src="${esc(p.image)}" alt="" loading="lazy">
            <div><a href="${esc(p.url)}">${esc(p.title)}</a>
            <div class="muted">${esc(p.store)} · ★ ${p.rating ?? '–'} · ${esc(p.sold ?? '')}</div></div>
        </div></td>
        <td class="num"><strong>${money(p.price, p.currency)}</strong><br>${change(p)}</td>
        <td>${sparkline(history.filter((h) => h.product_id === p.product_id).map((h) => h.price))}
            <div class="muted">low ${money(p.lowest_price, p.currency)}${atLow ? ' <span class="low">lowest yet</span>' : ''} · high ${money(p.highest_price, p.currency)}</div></td>
        <td class="num">${p.stock?.toLocaleString('en-US') ?? '–'}<div class="muted">${stockDelta}</div></td>
        <td>${p.verdict ? `<span class="verdict ${p.verdict}">${VERDICTS[p.verdict]}</span><div class="reason">${esc(p.reason)}</div>` : '<span class="muted">run npm run digest</span>'}</td>
    </tr>`;
}).join('\n');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AliExpress price tracker</title>
<style>
    body { font: 14px/1.45 system-ui, -apple-system, sans-serif; color: #111827; background: #f8fafc; margin: 0; padding: 32px; }
    main { max-width: 1180px; margin: auto; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .muted { color: #6b7280; font-size: 12px; }
    .summary { background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 10px; padding: 14px 16px; margin: 20px 0; }
    .summary b { color: #4338ca; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px #0000001a; }
    th { text-align: left; font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: .04em; padding: 12px 14px; background: #f9fafb; }
    td { padding: 14px; border-top: 1px solid #f1f5f9; vertical-align: top; }
    .product { display: flex; gap: 12px; max-width: 380px; }
    .product img { width: 56px; height: 56px; object-fit: cover; border-radius: 8px; flex: none; }
    .product a { color: inherit; text-decoration: none; font-weight: 500; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .num { white-space: nowrap; }
    .num strong { font-size: 16px; }
    .badge { display: inline-block; margin-top: 4px; font-size: 12px; padding: 1px 8px; border-radius: 999px; background: #f1f5f9; color: #475569; }
    .badge.down { background: #dcfce7; color: #15803d; }
    .badge.up { background: #fee2e2; color: #b91c1c; }
    .low { color: #15803d; font-weight: 600; }
    .verdict { display: inline-block; font-size: 12px; font-weight: 600; padding: 2px 10px; border-radius: 999px; }
    .verdict.buy_now { background: #15803d; color: #fff; }
    .verdict.wait { background: #fef3c7; color: #92400e; }
    .verdict.watch { background: #e2e8f0; color: #334155; }
    .reason { margin-top: 6px; font-size: 13px; color: #374151; max-width: 320px; }
</style></head>
<body><main>
    <h1>AliExpress price tracker</h1>
    <div class="muted">${products.length} products · updated ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</div>
    ${digest ? `<div class="summary"><b>AI digest</b> · ${esc(digest.summary)}</div>` : ''}
    <table>
        <thead><tr><th>Product</th><th>Price</th><th>Last 90 days</th><th>Stock</th><th>AI call</th></tr></thead>
        <tbody>${rows}</tbody>
    </table>
</main></body></html>`;

await mkdir('reports', { recursive: true });
await writeFile('reports/index.html', html);
console.log(`Wrote reports/index.html (${products.length} products)`);
