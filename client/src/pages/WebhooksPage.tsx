import useSWR, { useSWRConfig } from 'swr';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useState } from 'react';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';

const fetcher = (url: string) => fetch(url).then(res => res.json());

export default function WebhooksPage() {
    const { mutate } = useSWRConfig();
    const [page, setPage] = useState(1);
    const { data, isLoading } = useSWR(`/api/admin/webhooks?page=${page}&limit=20`, fetcher, { refreshInterval: 2000 });

    const [isClearing, setIsClearing] = useState(false);

    const handleClear = async () => {
        if (!confirm('Are you sure you want to delete ALL webhook history?')) return;

        setIsClearing(true);
        try {
            const res = await fetch('/api/admin/webhooks', { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed to delete');

            // Revalidate all webhook keys
            mutate(key => typeof key === 'string' && key.startsWith('/api/admin/webhooks'));
            alert('History cleared successfully');
        } catch (e) {
            alert('Failed to clear history');
        } finally {
            setIsClearing(false);
        }
    };

    if (isLoading) return <div>Loading logs...</div>;

    const logs = data?.data || [];
    const pagination = data?.pagination || { page: 1, totalPages: 1, total: 0 };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">Webhook History</h1>
                <div className="flex items-center gap-4">
                    <span className="text-sm text-muted-foreground">
                        Total: {pagination.total} events
                    </span>
                    <button
                        onClick={handleClear}
                        disabled={isClearing}
                        className="flex items-center gap-2 px-3 py-1 bg-red-100 text-red-700 rounded-md hover:bg-red-200 text-sm font-medium transition-colors disabled:opacity-50"
                    >
                        <Trash2 className="h-4 w-4" />
                        {isClearing ? 'Clearing...' : 'Clear History'}
                    </button>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex justify-between items-center">
                        <span>Incoming Webhooks</span>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page === 1}
                                className="p-1 rounded hover:bg-muted disabled:opacity-50"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <span className="text-sm font-normal">
                                Page {page} of {pagination.totalPages}
                            </span>
                            <button
                                onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                                disabled={page >= pagination.totalPages}
                                className="p-1 rounded hover:bg-muted disabled:opacity-50"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {logs.map((log: any) => (
                            <div key={log.id} className="border rounded-lg p-4 text-sm font-mono">
                                <div className="flex justify-between mb-2">
                                    <span className="font-bold text-blue-600">{log.event_type}</span>
                                    <span className="text-muted-foreground">{new Date(log.created_at).toLocaleString()}</span>
                                </div>
                                <div className="bg-muted p-2 rounded overflow-x-auto max-h-[300px]">
                                    <pre>{JSON.stringify(log.payload, null, 2)}</pre>
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
