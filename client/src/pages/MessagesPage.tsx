import { useState, useEffect } from 'react';
import { MessageSquare, Save, Eye, Loader2 } from 'lucide-react';
import useSWR, { mutate } from 'swr';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const fetcher = (url: string) => fetch(url).then(res => res.json());

interface BotMessage {
    key: string;
    content: string;
    description: string;
    updated_at: string;
}

// WhatsApp-like preview component
function WhatsAppPreview({ content }: { content: string }) {
    return (
        <div className="bg-[#e5ddd5] dark:bg-zinc-800 rounded-lg p-4 min-h-[200px]">
            <div className="flex justify-end">
                <div className="bg-[#dcf8c6] dark:bg-emerald-800 rounded-lg p-3 max-w-[80%] shadow-sm">
                    <p className="text-sm text-zinc-800 dark:text-zinc-100 whitespace-pre-wrap">{content || '(kosong)'}</p>
                    <div className="text-[10px] text-zinc-500 dark:text-zinc-400 text-right mt-1">12:00 ✓✓</div>
                </div>
            </div>
        </div>
    );
}

export default function MessagesPage() {
    const { data, error, isLoading } = useSWR<{ success: boolean; data: BotMessage[] }>(
        `${API_BASE}/api/admin/messages`,
        fetcher
    );

    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [editContent, setEditContent] = useState('');
    const [saving, setSaving] = useState(false);
    const [showPreview, setShowPreview] = useState(true);

    const messages = data?.data || [];
    const selectedMessage = messages.find(m => m.key === selectedKey);

    useEffect(() => {
        if (selectedMessage) {
            setEditContent(selectedMessage.content);
        }
    }, [selectedMessage]);

    const handleSave = async () => {
        if (!selectedKey) return;
        setSaving(true);
        try {
            const res = await fetch(`${API_BASE}/api/admin/messages/${selectedKey}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: editContent }),
            });
            const result = await res.json();
            if (result.success) {
                mutate(`${API_BASE}/api/admin/messages`);
            } else {
                alert('Gagal menyimpan: ' + (result.error || 'Unknown error'));
            }
        } catch (err) {
            alert('Error menyimpan pesan');
        } finally {
            setSaving(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (error) {
        return <div className="text-destructive">Error loading messages</div>;
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <MessageSquare className="h-6 w-6" />
                        Custom Messages
                    </h1>
                    <p className="text-muted-foreground text-sm">Edit pesan response bot</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Message List */}
                <div className="lg:col-span-1 space-y-2">
                    <h3 className="font-semibold text-sm text-muted-foreground mb-2">Daftar Pesan</h3>
                    <div className="space-y-1">
                        {messages.map(msg => (
                            <button
                                key={msg.key}
                                onClick={() => setSelectedKey(msg.key)}
                                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${selectedKey === msg.key
                                        ? 'bg-primary text-primary-foreground'
                                        : 'hover:bg-muted'
                                    }`}
                            >
                                <div className="font-medium">{msg.key}</div>
                                <div className={`text-xs truncate ${selectedKey === msg.key ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                                    {msg.description}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Editor & Preview */}
                <div className="lg:col-span-2 space-y-4">
                    {selectedKey ? (
                        <>
                            <div className="flex items-center justify-between">
                                <h3 className="font-semibold">{selectedKey}</h3>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setShowPreview(!showPreview)}
                                        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                                    >
                                        <Eye className="h-4 w-4" />
                                        {showPreview ? 'Hide' : 'Show'} Preview
                                    </button>
                                    <button
                                        onClick={handleSave}
                                        disabled={saving}
                                        className="flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 disabled:opacity-50"
                                    >
                                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                        Simpan
                                    </button>
                                </div>
                            </div>

                            <p className="text-sm text-muted-foreground">{selectedMessage?.description}</p>

                            <textarea
                                value={editContent}
                                onChange={e => setEditContent(e.target.value)}
                                className="w-full h-48 p-3 border rounded-md bg-background font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                                placeholder="Isi pesan..."
                            />

                            {showPreview && (
                                <div>
                                    <h4 className="font-semibold text-sm mb-2">Preview (WhatsApp)</h4>
                                    <WhatsAppPreview content={editContent} />
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="flex items-center justify-center h-64 text-muted-foreground">
                            Pilih pesan dari daftar untuk mengedit
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
