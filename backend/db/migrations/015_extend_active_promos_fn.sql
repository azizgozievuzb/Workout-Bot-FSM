CREATE OR REPLACE FUNCTION extend_active_promos_by_seconds(p_seconds INT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE promo_codes
  SET expires_at = expires_at + (p_seconds || ' seconds')::INTERVAL
  WHERE is_used = TRUE
    AND expires_at IS NOT NULL
    AND expires_at > now();
END;
$$;
