// Tiny URL-safe id generator. Не криптостойкий — для node IDs внутри одной DSL хватает.
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
export function nanoid(size = 8): string {
  let out = ''
  for (let i = 0; i < size; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return out
}
