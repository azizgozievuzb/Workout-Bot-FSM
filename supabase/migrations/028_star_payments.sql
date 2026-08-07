CREATE TABLE IF NOT EXISTS star_products (
  product_type VARCHAR(32) PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  price_stars INTEGER NOT NULL CHECK (price_stars >= 1),
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO star_products (product_type, title, description, price_stars) VALUES
  ('boost_1_day',  'Буст X2 · 1 день',  'Удвоение капель игрока на 24 часа', 50),
  ('boost_1_week', 'Буст X2 · 1 неделя', 'Удвоение капель игрока на 7 дней',  300)
ON CONFLICT (product_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_type VARCHAR(32) NOT NULL REFERENCES star_products(product_type),
  target_partnership_id UUID REFERENCES partnerships(id) ON DELETE SET NULL,
  amount_stars INTEGER NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  telegram_payment_charge_id VARCHAR(128) UNIQUE,
  invoice_link TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  fulfilled_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payments_buyer_status ON payments (buyer_user_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_status_created ON payments (status, created_at DESC);