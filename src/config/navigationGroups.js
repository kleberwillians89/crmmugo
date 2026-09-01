import {
  BookUser,
  Bot,
  ClipboardCheck,
  CreditCard,
  FileText,
  Inbox,
  LayoutDashboard,
  MessageCircle,
  Plug,
  ReceiptText,
  Settings2,
  Users,
  WalletCards,
} from "lucide-react";

export const NAVIGATION_GROUPS = [
  {
    id: "overview",
    label: "Visão geral",
    links: [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    id: "crm",
    label: "CRM",
    links: [
      { id: "clients", label: "Clientes", icon: Users },
      { id: "contacts", label: "Contatos", icon: BookUser, supabaseOnly: true },
      { id: "contracts", label: "Contratos", icon: ClipboardCheck },
    ],
  },
  {
    id: "communication",
    label: "Comunicação",
    links: [
      { id: "inbox", label: "Caixa de entrada", icon: Inbox, supabaseOnly: true },
      { id: "automations", label: "Automações", icon: Bot, supabaseOnly: true },
      { id: "templates", label: "Templates", icon: FileText, supabaseOnly: true },
      {
        id: "whatsapp",
        label: "WhatsApp",
        icon: MessageCircle,
        supabaseOnly: true,
      },
    ],
  },
  {
    id: "finance",
    label: "Financeiro",
    links: [
      { id: "finance-summary", label: "Visão financeira", icon: WalletCards },
      { id: "finance", label: "Contas a receber", icon: ReceiptText },
      { id: "accounts-payable", label: "Contas a pagar", icon: CreditCard },
      { id: "collections", label: "Cobranças", icon: ReceiptText, supabaseOnly: true },
    ],
  },
  {
    id: "administration",
    label: "Administração",
    links: [
      { id: "integrations", label: "Integrações", icon: Plug },
      {
        id: "organization-settings",
        label: "Configurações",
        icon: Settings2,
      },
    ],
  },
];
