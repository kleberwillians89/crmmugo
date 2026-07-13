import { MugoLogo } from './brand/MugoLogo'

export function BrandLoading() {
  return (
    <main className="brand-loading" role="status" aria-live="polite">
      <MugoLogo theme="light" loading="eager" />
      <p>Carregando Mugô CRM...</p>
    </main>
  )
}
