import { MugoLogo } from './MugoLogo'
import { MugoSymbol } from './MugoSymbol'

export function MugoBrand({ variant = 'full', ...props }) {
  return variant === 'symbol' ? <MugoSymbol {...props} /> : <MugoLogo {...props} />
}
