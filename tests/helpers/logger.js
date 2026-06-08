// tests/helpers/logger.js
// Logger desabilitado.
// Mantido apenas para compatibilidade com os testes existentes.

const noop = () => {};

const log = {
  step: noop,
  info: noop,
  start: noop,
  finish: noop,
  discount: noop,
  tip: noop,
  payment: noop,
  dashboard: noop,
};

module.exports = { log };