import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { FeedbackMessage } from './FeedbackMessage'
import { BrandHeroVideo } from './brand/BrandHeroVideo'
import { MugoLogo } from './brand/MugoLogo'

export function LoginPage() {
  const { signIn, error: accessError } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setLoading(true)
    setError('')
    const { error: signInError } = await signIn(email, password)
    if (signInError) setError('E-mail ou senha inválidos.')
    setLoading(false)
  }

  return (
    <main className="login-page">
      <section className="login-visual" aria-label="Identidade visual da Agência Mugô">
        <BrandHeroVideo />
      </section>
      <section className="login-content">
        <form className="login-card" onSubmit={submit}>
          <header className="login-heading">
            <MugoLogo theme="light" loading="eager" />
            <h1>Mugô CRM</h1>
            <p>Gestão comercial e inteligência de receita</p>
          </header>
          {(error || accessError) && <FeedbackMessage type="error">{error || accessError}</FeedbackMessage>}
          <label>E-mail<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Senha<input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button className="button" disabled={loading}>{loading ? 'Entrando…' : 'Entrar'}</button>
        </form>
      </section>
    </main>
  )
}
