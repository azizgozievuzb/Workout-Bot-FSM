CREATE OR REPLACE FUNCTION buy_paid_freeze(p_player_id uuid, p_price int)
RETURNS jsonb AS $$
DECLARE r record;
BEGIN
  UPDATE player_stats
     SET drops_balance = drops_balance - p_price,
         paid_freezes  = COALESCE(paid_freezes, 0) + 1
   WHERE player_id = p_player_id
     AND drops_balance >= p_price
     AND COALESCE(paid_freezes, 0) < 3
  RETURNING drops_balance, paid_freezes INTO r;
  IF NOT FOUND THEN
    SELECT drops_balance, COALESCE(paid_freezes, 0) AS paid_freezes INTO r
      FROM player_stats WHERE player_id = p_player_id;
    RETURN jsonb_build_object(
      'ok', false,
      'balance', COALESCE(r.drops_balance, 0),
      'paid_freezes', COALESCE(r.paid_freezes, 0));
  END IF;
  RETURN jsonb_build_object('ok', true, 'balance', r.drops_balance, 'paid_freezes', r.paid_freezes);
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION restore_streak(p_player_id uuid, p_price int, p_expected_len int, p_max_age_hours int)
RETURNS jsonb AS $$
DECLARE r record;
BEGIN
  UPDATE player_stats
     SET current_streak  = lost_streak_len,
         best_streak     = GREATEST(COALESCE(best_streak, 0), lost_streak_len),
         drops_balance   = drops_balance - p_price,
         lost_streak_len = NULL,
         lost_streak_at  = NULL
   WHERE player_id = p_player_id
     AND COALESCE(lost_streak_len, 0) > 0
     AND lost_streak_len = p_expected_len
     AND lost_streak_at >= now() - make_interval(hours => p_max_age_hours)
     AND drops_balance >= p_price
  RETURNING drops_balance, current_streak INTO r;
  IF NOT FOUND THEN
    SELECT drops_balance INTO r FROM player_stats WHERE player_id = p_player_id;
    RETURN jsonb_build_object('ok', false, 'balance', COALESCE(r.drops_balance, 0));
  END IF;
  RETURN jsonb_build_object('ok', true, 'balance', r.drops_balance, 'current_streak', r.current_streak);
END $$ LANGUAGE plpgsql;