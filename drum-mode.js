(function (global) {
  function usesLiveClock(playMode) {
    return playMode === 'free' || playMode === 'manual' || playMode === 'one-key';
  }

  function performanceOpen({ playMode, playing, gameStarted }) {
    return playMode === 'free' ? Boolean(playing) : Boolean(gameStarted);
  }

  function shouldRunLive({ playMode, drumMode, playing, gameStarted }) {
    return usesLiveClock(playMode)
      && drumMode === 'on'
      && performanceOpen({ playMode, playing, gameStarted });
  }

  global.FreezaDrumMode = { usesLiveClock, performanceOpen, shouldRunLive };
})(typeof window !== 'undefined' ? window : globalThis);
