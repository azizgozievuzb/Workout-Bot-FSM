import api from './client';

export interface FeedItem {
  id: string;
  source_user_id: string;
  event_type: 'workout_done' | 'streak_lost' | 'shop_purchase' | 'boost_activated' | 'ping' | 'milestone';
  payload: Record<string, any>;
  is_read: boolean;
  created_at: string;
}

export interface FeedResponse {
  items: FeedItem[];
  total: number;
}

export async function getFeed(limit = 20, offset = 0): Promise<FeedResponse> {
  const { data } = await api.get('/feed', { params: { limit, offset } });
  return data;
}

export async function markAsRead(ids: string[]): Promise<void> {
  await api.post('/feed/read', { ids });
}

export async function getUnreadCount(): Promise<number> {
  const { data } = await api.get('/feed/unread-count');
  return data.count;
}
