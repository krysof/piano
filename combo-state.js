(function attachComboState(root) {
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

  root.FreezaComboState = Object.freeze({ create });
})(typeof window !== 'undefined' ? window : globalThis);
