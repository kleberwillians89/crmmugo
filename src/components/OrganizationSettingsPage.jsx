import { useEffect, useState } from "react";
import { PageHeader } from "./PageHeader";
import { FeedbackMessage } from "./FeedbackMessage";
import { PixPaymentPanel } from "./PixPaymentPanel";
import { useAuth } from "../contexts/AuthContext";
import { dataProvider } from "../lib/supabase/client";
import {
  getOrganizationSettings,
  updateOrganizationSettings,
} from "../services/data/settingsRepository";
import { userError } from "../lib/userError";

// Horários da régua: guardados como lista "HH:MM"; na tela, separados por vírgula.
const timesText = (value) => (Array.isArray(value) ? value.join(", ") : value || "");
const parseTimes = (text) =>
  String(text || "")
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (/^\d{1,2}$/.test(item) ? `${item.padStart(2, "0")}:00` : item.replace(/^(\d):/, "0$1:")))
    .filter((item) => /^([01]\d|2[0-3]):[0-5]\d$/.test(item));
// Texto livre enquanto digita; vira lista de horários ao sair do campo.
function TimesInput({ value, onChange, disabled, placeholder }) {
  const [text, setText] = useState(timesText(value));
  return (
    <input
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        const times = parseTimes(text);
        setText(timesText(times));
        onChange(times);
      }}
    />
  );
}

export function OrganizationSettingsPage({ onNavigate }) {
  const { isAdmin } = useAuth();
  const [form, setForm] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (dataProvider === "supabase")
      getOrganizationSettings()
        .then(setForm)
        .catch((error) =>
          setMessage(
            userError(error, "Não foi possível carregar as configurações."),
          ),
        );
  }, []);

  async function submit(event) {
    event.preventDefault();
    try {
      setForm(await updateOrganizationSettings(form));
      setMessage("Configurações atualizadas.");
    } catch (error) {
      setMessage(userError(error));
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Administração"
        title="Configurações da empresa"
        description="Dados institucionais, financeiros e preferências da operação."
      />
      {dataProvider === "legacy" && (
        <FeedbackMessage type="info">
          Disponível após ativação da nova base de dados.
        </FeedbackMessage>
      )}
      {message && (
        <FeedbackMessage
          type={message.includes("atualizadas") ? "success" : "error"}
        >
          {message}
        </FeedbackMessage>
      )}
      {isAdmin && (
        <section className="dashboard-panel settings-shortcuts">
          <header>
            <h2>Configurações financeiras</h2>
            <p>
              Cadastros auxiliares ficam organizados aqui, sem ocupar o menu
              principal.
            </p>
          </header>
          <div>
            {[
              ["expense-categories", "Categorias"],
              ["cost-centers", "Centros de custo"],
              ["bank-accounts", "Contas bancárias"],
              ["cards", "Cartões"],
            ].map(([page, label]) => (
              <button
                className="button secondary"
                key={page}
                onClick={() => onNavigate?.(page)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      )}
      {form && (
        <>
          <form
            className="dashboard-panel settings-form"
            onSubmit={submit}
            aria-readonly={!isAdmin}
          >
            <section className="settings-section">
              <h2>Dados para cobrança</h2>
              <div className="form-grid">
                {[
                  ["company_name", "Empresa"],
                  ["bank_name", "Banco"],
                  ["pix_key_type", "Tipo da chave PIX"],
                  ["pix_key", "Chave PIX"],
                  ["legal_name", "Titular"],
                ].map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      value={form[key] || ""}
                      disabled={!isAdmin}
                      onChange={(event) =>
                        setForm({ ...form, [key]: event.target.value })
                      }
                    />
                  </label>
                ))}
              </div>
            </section>
            {"asaas_fine_percent" in form && (
              <section className="settings-section">
                <h2>Asaas e régua de cobrança</h2>
                <p className="data-note">
                  O Asaas calcula multa e juros depois do vencimento. A cobrança automática sai no dia do vencimento nos
                  horários abaixo e continua nos dias seguintes até o pagamento ou até o cliente tocar em “Já realizei o pagamento”.
                </p>
                <div className="form-grid">
                  <label>
                    Multa após o vencimento (%)
                    <input type="number" min="0" max="100" step="0.01" value={form.asaas_fine_percent ?? ""} disabled={!isAdmin}
                      onChange={(event) => setForm({ ...form, asaas_fine_percent: event.target.value })} />
                  </label>
                  <label>
                    Juros ao mês (%)
                    <input type="number" min="0" max="100" step="0.01" value={form.asaas_interest_percent ?? ""} disabled={!isAdmin}
                      onChange={(event) => setForm({ ...form, asaas_interest_percent: event.target.value })} />
                  </label>
                  <label>
                    Forma de pagamento no Asaas
                    <select value={form.asaas_billing_type || "UNDEFINED"} disabled={!isAdmin}
                      onChange={(event) => setForm({ ...form, asaas_billing_type: event.target.value })}>
                      <option value="UNDEFINED">Cliente escolhe (Pix, boleto ou cartão)</option>
                      <option value="PIX">Pix</option>
                      <option value="BOLETO">Boleto</option>
                      <option value="CREDIT_CARD">Cartão</option>
                    </select>
                  </label>
                  {"collection_due_day_times" in form && (
                    <>
                      <label>
                        Horários no dia do vencimento
                        <TimesInput value={form.collection_due_day_times} disabled={!isAdmin} placeholder="09:00, 12:00, 18:00"
                          onChange={(times) => setForm((current) => ({ ...current, collection_due_day_times: times }))} />
                      </label>
                      <label>
                        Horários nos dias seguintes
                        <TimesInput value={form.collection_overdue_times} disabled={!isAdmin} placeholder="09:00"
                          onChange={(times) => setForm((current) => ({ ...current, collection_overdue_times: times }))} />
                      </label>
                      <label>
                        Parar após quantos dias de atraso
                        <input type="number" min="0" max="90" value={form.collection_max_overdue_days ?? 15} disabled={!isAdmin}
                          onChange={(event) => setForm({ ...form, collection_max_overdue_days: Number(event.target.value) })} />
                      </label>
                      <label className="checkbox-row">
                        <input type="checkbox" checked={Boolean(form.collection_cadence_enabled)} disabled={!isAdmin}
                          onChange={(event) => setForm({ ...form, collection_cadence_enabled: event.target.checked })} />
                        Cobrança automática ligada
                      </label>
                    </>
                  )}
                </div>
              </section>
            )}
            <section className="settings-section">
              <h2>Outras configurações</h2>
              <div className="form-grid">
                {[
                  ["document_number", "Documento"],
                  ["billing_email", "E-mail financeiro"],
                  ["whatsapp_number", "WhatsApp"],
                  ["whatsapp_provider", "Provider WhatsApp"],
                  ["currency", "Moeda"],
                  ["timezone", "Fuso horário"],
                ].map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      value={form[key] || ""}
                      disabled={!isAdmin}
                      onChange={(event) =>
                        setForm({ ...form, [key]: event.target.value })
                      }
                    />
                  </label>
                ))}
              </div>
            </section>
            {isAdmin && (
              <button className="button">Salvar configurações</button>
            )}
          </form>
          <PixPaymentPanel
            pixKey={form.pix_key}
            bankName={form.bank_name}
            holder={form.legal_name}
          />
        </>
      )}
    </div>
  );
}
