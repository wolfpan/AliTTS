function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 23);
}

module.exports = {
  info: (...args) => console.log(`[INFO ${ts()}]`, ...args),
  warn: (...args) => console.warn(`[WARN ${ts()}]`, ...args),
  error: (...args) => console.error(`[ERR  ${ts()}]`, ...args),
};
