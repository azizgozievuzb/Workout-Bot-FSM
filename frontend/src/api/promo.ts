import api from './client';

export async function activatePromo(code: string) {
    const res = await api.post('/promo/activate', { code });
    return res.data;
}

export async function activatePromoLink(token: string) {
    const res = await api.post(`/promo/activate-link/${token}`);
    return res.data;
}

export async function getMyPlayerCode() {
    const res = await api.get('/promo/my-player-code');
    return res.data;
}
