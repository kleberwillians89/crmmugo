export function callIfFunction(callback, ...args) {
  return typeof callback === 'function' ? callback(...args) : undefined
}
