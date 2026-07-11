(function attachComboState(root) {
  const COMMENT_LEVELS = Object.freeze([
    Object.freeze({ minRatio: 1.00, text: '传奇演奏' }),
    Object.freeze({ minRatio: 0.80, text: '舞台主宰' }),
    Object.freeze({ minRatio: 0.60, text: '火力全开' }),
    Object.freeze({ minRatio: 0.40, text: '节奏在线' }),
    Object.freeze({ minRatio: 0.20, text: '渐入佳境' }),
    Object.freeze({ minRatio: 0.00, text: '初露锋芒' }),
  ]);

  function ratioFor(combo, total) {
    const value = Math.max(0, Math.floor(Number(combo) || 0));
    const target = Math.max(0, Math.floor(Number(total) || 0));
    if (!value || !target) return 0;
    return Math.max(0, Math.min(1, value / target));
  }

  function commentFor(combo, total) {
    const value = Math.max(0, Math.floor(Number(combo) || 0));
    const target = Math.max(0, Math.floor(Number(total) || 0));
    if (!value || !target) return '尚未连击';
    const ratio = ratioFor(value, target);
    return COMMENT_LEVELS.find(level => ratio >= level.minRatio)?.text || '初露锋芒';
  }

  function create({ breakGrades = ['MISS'] } = {}) {
    const breakers = new Set(breakGrades.map(String));
    let current = 0;
    let maximum = 0;

    function snapshot() {
      return Object.freeze({ current, maximum });
    }

    return Object.freeze({
      record(grade) {
        if (breakers.has(String(grade))) current = 0;
        else {
          current += 1;
          maximum = Math.max(maximum, current);
        }
        return snapshot();
      },
      reset() {
        current = 0;
        maximum = 0;
        return snapshot();
      },
      snapshot,
    });
  }

  root.FreezaComboState = Object.freeze({ create, ratioFor, commentFor, levels: COMMENT_LEVELS });
})(typeof window !== 'undefined' ? window : globalThis);
