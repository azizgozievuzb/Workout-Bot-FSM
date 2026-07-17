import api from './client';

export type InviteStatus = 'pending' | 'used' | 'expired';

export interface Invite {
  id: string;
  code: string;
  link: string;
  status: InviteStatus;
  used_by_name: string | null;
  expires_at: string | null;
  created_at: string | null;
}

export async function createInvite(): Promise<Invite> {
  const { data } = await api.post('/invites');
  return data;
}

export async function listInvites(): Promise<Invite[]> {
  const { data } = await api.get('/invites');
  return data;
}

export async function deleteInvite(id: string): Promise<void> {
  await api.delete(`/invites/${id}`);
}
