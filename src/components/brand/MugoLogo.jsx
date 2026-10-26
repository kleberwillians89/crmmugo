export function MugoLogo({ theme = 'dark', className = '', loading = 'lazy' }) {
  return (
    <img
      className={`mugo-logo ${theme} ${className}`.trim()}
      src="/mugo-wordmark.png"
      alt="Agência Mugô"
      loading={loading}
      decoding="async"
    />
  )
}
