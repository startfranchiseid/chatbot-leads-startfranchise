import useSWR, { useSWRConfig } from 'swr';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Trash2, Edit, RefreshCw, DownloadCloud, Plus, Search, ChevronLeft, ChevronRight, X, AlertTriangle } from 'lucide-react';
import { useState, useEffect } from 'react';
import { API_BASE, fetcher } from '@/lib/api';

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState(value);
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);
        return () => clearTimeout(handler);
    }, [value, delay]);
    return debouncedValue;
}

export default function LeadsPage() {
    const { mutate } = useSWRConfig();

    // State
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [stateFilter, setStateFilter] = useState('');
    const [isSyncing, setIsSyncing] = useState(false);

    // Modals
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingLead, setEditingLead] = useState<any>(null); // If not null, show edit modal

    const debouncedSearch = useDebounce(search, 500);

    const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: '20',
        ...(stateFilter && { state: stateFilter }),
        ...(debouncedSearch && { q: debouncedSearch }),
    });

    const { data } = useSWR(`/api/admin/leads?${queryParams}`, fetcher);

    const leads = data?.data || [];
    const pagination = data?.pagination || { page: 1, totalPages: 1, total: 0 };

    // Handlers
    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this lead? This cannot be undone.')) return;
        await fetch(`${API_BASE}/api/admin/leads/${id}`, { method: 'DELETE' });
        mutate(`/api/admin/leads?${queryParams}`);
    };

    const handleDeleteAll = async () => {
        const confirmText = prompt('Type "DELETE" to confirm deleting ALL leads. This action is IRREVERSIBLE.');
        if (confirmText !== 'DELETE') return;

        try {
            const res = await fetch(`${API_BASE}/api/admin/leads?confirm=true`, { method: 'DELETE' });
            const result = await res.json();
            if (result.success) {
                alert('All data cleared.');
                mutate(`/api/admin/leads?${queryParams}`);
            } else {
                alert('Failed: ' + result.error);
            }
        } catch (e) {
            alert('Error deleting all leads');
        }
    };

    const handleSync = async () => {
        if (!confirm('WARNING: This will DELETE existing local data and re-sync from WhatsApp. Continue?')) return;
        setIsSyncing(true);
        try {
            const res = await fetch(`${API_BASE}/api/admin/leads/sync`, { method: 'POST' });
            const result = await res.json();
            if (result.success) {
                alert(`Sync Complete! Imported ${result.imported} contacts.`);
                mutate(`/api/admin/leads?${queryParams}`);
            } else {
                alert(`Sync Failed: ${result.error}`);
            }
        } catch (e) {
            alert('Network error during sync');
        } finally {
            setIsSyncing(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Leads Manager</h1>
                    <p className="text-muted-foreground">Manage and track your WhatsApp leads.</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={handleDeleteAll}
                        className="flex items-center gap-2 px-3 py-2 bg-red-100 text-red-700 rounded-md hover:bg-red-200 text-sm font-medium transition-colors border border-red-200"
                    >
                        <Trash2 className="h-4 w-4" />
                        Delete All
                    </button>

                    <button
                        onClick={handleSync}
                        disabled={isSyncing}
                        className="flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100 text-sm font-medium transition-colors border border-blue-200 disabled:opacity-50"
                    >
                        <DownloadCloud className="h-4 w-4" />
                        {isSyncing ? 'Syncing...' : 'Sync WhatsApp'}
                    </button>

                    <button
                        onClick={() => mutate(`/api/admin/leads?${queryParams}`)}
                        className="p-2 bg-white border rounded-md hover:bg-gray-50 text-gray-600"
                    >
                        <RefreshCw className="h-4 w-4" />
                    </button>
                </div>
            </div>

            <Card className="border-t-4 border-t-blue-600 shadow-sm">
                <CardHeader>
                    <div className="flex flex-col md:flex-row justify-between gap-4">
                        <div>
                            <CardTitle>Data Leads</CardTitle>
                            <CardDescription>Total: {pagination.total} leads</CardDescription>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3">
                            <div className="relative">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <input
                                    type="text"
                                    placeholder="Search Phone or Name..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="pl-9 h-9 w-full sm:w-[250px] rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                />
                            </div>
                            <select
                                value={stateFilter}
                                onChange={(e) => setStateFilter(e.target.value)}
                                className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            >
                                <option value="">All Status</option>
                                <option value="NEW">New</option>
                                <option value="IMPORTED">Imported</option>
                                <option value="CHOOSE_OPTION">Active</option>
                                <option value="FORM_COMPLETED">Completed</option>
                                <option value="MANUAL_INTERVENTION">Need Help</option>
                                <option value="PARTNERSHIP">Partnership</option>
                            </select>
                            <button
                                onClick={() => setShowAddModal(true)}
                                className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-md hover:bg-gray-800 text-sm font-medium"
                            >
                                <Plus className="h-4 w-4" />
                                Add Lead
                            </button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {!data ? (
                        <div className="p-8 text-center text-muted-foreground">Loading data...</div>
                    ) : (
                        <>
                            <div className="relative overflow-x-auto rounded-md border">
                                <table className="w-full text-sm text-left">
                                    <thead className="text-xs text-muted-foreground uppercase bg-muted/50">
                                        <tr>
                                            <th className="px-6 py-3">Phone / Contact</th>
                                            <th className="px-6 py-3">Status</th>
                                            <th className="px-6 py-3">Biodata</th>
                                            <th className="px-6 py-3">Form</th>
                                            <th className="px-6 py-3">Last Active</th>
                                            <th className="px-6 py-3 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {leads.length === 0 ? (
                                            <tr>
                                                <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                                                    No leads found.
                                                </td>
                                            </tr>
                                        ) : leads.map((lead: any) => (
                                            <tr key={lead.id} className="bg-background border-b hover:bg-gray-50 transition-colors">
                                                <td className="px-6 py-4 font-medium">
                                                    <div className="flex flex-col">
                                                        <span>{lead.user_id}</span>
                                                        {lead.interaction_count > 0 &&
                                                            <span className="text-[10px] text-muted-foreground">{lead.interaction_count} interactions</span>
                                                        }
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <LeadStatusBadge state={lead.state} />
                                                </td>
                                                <td className="px-6 py-4 truncate max-w-[200px]" title={lead.form_name}>
                                                    {lead.form_name || '-'}
                                                </td>
                                                <td className="px-6 py-4">
                                                    {lead.form_completed ?
                                                        <span className="text-green-600 font-medium text-xs">✅ Completed</span> :
                                                        <span className="text-gray-400 text-xs">Pending</span>
                                                    }
                                                </td>
                                                <td className="px-6 py-4 text-xs text-muted-foreground">
                                                    {new Date(lead.updated_at).toLocaleString()}
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <button
                                                            onClick={() => setEditingLead(lead)}
                                                            className="p-1 hover:bg-gray-100 rounded text-blue-600"
                                                            title="Edit"
                                                        >
                                                            <Edit className="h-4 w-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDelete(lead.id)}
                                                            className="p-1 hover:bg-gray-100 rounded text-red-500"
                                                            title="Delete"
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Pagination */}
                            <div className="flex items-center justify-between mt-4">
                                <div className="text-sm text-muted-foreground">
                                    Page {pagination.page} of {pagination.totalPages}
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        disabled={page <= 1}
                                        onClick={() => setPage(p => p - 1)}
                                        className="p-2 border rounded-md hover:bg-accent disabled:opacity-50"
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                    </button>
                                    <button
                                        disabled={page >= pagination.totalPages}
                                        onClick={() => setPage(p => p + 1)}
                                        className="p-2 border rounded-md hover:bg-accent disabled:opacity-50"
                                    >
                                        <ChevronRight className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>

            {/* Modals */}
            {showAddModal && <AddLeadModal onClose={() => setShowAddModal(false)} onRefresh={() => mutate(`/api/admin/leads?${queryParams}`)} />}
            {editingLead && <EditLeadModal lead={editingLead} onClose={() => setEditingLead(null)} onRefresh={() => mutate(`/api/admin/leads?${queryParams}`)} />}
        </div>
    );
}

function LeadStatusBadge({ state }: { state: string }) {
    const colors: Record<string, string> = {
        NEW: 'bg-gray-100 text-gray-800',
        IMPORTED: 'bg-purple-100 text-purple-800',
        CHOOSE_OPTION: 'bg-blue-100 text-blue-800',
        FORM_SENT: 'bg-yellow-100 text-yellow-800',
        FORM_IN_PROGRESS: 'bg-orange-100 text-orange-800',
        FORM_COMPLETED: 'bg-green-100 text-green-800',
        MANUAL_INTERVENTION: 'bg-red-100 text-red-800',
        PARTNERSHIP: 'bg-indigo-100 text-indigo-800',
    };
    return (
        <span className={cn("px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap", colors[state] || 'bg-gray-100')}>
            {state.replace(/_/g, ' ')}
        </span>
    );
}

function AddLeadModal({ onClose, onRefresh }: { onClose: () => void, onRefresh: () => void }) {
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({ user_id: '', name: '' });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            // Auto-format phone: Replace 08 with 628
            let phone = formData.user_id.trim();
            if (phone.startsWith('08')) phone = '62' + phone.substring(1);
            if (!phone.includes('@')) phone = `${phone}@s.whatsapp.net`; // Auto suffix if missing, though backend handles normalization usually. Wait backend takes raw user_id.

            const res = await fetch(`${API_BASE}/api/admin/leads`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...formData, user_id: phone })
            });

            if (res.ok) {
                onRefresh();
                onClose();
            } else {
                const err = await res.json();
                alert('Error: ' + err.error);
            }
        } catch (e) {
            alert('Failed to create lead');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-background w-full max-w-md p-6 rounded-lg shadow-lg border relative">
                <button onClick={onClose} className="absolute right-4 top-4 text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                </button>
                <h2 className="text-xl font-bold mb-4">Add New Lead</h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="text-sm font-medium">WhatsApp Number</label>
                        <input
                            required
                            type="text"
                            placeholder="e.g. 62812345678"
                            className="w-full h-10 px-3 rounded-md border border-input mt-1"
                            value={formData.user_id}
                            onChange={e => setFormData({ ...formData, user_id: e.target.value })}
                        />
                        <p className="text-[10px] text-muted-foreground mt-1">Format: 628...</p>
                    </div>
                    <div>
                        <label className="text-sm font-medium">Name (Biodata) <span className="text-muted-foreground font-normal">(Optional)</span></label>
                        <textarea
                            placeholder="e.g. John Doe, Jakarta"
                            className="w-full h-20 p-3 rounded-md border border-input mt-1 resize-none"
                            value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                        />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-md hover:bg-accent">Cancel</button>
                        <button type="submit" disabled={loading} className="px-4 py-2 text-sm bg-black text-white rounded-md hover:bg-gray-800 disabled:opacity-50">
                            {loading ? 'Creating...' : 'Create Lead'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

function EditLeadModal({ lead, onClose, onRefresh }: { lead: any, onClose: () => void, onRefresh: () => void }) {
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        state: lead.state,
        name: lead.form_name || '',
        phone: lead.user_id
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/admin/leads/${lead.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            if (res.ok) {
                onRefresh();
                onClose();
            } else {
                const err = await res.json();
                alert('Error: ' + err.error);
            }
        } catch (e) {
            alert('Failed to update lead');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-background w-full max-w-md p-6 rounded-lg shadow-lg border relative">
                <button onClick={onClose} className="absolute right-4 top-4 text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                </button>
                <h2 className="text-xl font-bold mb-4">Edit Lead</h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="text-sm font-medium">ID / Phone</label>
                        <input
                            type="text"
                            className="w-full h-10 px-3 rounded-md border border-input mt-1 bg-muted cursor-not-allowed"
                            value={formData.phone}
                            disabled
                        />
                        <p className="text-[10px] text-yellow-600 mt-1 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Cannot change ID directly. create new one if needed.
                        </p>
                    </div>
                    <div>
                        <label className="text-sm font-medium">Status</label>
                        <select
                            className="w-full h-10 px-3 rounded-md border border-input mt-1"
                            value={formData.state}
                            onChange={e => setFormData({ ...formData, state: e.target.value })}
                        >
                            <option value="NEW">NEW</option>
                            <option value="IMPORTED">IMPORTED</option>
                            <option value="CHOOSE_OPTION">CHOOSE_OPTION</option>
                            <option value="FORM_SENT">FORM_SENT</option>
                            <option value="FORM_IN_PROGRESS">FORM_IN_PROGRESS</option>
                            <option value="FORM_COMPLETED">FORM_COMPLETED</option>
                            <option value="MANUAL_INTERVENTION">MANUAL_INTERVENTION</option>
                            <option value="PARTNERSHIP">PARTNERSHIP</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-sm font-medium">Biodata / Name</label>
                        <textarea
                            className="w-full h-24 p-3 rounded-md border border-input mt-1 resize-none"
                            value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                        />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-md hover:bg-accent">Cancel</button>
                        <button type="submit" disabled={loading} className="px-4 py-2 text-sm bg-black text-white rounded-md hover:bg-gray-800 disabled:opacity-50">
                            {loading ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
