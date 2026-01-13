import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, Webhook, Settings, MessageSquare, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
// Placeholder pages - will replace later
import DashboardPage from './pages/DashboardPage';
import LeadsPage from './pages/LeadsPage';
import WebhooksPage from './pages/WebhooksPage';
import ConfigPage from './pages/ConfigPage';
import MessagesPage from './pages/MessagesPage';
import WAHASessionsPage from './pages/WAHASessionsPage';

function NavItem({ to, icon: Icon, label }: { to: string; icon: any; label: string }) {
    const location = useLocation();
    const isActive = location.pathname === to;

    return (
        <Link
            to={to}
            className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                isActive
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted text-muted-foreground hover:text-foreground"
            )}
        >
            <Icon className="h-4 w-4" />
            {label}
        </Link>
    );
}

function Sidebar() {
    return (
        <div className="w-64 border-r bg-card h-screen flex flex-col p-4">
            <div className="mb-8 px-2 flex items-center gap-3">
                <img src="https://images.squarespace-cdn.com/content/v1/682ec1d094b8a51d6d2c11f2/86851417-4055-4325-a7a3-3600441e6fcd/2025-05-22+13.33.35.jpg" alt="Start Franchise" className="h-10 w-10 rounded-lg object-contain" />
                <div className="flex flex-col">
                    <span className="font-bold text-lg leading-tight">StartFranchise</span>
                    <span className="text-xs text-muted-foreground">Chatbot Admin</span>
                </div>
            </div>

            <div className="space-y-1">
                <NavItem to="/" icon={LayoutDashboard} label="Dashboard" />
                <NavItem to="/leads" icon={Users} label="Leads Manager" />
                <NavItem to="/waha" icon={Smartphone} label="WAHA Sessions" />
                <NavItem to="/messages" icon={MessageSquare} label="Custom Messages" />
                <NavItem to="/webhooks" icon={Webhook} label="Webhook History" />
                <NavItem to="/config" icon={Settings} label="Configuration" />
            </div>
        </div>
    );
}

function App() {
    return (
        <Router>
            <div className="flex h-screen bg-background">
                <Sidebar />
                <main className="flex-1 overflow-y-auto p-8">
                    <Routes>
                        <Route path="/" element={<DashboardPage />} />
                        <Route path="/leads" element={<LeadsPage />} />
                        <Route path="/waha" element={<WAHASessionsPage />} />
                        <Route path="/messages" element={<MessagesPage />} />
                        <Route path="/webhooks" element={<WebhooksPage />} />
                        <Route path="/config" element={<ConfigPage />} />
                    </Routes>
                </main>
            </div>
        </Router>
    )
}

export default App
