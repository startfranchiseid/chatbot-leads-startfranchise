import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { Smartphone, Plus, Edit, Trash2, Loader2 } from 'lucide-react';
import { API_BASE, fetcher } from '@/lib/api';

interface WAHASession {
    id: string;
    session_name: string;
    phone_number: string | null;
    waha_url: string;
    api_key: string;
    webhook_enabled: boolean;
    is_active: boolean;
    last_seen_at: string | null;
    created_at: string;
    updated_at: string;
}

export default function WAHASessionsPage() {
    const { data, isLoading } = useSWR<{ success: boolean; data: WAHASession[] }>(
        `${API_BASE}/api/admin/waha/sessions`,
        fetcher
    );

    const [showModal, setShowModal] = useState(false);
    const [editingSession, setEditingSession] = useState<WAHASession | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    const sessions = data?.data || [];

    const handleToggle = async (sessionName: string, currentlyEnabled: boolean) => {
        try {
            await fetch(`${API_BASE}/api/admin/waha/sessions/${sessionName}/toggle`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: !currentlyEnabled }),
            });
            mutate(`${API_BASE}/api/admin/waha/sessions`);
        } catch (error) {
            alert('Failed to toggle webhook');
        }
    };

    const handleDelete = async (sessionName: string) => {
        try {
            await fetch(`${API_BASE}/api/admin/waha/sessions/${sessionName}`, {
                method: 'DELETE',
            });
            mutate(`${API_BASE}/api/admin/waha/sessions`);
            setDeleteConfirm(null);
        } catch (error) {
            alert('Failed to delete session');
        }
    };

    const getStatusColor = (lastSeen: string | null) => {
        if (!lastSeen) return 'text-gray-400';
        const diff = Date.now() - new Date(lastSeen).getTime();
        if (diff < 5 * 60 * 1000) return 'text-green-500'; // < 5 min
        if (diff < 30 * 60 * 1000) return 'text-yellow-500'; // < 30 min
        return 'text-red-500';
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Smartphone className="h-6 w-6 text-primary" />
                        WAHA Sessions
                    </h1>
                    <p className="text-muted-foreground text-sm">Manage multiple WhatsApp numbers</p>
                </div>
                <button
                    onClick={() => {
                        setEditingSession(null);
                        setShowModal(true);
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
                >
                    <Plus className="h-4 w-4" />
                    Add Session
                </button>
            </div>

            {/* Sessions Table */}
            <div className="bg-card border rounded-xl overflow-hidden">
                <table className="w-full">
                    <thead className="bg-muted/50">
                        <tr>
                            <th className="text-left p-4 font-semibold">Session Name</th>
                            <th className="text-left p-4 font-semibold">Phone Number</th>
                            <th className="text-left p-4 font-semibold">Status</th>
                            <th className="text-left p-4 font-semibold">Bot</th>
                            <th className="text-right p-4 font-semibold">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sessions.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="text-center p-8 text-muted-foreground">
                                    No sessions found. Add your first WAHA session to get started.
                                </td>
                            </tr>
                        ) : (
                            sessions.map((session) => (
                                <tr key={session.id} className="border-t hover:bg-muted/30">
                                    <td className="p-4 font-medium">{session.session_name}</td>
                                    <td className="p-4 text-muted-foreground">
                                        {session.phone_number || '-'}
                                    </td>
                                    <td className="p-4">
                                        <div className="flex items-center gap-2">
                                            <div className={`h-2 w-2 rounded-full ${getStatusColor(session.last_seen_at)}`} />
                                            <span className="text-sm">
                                                {session.last_seen_at
                                                    ? new Date(session.last_seen_at).toLocaleString('id-ID')
                                                    : 'Never'}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <button
                                            onClick={() => handleToggle(session.session_name, session.webhook_enabled)}
                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${session.webhook_enabled ? 'bg-green-500' : 'bg-gray-300'
                                                }`}
                                        >
                                            <span
                                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${session.webhook_enabled ? 'translate-x-6' : 'translate-x-1'
                                                    }`}
                                            />
                                        </button>
                                    </td>
                                    <td className="p-4">
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                onClick={() => {
                                                    setEditingSession(session);
                                                    setShowModal(true);
                                                }}
                                                className="p-2 hover:bg-muted rounded-lg"
                                            >
                                                <Edit className="h-4 w-4" />
                                            </button>
                                            <button
                                                onClick={() => setDeleteConfirm(session.session_name)}
                                                className="p-2 hover:bg-red-500/10 text-red-500 rounded-lg"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Create/Edit Modal */}
            {showModal && (
                <SessionModal
                    session={editingSession}
                    onClose={() => {
                        setShowModal(false);
                        setEditingSession(null);
                    }}
                    onSuccess={() => {
                        mutate(`${API_BASE}/api/admin/waha/sessions`);
                        setShowModal(false);
                        setEditingSession(null);
                    }}
                />
            )}

            {/* Delete Confirmation */}
            {deleteConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-background w-full max-w-md p-6 rounded-lg shadow-lg border">
                        <h3 className="text-lg font-bold mb-2">Delete Session?</h3>
                        <p className="text-muted-foreground mb-4">
                            Are you sure you want to delete session "{deleteConfirm}"? This action cannot be undone.
                        </p>
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setDeleteConfirm(null)}
                                className="px-4 py-2 border rounded-lg hover:bg-muted"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => handleDelete(deleteConfirm)}
                                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function SessionModal({
    session,
    onClose,
    onSuccess,
}: {
    session: WAHASession | null;
    onClose: () => void;
    onSuccess: () => void;
}) {
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        session_name: session?.session_name || '',
        waha_url: session?.waha_url || '',
        api_key: session?.api_key || '',
        phone_number: session?.phone_number || '',
        webhook_enabled: session?.webhook_enabled ?? true,
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            const url = session
                ? `${API_BASE}/api/admin/waha/sessions/${session.session_name}`
                : `${API_BASE}/api/admin/waha/sessions`;

            const method = session ? 'PUT' : 'POST';

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });

            const result = await res.json();

            if (result.success) {
                onSuccess();
            } else {
                alert('Error: ' + (result.error || 'Unknown error'));
            }
        } catch (error) {
            alert('Failed to save session');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-background w-full max-w-lg p-6 rounded-lg shadow-lg border">
                <h2 className="text-xl font-bold mb-4">
                    {session ? 'Edit Session' : 'Add New Session'}
                </h2>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="text-sm font-medium">Session Name</label>
                        <input
                            required
                            type="text"
                            disabled={!!session}
                            className="w-full h-10 px-3 rounded-lg border bg-background mt-1 disabled:opacity-50"
                            value={formData.session_name}
                            onChange={(e) => setFormData({ ...formData, session_name: e.target.value })}
                            placeholder="e.g., default, cs-team, sales"
                        />
                    </div>

                    <div>
                        <label className="text-sm font-medium">WAHA URL</label>
                        <input
                            required
                            type="url"
                            className="w-full h-10 px-3 rounded-lg border bg-background mt-1"
                            value={formData.waha_url}
                            onChange={(e) => setFormData({ ...formData, waha_url: e.target.value })}
                            placeholder="https://waha.example.com"
                        />
                    </div>

                    <div>
                        <label className="text-sm font-medium">API Key</label>
                        <input
                            required
                            type="password"
                            className="w-full h-10 px-3 rounded-lg border bg-background mt-1"
                            value={formData.api_key}
                            onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                            placeholder="Enter API key"
                        />
                    </div>

                    <div>
                        <label className="text-sm font-medium">Phone Number (Optional)</label>
                        <input
                            type="text"
                            className="w-full h-10 px-3 rounded-lg border bg-background mt-1"
                            value={formData.phone_number}
                            onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                            placeholder="628xxx"
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="webhook_enabled"
                            checked={formData.webhook_enabled}
                            onChange={(e) => setFormData({ ...formData, webhook_enabled: e.target.checked })}
                            className="h-4 w-4"
                        />
                        <label htmlFor="webhook_enabled" className="text-sm font-medium">
                            Enable webhook (bot active)
                        </label>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 border rounded-lg hover:bg-muted"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
                        >
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : session ? 'Update' : 'Create'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
