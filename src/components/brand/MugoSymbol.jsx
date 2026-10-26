export function MugoSymbol({ size = 36, className = '', loading = 'lazy' }) {
  return (
    <img
      className={`mugo-symbol ${className}`.trim()}
      src="/mugo-symbol.svg"
      alt="Agência Mugô"
      width={size}
      height={size}
      loading={loading}
      decoding="async"
    />
  )
}
