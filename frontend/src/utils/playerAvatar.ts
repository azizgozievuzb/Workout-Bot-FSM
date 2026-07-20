import type { MyPlayer } from '../api/partnerships';

// Styled avatar for the current theme; falls back to the raw selfie when the
// stylized version isn't ready yet.
export function playerAvatarUrl(
  p: Pick<MyPlayer, 'photo_dark_url' | 'photo_light_url' | 'profile_photo_url'>,
  theme: 'dark' | 'light',
): string | null {
  const styled = theme === 'dark' ? p.photo_dark_url : p.photo_light_url;
  return styled || p.profile_photo_url || null;
}
