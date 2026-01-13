import useSWR from 'swr';
import { Users, AlertCircle, CheckCircle, Smartphone, Clock, Database, TrendingUp, Bell, ArrowUpRight, Loader2 } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const fetcher = (url: string) => fetch(url).then(res => res.json());

export default function DashboardPage() {
    const { data: analytics, isLoading: loadingAnalytics } = useSWR(`${API_BASE}/api/admin/analytics`, fetcher, { refreshInterval: 5000 });
    const { data: queues, isLoading: loadingQueues } = useSWR(`${API_BASE}/api/admin/queues`, fetcher, { refreshInterval: 5000 });

    if (loadingAnalytics || loadingQueues) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const stats = analytics?.data || {};
    const qStats = queues?.data?.queues || { sheets: { waiting: 0, failed: 0 }, telegram: { waiting: 0, failed: 0 } };

    // Format activity chart data
    const activityData = stats.recentActivity || [];
    const maxCount = Math.max(...activityData.map((d: any) => d.count), 1);

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <TrendingUp className="h-6 w-6 text-primary" />
                        Dashboard Overview
                    </h1>
                    <p className="text-muted-foreground text-sm">Ringkasan performa chatbot Start Franchise</p>
                </div>
                <div className="text-sm text-muted-foreground">
                    {new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {/* Total Leads */}
                <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-6 text-white shadow-lg">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-blue-100 text-sm font-medium">Total Leads</p>
                            <p className="text-4xl font-bold mt-1">{stats.totalLeads || 0}</p>
                            <p className="text-blue-200 text-xs mt-1">Semua stage</p>
                        </div>
                        <div className="bg-white/20 rounded-full p-3">
                            <Users className="h-6 w-6" />
                        </div>
                    </div>
                </div>

                {/* Requires Intervention */}
                <div className="bg-gradient-to-br from-red-500 to-red-600 rounded-xl p-6 text-white shadow-lg">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-red-100 text-sm font-medium">Butuh Tindakan</p>
                            <p className="text-4xl font-bold mt-1">{stats.requiresIntervention || 0}</p>
                            <p className="text-red-200 text-xs mt-1">Eskalasi / Stuck</p>
                        </div>
                        <div className="bg-white/20 rounded-full p-3">
                            <AlertCircle className="h-6 w-6" />
                        </div>
                    </div>
                </div>

                {/* Completed Forms */}
                <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl p-6 text-white shadow-lg">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-emerald-100 text-sm font-medium">Form Selesai</p>
                            <p className="text-4xl font-bold mt-1">{stats.completedForms || 0}</p>
                            <p className="text-emerald-200 text-xs mt-1">{stats.conversionRate || 0}% Conversion</p>
                        </div>
                        <div className="bg-white/20 rounded-full p-3">
                            <CheckCircle className="h-6 w-6" />
                        </div>
                    </div>
                </div>

                {/* WhatsApp Leads */}
                <div className="bg-gradient-to-br from-green-500 to-teal-600 rounded-xl p-6 text-white shadow-lg">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-green-100 text-sm font-medium">WhatsApp</p>
                            <p className="text-4xl font-bold mt-1">{stats.bySource?.whatsapp || 0}</p>
                            <p className="text-green-200 text-xs mt-1">Active leads</p>
                        </div>
                        <div className="bg-white/20 rounded-full p-3">
                            <Smartphone className="h-6 w-6" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Charts & Activity */}
            <div className="grid gap-6 lg:grid-cols-2">
                {/* Recent Activity Chart */}
                <div className="bg-card border rounded-xl p-6">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <Clock className="h-5 w-5 text-primary" />
                        Aktivitas 7 Hari Terakhir
                    </h3>
                    <div className="space-y-3">
                        {activityData.length === 0 ? (
                            <p className="text-muted-foreground text-sm">Belum ada aktivitas</p>
                        ) : (
                            activityData.slice(0, 7).map((day: any) => (
                                <div key={day.date} className="flex items-center gap-3">
                                    <span className="text-sm text-muted-foreground w-24">
                                        {new Date(day.date).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric' })}
                                    </span>
                                    <div className="flex-1 bg-muted rounded-full h-3 overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-r from-blue-500 to-primary rounded-full transition-all"
                                            style={{ width: `${(day.count / maxCount) * 100}%` }}
                                        />
                                    </div>
                                    <span className="font-semibold text-sm w-8 text-right">{day.count}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* System Health */}
                <div className="bg-card border rounded-xl p-6">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <Database className="h-5 w-5 text-primary" />
                        System Health
                    </h3>
                    <div className="space-y-4">
                        {/* Google Sheets Queue */}
                        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                            <div className="flex items-center gap-3">
                                <div className="bg-green-500/10 text-green-600 p-2 rounded-lg">
                                    <Database className="h-5 w-5" />
                                </div>
                                <div>
                                    <p className="font-medium text-sm">Google Sheets Sync</p>
                                    <p className="text-xs text-muted-foreground">Queue status</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className={`text-sm px-2 py-1 rounded ${qStats.sheets.waiting > 0 ? 'bg-yellow-500/10 text-yellow-600' : 'bg-muted text-muted-foreground'}`}>
                                    {qStats.sheets.waiting} waiting
                                </span>
                                <span className={`text-sm px-2 py-1 rounded ${qStats.sheets.failed > 0 ? 'bg-red-500/10 text-red-600' : 'bg-muted text-muted-foreground'}`}>
                                    {qStats.sheets.failed} failed
                                </span>
                            </div>
                        </div>

                        {/* Telegram Queue */}
                        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                            <div className="flex items-center gap-3">
                                <div className="bg-blue-500/10 text-blue-600 p-2 rounded-lg">
                                    <Bell className="h-5 w-5" />
                                </div>
                                <div>
                                    <p className="font-medium text-sm">Telegram Notifications</p>
                                    <p className="text-xs text-muted-foreground">Queue status</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className={`text-sm px-2 py-1 rounded ${qStats.telegram.waiting > 0 ? 'bg-yellow-500/10 text-yellow-600' : 'bg-muted text-muted-foreground'}`}>
                                    {qStats.telegram.waiting} waiting
                                </span>
                                <span className={`text-sm px-2 py-1 rounded ${qStats.telegram.failed > 0 ? 'bg-red-500/10 text-red-600' : 'bg-muted text-muted-foreground'}`}>
                                    {qStats.telegram.failed} failed
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-card border rounded-xl p-6">
                <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <a href="/leads" className="flex items-center justify-between p-4 bg-muted/50 rounded-lg hover:bg-muted transition-colors group">
                        <span className="text-sm font-medium">Lihat Leads</span>
                        <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </a>
                    <a href="/messages" className="flex items-center justify-between p-4 bg-muted/50 rounded-lg hover:bg-muted transition-colors group">
                        <span className="text-sm font-medium">Edit Pesan</span>
                        <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </a>
                    <a href="/webhooks" className="flex items-center justify-between p-4 bg-muted/50 rounded-lg hover:bg-muted transition-colors group">
                        <span className="text-sm font-medium">Webhook History</span>
                        <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </a>
                    <a href="/config" className="flex items-center justify-between p-4 bg-muted/50 rounded-lg hover:bg-muted transition-colors group">
                        <span className="text-sm font-medium">Configuration</span>
                        <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </a>
                </div>
            </div>
        </div>
    );
}
