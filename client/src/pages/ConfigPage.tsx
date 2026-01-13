import useSWR from 'swr';
import { useState, useEffect } from 'react';
import { Save, Settings, Database, ServerCog, MessageSquare, Zap, Shield, Loader2, CheckCircle, XCircle, Eye, EyeOff } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const fetcher = (url: string) => fetch(url).then(res => res.json());

// Group configuration by category
const CONFIG_GROUPS = {
    'WAHA / WhatsApp': {
        icon: MessageSquare,
        color: 'emerald',
        keys: ['WAHA_API_URL', 'WAHA_SESSION_NAME', 'WAHA_API_KEY', 'WAHA_WEBHOOK_PATH'],
    },
    'Google Sheets': {
        icon: Database,
        color: 'blue',
        keys: ['GOOGLE_SPREADSHEET_ID', 'GOOGLE_SHEET_NAME', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'],
    },
    'Telegram': {
        icon: Zap,
        color: 'sky',
        keys: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_CHAT_ID'],
    },
    'System': {
        icon: ServerCog,
        color: 'violet',
        keys: ['PORT', 'LOCK_TTL_SECONDS', 'USER_COOLDOWN_MS'],
    },
    'Database & Redis': {
        icon: Shield,
        color: 'amber',
        keys: ['DB_HOST', 'REDIS_HOST'],
    },
};

// Pretty key names
const KEY_LABELS: Record<string, string> = {
    WAHA_API_URL: 'API URL',
    WAHA_SESSION_NAME: 'Session Name',
    WAHA_API_KEY: 'API Key',
    WAHA_WEBHOOK_PATH: 'Webhook Path',
    GOOGLE_SPREADSHEET_ID: 'Spreadsheet ID',
    GOOGLE_SHEET_NAME: 'Sheet Name',
    GOOGLE_CLIENT_ID: 'Client ID',
    GOOGLE_CLIENT_SECRET: 'Client Secret',
    GOOGLE_REFRESH_TOKEN: 'Refresh Token',
    TELEGRAM_BOT_TOKEN: 'Bot Token',
    TELEGRAM_ADMIN_CHAT_ID: 'Admin Chat ID',
    PORT: 'Port',
    LOCK_TTL_SECONDS: 'Lock TTL (seconds)',
    USER_COOLDOWN_MS: 'User Cooldown (ms)',
    DB_HOST: 'Database Host',
    REDIS_HOST: 'Redis Host',
};

type TestStatus = 'idle' | 'loading' | 'success' | 'error';

export default function ConfigPage() {
    const { data: configData, isLoading } = useSWR(`${API_BASE}/api/admin/config`, fetcher);
    const [formState, setFormState] = useState<Record<string, string>>({});
    const [testStatus, setTestStatus] = useState<Record<string, TestStatus>>({});
    const [saving, setSaving] = useState(false);
    const [visibleFields, setVisibleFields] = useState<Record<string, boolean>>({});

    const toggleVisibility = (key: string) => {
        setVisibleFields(prev => ({ ...prev, [key]: !prev[key] }));
    };

    useEffect(() => {
        if (configData?.data) {
            setFormState(configData.data);
        }
    }, [configData]);

    const handleChange = (key: string, value: string) => {
        setFormState(prev => ({ ...prev, [key]: value }));
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await fetch(`${API_BASE}/api/admin/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formState)
            });
            const data = await res.json();
            if (data.success) {
                alert('✅ Configuration saved! Restart server if needed.');
            } else {
                alert('❌ Failed to save: ' + (data.error || 'Unknown error'));
            }
        } catch {
            alert('❌ Network error');
        } finally {
            setSaving(false);
        }
    };

    const handleTest = async (service: string) => {
        setTestStatus(prev => ({ ...prev, [service]: 'loading' }));
        try {
            const res = await fetch(`${API_BASE}/api/admin/test-connection`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ service })
            });
            const data = await res.json();
            setTestStatus(prev => ({ ...prev, [service]: data.success ? 'success' : 'error' }));
        } catch {
            setTestStatus(prev => ({ ...prev, [service]: 'error' }));
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const TestButton = ({ service, label, color }: { service: string; label: string; color: string }) => {
        const status = testStatus[service] || 'idle';
        const colorClasses: Record<string, string> = {
            blue: 'bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 border-blue-500/20',
            red: 'bg-red-500/10 text-red-600 hover:bg-red-500/20 border-red-500/20',
            green: 'bg-green-500/10 text-green-600 hover:bg-green-500/20 border-green-500/20',
            teal: 'bg-teal-500/10 text-teal-600 hover:bg-teal-500/20 border-teal-500/20',
        };

        return (
            <button
                onClick={() => handleTest(service)}
                disabled={status === 'loading'}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border font-medium text-sm transition-all ${colorClasses[color]} disabled:opacity-50`}
            >
                {status === 'loading' && <Loader2 className="h-4 w-4 animate-spin" />}
                {status === 'success' && <CheckCircle className="h-4 w-4 text-green-500" />}
                {status === 'error' && <XCircle className="h-4 w-4 text-red-500" />}
                {status === 'idle' && <div className="h-4 w-4" />}
                {label}
            </button>
        );
    };

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Settings className="h-6 w-6" />
                        Configuration
                    </h1>
                    <p className="text-muted-foreground text-sm">Kelola environment variables dan test koneksi</p>
                </div>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:bg-primary/90 disabled:opacity-50 transition-all"
                >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Simpan Perubahan
                </button>
            </div>

            {/* System Health Check */}
            <div className="bg-card border rounded-xl p-6">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Zap className="h-5 w-5 text-amber-500" />
                    System Health Check
                </h2>
                <div className="flex flex-wrap gap-3">
                    <TestButton service="postgres" label="PostgreSQL" color="blue" />
                    <TestButton service="redis" label="Redis" color="red" />
                    <TestButton service="google-sheets" label="Google Sheets" color="green" />
                    <TestButton service="waha" label="WAHA API" color="teal" />
                </div>
            </div>

            {/* Config Groups */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {Object.entries(CONFIG_GROUPS).map(([groupName, group]) => {
                    const Icon = group.icon;
                    const colorMap: Record<string, string> = {
                        emerald: 'text-emerald-500 bg-emerald-500/10',
                        blue: 'text-blue-500 bg-blue-500/10',
                        sky: 'text-sky-500 bg-sky-500/10',
                        violet: 'text-violet-500 bg-violet-500/10',
                        amber: 'text-amber-500 bg-amber-500/10',
                    };
                    const iconColor = colorMap[group.color] || 'text-muted-foreground';

                    return (
                        <div key={groupName} className="bg-card border rounded-xl p-6">
                            <h3 className="text-md font-semibold mb-4 flex items-center gap-2">
                                <div className={`p-2 rounded-lg ${iconColor}`}>
                                    <Icon className="h-4 w-4" />
                                </div>
                                {groupName}
                            </h3>
                            <div className="space-y-4">
                                {group.keys.map(key => {
                                    const value = formState[key];
                                    if (value === undefined) return null;
                                    const label = KEY_LABELS[key] || key;
                                    const isSecret = key.includes('SECRET') || key.includes('TOKEN') || key.includes('KEY') || key.includes('PASSWORD');

                                    return (
                                        <div key={key} className="space-y-1.5">
                                            <label className="text-sm font-medium text-muted-foreground">{label}</label>
                                            <div className="relative">
                                                <input
                                                    type={isSecret && !visibleFields[key] ? 'password' : 'text'}
                                                    className="flex h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all pr-10"
                                                    value={value || ''}
                                                    onChange={e => handleChange(key, e.target.value)}
                                                    placeholder={`Enter ${label.toLowerCase()}`}
                                                />
                                                {isSecret && (
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleVisibility(key)}
                                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                                    >
                                                        {visibleFields[key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
