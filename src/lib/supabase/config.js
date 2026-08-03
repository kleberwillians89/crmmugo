const INVALID_PUBLIC_KEY = /[^A-Za-z0-9._-]/

function isInvisibleOrWhitespace(character) {
  const code = character.codePointAt(0)
  return code <= 0x20 || code === 0x7f || code === 0xa0 ||
    (code >= 0x200b && code <= 0x200f) || code === 0x2028 || code === 0x2029 ||
    code === 0x202f || code === 0x2060 || code === 0xfeff
}

const hasInvisibleOrWhitespace = (value) => Array.from(value).some(isInvisibleOrWhitespace)

export function inspectCharacters(value) {
  const input = String(value ?? '')
  const last = input.at(-1) || ''
  return {
    length: input.length,
    lastCharacterCode: last ? last.codePointAt(0) : null,
    hasCR: input.includes('\r'),
    hasLF: input.includes('\n'),
    hasTAB: input.includes('\t'),
    hasSpaces: input.includes(' '),
    hasBOM: input.includes('\ufeff'),
    hasInvisibleUnicode: /[\u00a0\u200b-\u200f\u2028\u2029\u202f\u2060]/.test(input),
  }
}

export function sanitizeSupabaseEnvironment(value) {
  return Array.from(String(value ?? '')).filter((character)=>!isInvisibleOrWhitespace(character)).join('').trim()
}

export function assertSupabaseUrl(url) {
  let parsed
  try { parsed = new URL(url) } catch { throw new Error('Supabase não configurado com uma URL HTTPS válida.') }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Supabase não configurado com uma URL HTTPS válida.')
  }
  return parsed.origin
}

export function assertSupabasePublicKey(key) {
  if (!key) throw new Error('Supabase não configurado com uma chave pública válida.')
  if (INVALID_PUBLIC_KEY.test(key) || hasInvisibleOrWhitespace(key)) {
    throw new Error('A chave pública do Supabase contém caracteres inválidos.')
  }
  if (!(key.startsWith('eyJ') || key.startsWith('sb_publishable_'))) {
    throw new Error('O formato da chave pública do Supabase não é reconhecido.')
  }
  return key
}

export function sha256Hex(input) {
  const rightRotate=(value,amount)=>(value>>>amount)|(value<<(32-amount))
  const text=unescape(encodeURIComponent(String(input)))
  const words=[],bitLength=text.length*8
  for(let index=0;index<text.length;index++)words[index>>2]|=text.charCodeAt(index)<<(24-(index%4)*8)
  words[bitLength>>5]|=0x80<<(24-bitLength%32)
  words[((bitLength+64>>9)<<4)+15]=bitLength
  const hash=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]
  const constants=[
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ]
  for(let offset=0;offset<words.length;offset+=16){
    const schedule=[]
    for(let index=0;index<64;index++){
      if(index<16)schedule[index]=words[offset+index]||0
      else{
        const a=schedule[index-15],b=schedule[index-2]
        const s0=rightRotate(a,7)^rightRotate(a,18)^(a>>>3)
        const s1=rightRotate(b,17)^rightRotate(b,19)^(b>>>10)
        schedule[index]=(schedule[index-16]+s0+schedule[index-7]+s1)|0
      }
    }
    let [a,b,c,d,e,f,g,h]=hash
    for(let index=0;index<64;index++){
      const s1=rightRotate(e,6)^rightRotate(e,11)^rightRotate(e,25)
      const choice=(e&f)^(~e&g)
      const temp1=(h+s1+choice+constants[index]+schedule[index])|0
      const s0=rightRotate(a,2)^rightRotate(a,13)^rightRotate(a,22)
      const majority=(a&b)^(a&c)^(b&c)
      const temp2=(s0+majority)|0
      h=g;g=f;f=e;e=(d+temp1)|0;d=c;c=b;b=a;a=(temp1+temp2)|0
    }
    const values=[a,b,c,d,e,f,g,h]
    for(let index=0;index<8;index++)hash[index]=(hash[index]+values[index])|0
  }
  return hash.map(value=>(value>>>0).toString(16).padStart(8,'0')).join('')
}

export function resolveSupabasePublicConfig(env = {}) {
  const rawUrl = String(env.VITE_SUPABASE_URL ?? '')
  const rawKey = String(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '')
  const rawUrlInspection=inspectCharacters(rawUrl),rawKeyInspection=inspectCharacters(rawKey)
  const sanitizedUrl=sanitizeSupabaseEnvironment(rawUrl),sanitizedKey=sanitizeSupabaseEnvironment(rawKey)
  const url = assertSupabaseUrl(sanitizedUrl)
  const key = assertSupabasePublicKey(sanitizedKey)
  return {
    url,
    key,
    whitespaceDetected: rawUrl!==sanitizedUrl||rawKey!==sanitizedKey,
    diagnostics: {
      urlLength:url.length,
      keyLength:key.length,
      keySha256:sha256Hex(key),
      keyLast8:key.slice(-8),
      keyLastCharacterCode:key.codePointAt(key.length-1),
      raw:{url:rawUrlInspection,key:rawKeyInspection},
    },
  }
}
