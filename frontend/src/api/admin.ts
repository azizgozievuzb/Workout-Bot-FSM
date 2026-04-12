import api from './client';

export interface PromoCodeInfo {
    id: string;
    code: string;
    code_type: string;
    tier: string;
    is_used: boolean;
    used_by: string | null;
    responsible_id: string | null;
    created_at: string | null;
}

export async function createPromoCodes(tier: string = 'basic', count: number = 1) {
    const res = await api.post('/admin/promo/create', { tier, count });
    return res.data as { codes: string[] };
}

export async function listPromoCodes(params?: { code_type?: string; is_used?: boolean; tier?: string }) {
    const res = await api.get('/admin/promo/list', { params });
    return res.data as { codes: PromoCodeInfo[] };
}
