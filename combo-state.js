(function attachComboState(root) {
  const COMMENT_LEVELS = Object.freeze([
    Object.freeze({ min: 200, text: '传奇演奏' }),
    Object.freeze({ min: 100, text: '舞台主宰' }),
    Object.freeze({ min: 60, text: '火力全开' }),
    Object.freeze({ min: 30, text: '节奏在线' }),
    Object.freeze({ min: 10, text: '渐入佳境' }),
    Object.freeze({ min: 1, text: '初露锋芒' }),
    Object.freeze({ min: 0, text: '尚未连击' }),
  ]);

  function commentFor(combo) {
    const value = Math.max(0, Math.floor(Number(combo) || 0));
    return COMMENT_LEVELS.find(level => value >= level.min)?.text || '尚未连击';
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

  root.FreezaComboState = Object.freeze({ create, commentFor, levels: COMMENT_LEVELS });
})(typeof window !== 'undefined' ? window : globalThis);
