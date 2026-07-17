import api from './client';

export interface StarProduct {
    product_type: string;
    title: string;
    description: string;
    price_stars: number;
}

export interface InvoiceResponse {
    payment_id: string;
    invoice_link: string;
}

export type PaymentStatus = 'pending' | 'paid' | 'fulfilled' | 'failed' | 'refunded';

export interface PaymentStatusResponse {
    status: PaymentStatus;
}

export async function getProducts(): Promise<StarProduct[]> {
    const { data } = await api.get('/payments/products');
    return data;
}

export async function createInvoice(productType: string, playerId: string): Promise<InvoiceResponse> {
    const { data } = await api.post('/payments/invoice', { product_type: productType, player_id: playerId });
    return data;
}

export async function getPayment(id: string): Promise<PaymentStatusResponse> {
    const { data } = await api.get(`/payments/${id}`);
    return data;
}
