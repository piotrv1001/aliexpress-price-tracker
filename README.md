# AliExpress Price Tracker — Node.js, Postgres and Claude

![AliExpress price tracker](docs/banner.png)

Track AliExpress prices and stock for a list of products, keep the full price history in Postgres, and get a daily
report with a **buy now / wait / watch** call from Claude for every product.

It's a small data pipeline you can run on your laptop or on a cron job: the
[AliExpress Product Details Scraper](https://apify.com/piotrv1001/aliexpress-product-details-scraper) on Apify does
the scraping (no proxies, captchas or browser automation on your side), Postgres runs in Docker, and the AI step is
optional.

![Price report with 90-day sparklines, price changes and AI calls](docs/report.png)

## How it works

```mermaid
flowchart LR
    W[watchlist.txt] --> I
    subgraph pipeline [npm start]
        I[ingest<br/>Apify Actor] --> DB[(Postgres<br/>price history)]
        DB --> D[digest<br/>Claude]
        D --> DB
        DB --> R[report]
    end
    R --> H[reports/index.html]
```

| Step | Command | What it does |
| --- | --- | --- |
| Ingest | `npm run ingest` | Runs the Actor on every URL in `watchlist.txt` and stores one snapshot per product: lowest and highest variant price, list price, discount, stock, rating, reviews and units sold. |
| Digest | `npm run digest` | Sends each product's current price, lowest and highest price seen, stock change and daily price history to Claude, and stores a verdict with a one-line reason. Skipped if `ANTHROPIC_API_KEY` isn't set. |
| Report | `npm run report` | Writes `reports/index.html`: products sorted by price change, a 90-day sparkline, a "lowest yet" flag, stock change and the AI call. |

Snapshots are never overwritten, so the history keeps growing with every run.

## Quick start

You need [Node.js](https://nodejs.org/) 22 or newer, [Docker](https://docs.docker.com/get-docker/), an
[Apify account](https://console.apify.com/sign-up) and, for the AI digest, an
[Anthropic API key](https://console.anthropic.com/).

```bash
git clone https://github.com/piotrv1001/aliexpress-price-tracker.git
cd aliexpress-price-tracker
docker compose up -d          # Postgres 17, schema created on first start
npm install
cp .env.example .env          # add APIFY_TOKEN and ANTHROPIC_API_KEY
npm start                     # ingest → digest → report
open reports/index.html
```

Put your own products in `watchlist.txt`, one URL per line.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `APIFY_TOKEN` | – | [Apify API token](https://console.apify.com/settings/integrations) |
| `DATABASE_URL` | `postgres://tracker:tracker@localhost:5432/tracker` | Any Postgres 13+ works |
| `SHIP_TO` | `US` | Country that prices, stock and shipping are calculated for |
| `CURRENCY` | `USD` | Currency for all prices |
| `ANTHROPIC_API_KEY` | – | Optional; without it the digest step is skipped |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Any Claude model, e.g. `claude-haiku-4-5` for a cheaper run |

Prices from a different country or currency are skipped instead of being mixed into the history.

## Run it every day

Prices on AliExpress change daily, so run the pipeline once a day. With cron (`crontab -e`):

```cron
0 8 * * * cd /path/to/aliexpress-price-tracker && npm start >> tracker.log 2>&1
```

Already ran the Actor in Apify Console? Import those runs to backfill history:

```bash
npm run ingest -- <datasetId> <datasetId> ...
```

## Query the history

Everything is plain SQL. `price_report` is a view with the latest snapshot per product, the previous price and the
lowest and highest price seen.

```sql
-- Products at their lowest price so far
SELECT title, price, highest_price
FROM price_report
WHERE price <= lowest_price AND highest_price > lowest_price;

-- Biggest price drops since the previous run
SELECT title, prev_price, price, round(100 * (price - prev_price) / prev_price, 1) AS change_pct
FROM price_report
WHERE price < prev_price
ORDER BY change_pct;

-- Daily lowest price for one product
SELECT date_trunc('day', scraped_at) AS day, min(price)
FROM snapshots WHERE product_id = '1005006959700436'
GROUP BY 1 ORDER BY 1;
```

Connect with `docker compose exec db psql -U tracker`.

## Cost

Pricing as of October 7, 2026:

- **Apify:** $0.005 per product plus a $0.00005 start fee per run. Tracking 7 products daily costs about $0.04 a day,
  or around $1 a month. See [current pricing](https://apify.com/piotrv1001/aliexpress-product-details-scraper/pricing).
  The Apify free plan includes $5 of monthly usage.
- **Claude:** one request per run for the whole watchlist, a few cents with the default model.

## Project structure

```
db/schema.sql      tables: products, snapshots, verdicts, digests; view: price_report
src/ingest.js      runs the Actor (or imports datasets) and saves snapshots
src/digest.js      Claude buy / wait / watch call per product
src/report.js      HTML report
watchlist.txt      the products you track
```

## Related

- [AliExpress Product Details Scraper](https://apify.com/piotrv1001/aliexpress-product-details-scraper) — the Actor
  this pipeline runs, with variants, shipping options, store data and more fields than are stored here
- [LinkedIn jobs AI matcher](https://github.com/piotrv1001/linkedin-jobs-ai-matcher) — the same pipeline pattern for
  job hunting
- [Clutch lead generation pipeline](https://github.com/piotrv1001/clutch-lead-generation-pipeline) — the same pattern
  for B2B leads
- [Mercado Libre price tracker](https://github.com/piotrv1001/mercado-libre-price-tracker) — tracks a whole search instead of a watchlist, with Claude grouping listings
  into comparable models
- [Brand mention monitor](https://github.com/piotrv1001/brand-mention-monitor) — the same pattern for Threads, Reddit and Google News mentions
