import type { AccessTier } from '../stores/authStore';

// Semantics of "subscription = slots" is conveyed by UI text (design decision 7.5.1):
// the Responsible buys a plan, the player-count limit is the product.
export const TIER_LIMIT_LABEL: Record<AccessTier, string> = {
  standard: 'тариф на 1 игрока',
  premium: 'до 2 игроков',
  elite: 'до 3 игроков',
};
