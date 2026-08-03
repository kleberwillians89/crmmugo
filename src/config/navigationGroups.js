import { Activity, BarChart3, BellRing, BookOpen, Bot, BriefcaseBusiness, Building2, CalendarDays, ChartNoAxesCombined, CircleDollarSign, ClipboardCheck, DatabaseBackup, FileClock, FileInput, FileText, FolderOpen, Gauge, HeartPulse, Landmark, LayoutDashboard, Library, Lightbulb, ListChecks, MessageCircle, ReceiptText, RefreshCw, Scale, Settings2, ShieldCheck, Sparkles, Tags, TrendingUp, Users, WalletCards } from 'lucide-react'

export const NAVIGATION_GROUPS = [
  { id: 'overview', label: 'Visão geral', links: [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
  { id: 'commercial', label: 'Comercial', links: [
    { id: 'clients', label: 'Clientes', icon: Users }, { id: 'proposals', label: 'Propostas', icon: FileText },
    { id: 'contracts', label: 'Contratos', icon: ClipboardCheck }, { id: 'services', label: 'Serviços', icon: Library },
  ] },
  { id: 'relationship', label: 'Relacionamento', links: [
    { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, supabaseOnly: true },
    { id: 'pulse-alerts', label: 'Alertas e pendências', icon: BellRing, supabaseOnly: true },
  ] },
  { id: 'financial', label: 'Financeiro', links: [
    { id: 'finance-summary', label: 'Resumo financeiro', icon: Gauge }, { id: 'finance', label: 'Contas a receber', icon: WalletCards },
    { id: 'accounts-payable', label: 'Contas a pagar', icon: ReceiptText, supabaseOnly: true },
    { id: 'recurring-accounts', label: 'Contas recorrentes', icon: RefreshCw, supabaseOnly: true },
    { id: 'cash-flow', label: 'Fluxo de caixa', icon: TrendingUp, supabaseOnly: true },
    { id: 'financial-reconciliation', label: 'Conciliação', icon: Scale, supabaseOnly: true },
    { id: 'financial-reports', label: 'Relatórios', icon: BarChart3, supabaseOnly: true },
  ] },
  { id: 'operations', label: 'Operações', links: [
    { id: 'team', label: 'Equipe', icon: BriefcaseBusiness, supabaseOnly: true },
    { id: 'responsibilities', label: 'Responsabilidades', icon: ListChecks, supabaseOnly: true },
    { id: 'documents', label: 'Documentos', icon: FolderOpen },
  ] },
  { id: 'intelligence', label: 'Inteligência', links: [
    { id: 'intelligence-today', label: 'Hoje', icon: CalendarDays }, { id: 'intelligence-attention', label: 'Atenção', icon: Activity },
    { id: 'intelligence-insights', label: 'Insights', icon: Lightbulb }, { id: 'intelligence-recommendations', label: 'Recomendações', icon: Sparkles },
    { id: 'intelligence-trends', label: 'Tendências', icon: ChartNoAxesCombined }, { id: 'intelligence-cross-analysis', label: 'Análise cruzada', icon: BookOpen },
    { id: 'intelligence-health', label: 'Saúde', icon: HeartPulse }, { id: 'intelligence-ai', label: 'IA', icon: Bot },
  ] },
  { id: 'administration', label: 'Administração', adminOnly: true, links: [
    { id: 'organization-settings', label: 'Organização', icon: Building2 }, { id: 'expense-categories', label: 'Categorias', icon: Tags },
    { id: 'cost-centers', label: 'Centros de custo', icon: CircleDollarSign }, { id: 'financial-accounts', label: 'Contas financeiras', icon: Landmark },
    { id: 'financial-import', label: 'Importação financeira', icon: FileInput },
    { id: 'client-contract-review', label: 'Revisão de clientes', icon: ClipboardCheck },
    { id: 'client-duplicates', label: 'Duplicidades de clientes', icon: Users },
    { id: 'system-audit', label: 'Auditoria', icon: ShieldCheck }, { id: 'backup', label: 'Backup', icon: DatabaseBackup },
    { id: 'restore', label: 'Restauração', icon: FileClock }, { id: 'diagnostic', label: 'Diagnóstico', icon: Settings2 },
  ] },
]
