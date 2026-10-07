-- One row per product on the watchlist.
CREATE TABLE products (
    product_id  text PRIMARY KEY,
    url         text NOT NULL,
    title       text,
    image       text,
    store       text,
    first_seen  timestamptz NOT NULL DEFAULT now()
);

-- One row per product per scrape. Never updated, so it is the price history.
CREATE TABLE snapshots (
    product_id        text NOT NULL REFERENCES products,
    scraped_at        timestamptz NOT NULL,
    currency          text NOT NULL,
    price             numeric NOT NULL,  -- cheapest variant
    price_max         numeric,           -- most expensive variant
    original_price    numeric,           -- cheapest variant before discount
    discount_percent  int,
    stock             int,
    rating            numeric,
    reviews           int,
    sold              text,
    PRIMARY KEY (product_id, scraped_at)
);

-- Claude's buy / wait call for each product, one row per digest run.
CREATE TABLE verdicts (
    product_id  text NOT NULL REFERENCES products,
    created_at  timestamptz NOT NULL DEFAULT now(),
    verdict     text NOT NULL CHECK (verdict IN ('buy_now', 'wait', 'watch')),
    reason      text NOT NULL,
    PRIMARY KEY (product_id, created_at)
);

CREATE TABLE digests (
    created_at  timestamptz PRIMARY KEY DEFAULT now(),
    summary     text NOT NULL
);

-- Latest snapshot per product with the previous price and the all-time low.
CREATE VIEW price_report AS
WITH s AS (
    SELECT *,
           lag(price) OVER w  AS prev_price,
           lag(stock) OVER w  AS prev_stock,
           min(price) OVER (PARTITION BY product_id) AS lowest_price,
           max(price) OVER (PARTITION BY product_id) AS highest_price,
           count(*)   OVER (PARTITION BY product_id) AS snapshots,
           row_number() OVER (PARTITION BY product_id ORDER BY scraped_at DESC) AS rn
    FROM snapshots
    WINDOW w AS (PARTITION BY product_id ORDER BY scraped_at)
)
SELECT p.product_id, p.title, p.url, p.image, p.store,
       s.scraped_at, s.currency, s.price, s.prev_price, s.lowest_price, s.highest_price,
       s.original_price, s.discount_percent, s.stock, s.prev_stock,
       s.rating, s.reviews, s.sold, s.snapshots
FROM s JOIN products p USING (product_id)
WHERE s.rn = 1;
