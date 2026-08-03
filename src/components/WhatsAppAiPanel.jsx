import { useState } from 'react'
import { FeedbackMessage } from './FeedbackMessage'

export function WhatsAppAiPanel(){
  const [mode,setMode]=useState('disabled')
  return <section className="dashboard-panel"><header><small>Arquitetura inicial</small><h2>Atendimento com IA</h2><p>Nenhum modelo externo é chamado nesta tela.</p></header><label>Modo<select value={mode} onChange={event=>setMode(event.target.value)}><option value="disabled">Desativado</option><option value="copilot">Copilot — humano aprova</option><option value="controlled_auto">Automático controlado</option></select></label><FeedbackMessage type="info">Configuração de demonstração: {mode}. Cobrança sensível e jurídico sempre exigem humano; baixa confiança gera handoff.</FeedbackMessage><ul><li>Base de conhecimento: não configurada</li><li>Sugestões: sem execução real</li><li>Assumir atendimento: disponível após persistência</li><li>IA desligável por workspace e conversa</li></ul></section>
}
