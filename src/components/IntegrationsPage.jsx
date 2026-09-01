import { CreditCard, MessageCircle } from "lucide-react";
import { PageHeader } from "./PageHeader";

export function IntegrationsPage({ onNavigate }) {
  return (
    <div className="integrations-page">
      <PageHeader
        eyebrow="Administração"
        title="Integrações"
        description="Acesse os pontos de configuração e acompanhamento das conexões já disponíveis."
      />
      <section className="integration-directory" aria-label="Integrações disponíveis">
        <article>
          <MessageCircle size={18} />
          <div>
            <strong>WhatsApp</strong>
            <p>Conexão do canal, uso, custos e status técnico.</p>
          </div>
          <button className="button secondary" onClick={() => onNavigate?.("whatsapp")}>Abrir</button>
        </article>
        <article>
          <CreditCard size={18} />
          <div>
            <strong>Configuração financeira</strong>
            <p>Contas, meios de pagamento e preferências já existentes.</p>
          </div>
          <button className="button secondary" onClick={() => onNavigate?.("organization-settings")}>Abrir</button>
        </article>
      </section>
    </div>
  );
}
