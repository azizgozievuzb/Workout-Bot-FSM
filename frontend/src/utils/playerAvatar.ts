import type { MyPlayer } from '../api/partnerships';

// 8c (8.8b): наставник видит ТОЛЬКО фото-карточку игрока; бэк отдаёт либо
// купленную card_photo_url, либо путь к мультяшному ассету по полу.
export function playerAvatarUrl(p: Pick<MyPlayer, 'card_photo_url'>): string | null {
  return p.card_photo_url || null;
}
