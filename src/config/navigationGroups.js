import {
  ClipboardCheck,
  LayoutDashboard,
  MessageCircle,
  Settings2,
  Users,
  WalletCards,
} from "lucide-react";

// Rotas e componentes continuam disponíveis; esta lista controla apenas a
// experiência diária exibida no menu principal.
export const NAVIGATION_GROUPS = [
  {
    id: "main",
    label: "Principal",
    links: [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      { id: "clients", label: "Clientes", icon: Users },
      { id: "contracts", label: "Contratos", icon: ClipboardCheck },
      {
        id: "whatsapp",
        label: "WhatsApp",
        icon: MessageCircle,
        supabaseOnly: true,
      },
      {
        id: "finance-summary",
        label: "Financeiro",
        icon: WalletCards,
      },
      {
        id: "organization-settings",
        label: "Configurações",
        icon: Settings2,
      },
    ],
  },
];
