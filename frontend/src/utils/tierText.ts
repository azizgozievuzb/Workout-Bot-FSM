import type { AccessTier } from '../stores/authStore';

// Semantics of "subscription = slots" is conveyed by UI text (design decision 7.5.1):
// the Responsible buys a plan, the player-count limit is the product.
export const TIER_LIMIT_LABEL: Record<AccessTier, string> = {
  standard: 'тариф на 1 игрока',
  premium: 'до 2 игроков',
  elite: 'до 3 игроков',
};

/** Форма слова «игрок» после числа в наших контекстах — «до N …» и
 *  «допускает N …» (родительный / винительный одушевлённый): 1 → игрока,
 *  остальные → игроков. Хвост шлифовки S63: «до 1 игроков» / «1 игрок(ов)».
 *  Паттерн тот же, что у pluralDays в DashboardSection. */
export function pluralPlayers(n: number): string {
  return n % 10 === 1 && n % 100 !== 11 ? 'игрока' : 'игроков';
}
