function genId() {
  return `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

module.exports = {
  genId,
};
