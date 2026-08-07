INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('promises', 'promises', FALSE, 52428800,
        ARRAY['video/webm', 'video/mp4', 'video/quicktime'])
ON CONFLICT (id) DO UPDATE SET public = FALSE;

DROP TABLE IF EXISTS purchases;
DROP TABLE IF EXISTS shop_items;
DROP TABLE IF EXISTS boosts;

DELETE FROM star_products WHERE product_type IN ('boost_1_day', 'boost_1_week');