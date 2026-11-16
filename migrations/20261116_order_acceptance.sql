-- Apply through the project's migration workflow before enabling the acceptance endpoint.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cleaner_id uuid REFERENCES users(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
CREATE INDEX IF NOT EXISTS orders_pending_feed_idx ON orders (created_at DESC) WHERE status = 'pending';
