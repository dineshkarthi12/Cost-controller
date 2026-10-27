import {
  BadgeCheck, BadgeIndianRupee, BarChart3, Bell, Boxes, Building2, Calculator, CalendarCheck, CalendarRange, Camera, ClipboardCheck, ClipboardList, FileSpreadsheet, FilePlus2, FileText, Flag, FolderOpen, GitPullRequestArrow, Handshake, HardHat, History, Landmark, LayoutDashboard, LineChart, ListTodo, NotebookPen, Network, PackageCheck, PackageMinus, PiggyBank, Plug, Receipt, Ruler, Scale, ScrollText, SearchCheck, Send, Settings, ShieldAlert, ShieldCheck, ShoppingCart, TrendingUp, Truck, UserCog, Users, Wallet, Warehouse, Circle,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  BadgeCheck, BadgeIndianRupee, BarChart3, Bell, Boxes, Building2, Calculator, CalendarCheck, CalendarRange, Camera, ClipboardCheck, ClipboardList, FileSpreadsheet, FilePlus2, FileText, Flag, FolderOpen, GitPullRequestArrow, Handshake, HardHat, History, Landmark, LayoutDashboard, LineChart, ListTodo, NotebookPen, Network, PackageCheck, PackageMinus, PiggyBank, Plug, Receipt, Ruler, Scale, ScrollText, SearchCheck, Send, Settings, ShieldAlert, ShieldCheck, ShoppingCart, TrendingUp, Truck, UserCog, Users, Wallet, Warehouse,
};

export function ModuleIcon({ name, className }: { name: string; className?: string }) {
  const I = ICONS[name] ?? Circle;
  return <I className={className} aria-hidden />;
}
