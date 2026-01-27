// API Configuration
// In production (Docker), nginx proxies /api to backend, so use relative URL
// In development, use VITE_API_URL env var or fallback to relative path (Vite proxy)
const isProduction = import.meta.env.PROD;
export const API_BASE = isProduction ? '' : (import.meta.env.VITE_API_URL || '');

// Fetcher for SWR
export const fetcher = (url: string) => fetch(`${API_BASE}${url}`).then(res => res.json());

// API helper functions
export async function apiPost<T>(url: string, data: any): Promise<T> {
    const res = await fetch(`${API_BASE}${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return res.json();
}

export async function apiPut<T>(url: string, data: any): Promise<T> {
    const res = await fetch(`${API_BASE}${url}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return res.json();
}

export async function apiDelete<T>(url: string): Promise<T> {
    const res = await fetch(`${API_BASE}${url}`, { method: 'DELETE' });
    return res.json();
}
