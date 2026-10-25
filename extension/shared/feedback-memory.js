// Local explicit-feedback memory. No model training or network calls.
(function (root) {
  const control = (root.control = root.control || {});
  const CONFIG = Object.freeze({ maxExamples: 1000, neighbors: 5, minSupport: 3, minSimilarity: 0.9, minMargin: 0.05 });
  function textOf(text) { return String(text || '').slice(0, 20000); }
  function validVector(v) {
    return Array.isArray(v) && v.length > 0 && v.every(Number.isFinite) &&
      Math.abs(v.reduce((s, x) => s + x * x, 0) - 1) < 0.05;
  }
  function predict(examples, { profile, encoder, text, vector }, cfg = CONFIG) {
    const eligible = examples.filter((e) => e.profile === profile && e.encoder === encoder);
    const exact = eligible.find((e) => e.text === textOf(text));
    if (exact) return { decision: exact.decision, reason: 'Your correction', uncertain: false, source: 'feedback-exact' };
    if (!validVector(vector)) return null;
    const scored = eligible.filter((e) => validVector(e.vector) && e.vector.length === vector.length)
      .map((e) => ({ ...e, similarity: e.vector.reduce((s, x, i) => s + x * vector[i], 0) }))
      .sort((a, b) => b.similarity - a.similarity);
    const nearest = scored.filter((e) => e.similarity >= cfg.minSimilarity).slice(0, cfg.neighbors);
    if (nearest.length < cfg.minSupport || !nearest.every((e) => e.decision === nearest[0].decision)) return null;
    const opposite = scored.find((e) => e.decision !== nearest[0].decision);
    if (opposite && nearest[nearest.length - 1].similarity - opposite.similarity < cfg.minMargin) return null;
    return { decision: nearest[0].decision, reason: 'Similar to your corrections', uncertain: false, source: 'feedback-similar' };
  }
  function correct(state, entry, cfg = CONFIG) {
    if (!['show', 'hide'].includes(entry.decision) || !entry.profile || !entry.encoder ||
        !textOf(entry.text).trim() || !validVector(entry.vector)) throw new Error('Invalid feedback');
    const text = textOf(entry.text);
    const same = (e) => e.profile === entry.profile && e.encoder === entry.encoder && e.text === text;
    const previous = state.examples.find(same) || null;
    const example = { ...entry, text, at: Date.now() };
    const examples = state.examples.filter((e) => !same(e));
    examples.push(example);
    const evicted = examples.splice(0, Math.max(0, examples.length - cfg.maxExamples));
    return { revision: state.revision + 1, examples, undo: { example, previous, evicted } };
  }
  function undo(state) {
    if (!state.undo) return state;
    const { example, previous, evicted } = state.undo;
    const examples = [...evicted, ...state.examples.filter((e) => e !== example &&
      !(e.profile === example.profile && e.encoder === example.encoder && e.text === example.text))];
    if (previous) examples.push(previous);
    return { revision: state.revision + 1, examples, undo: null };
  }
  control.feedbackMemory = { CONFIG, textOf, validVector, predict, correct, undo };
})(globalThis);
