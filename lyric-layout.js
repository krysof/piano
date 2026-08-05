(function initLyricLayout(global) {
  function hasVisibleLyrics(line) {
    return String(line?.text || '').trim().length > 0
      || (line?.events || []).some(event => String(event?.text || '').trim());
  }

  function shouldAlignExplicitLineText(text) {
    // A whitespace-only LLLYRIC_LINE describes a chord-only/prelude span.
    // Its spaces are layout metadata, not lyric glyphs. Actual chord blocks
    // are inserted later from chordCues; turning these spaces into glyph
    // events creates fake red C cues that can never be pressed.
    return String(text || '').trim().length > 0;
  }

  function mergeSingleCharacterLines(inputLines) {
    const output = [];
    for (const source of inputLines || []) {
      const line = {
        ...source,
        furigana: [...(source?.furigana || [])],
        events: [...(source?.events || [])],
      };
      const visibleText = String(line.text || '').trim();
      const previous = output.at(-1);
      const previousText = String(previous?.text || '');

      // 单独一个字会让歌词光标突然换到只有一字的新行，也会把这个字
      // 与原句的和弦提示拆开。中日文都把它并回上一句；空白和弦行、
      // 前奏行不参与，避免把纯伴奏色块并进歌词。
      if (
        [...visibleText].length === 1
        && previous
        && String(previousText).trim()
        && !previous.chordOnly
        && !previous.prelude
      ) {
        const textOffset = [...previousText].length;
        previous.text = `${previousText}${visibleText}`;
        const previousReading = String(previous.reading || '');
        const lineReading = String(line.reading || '');
        previous.reading = previousReading || lineReading
          ? `${previousReading || previousText}${lineReading || visibleText}`
          : '';
        previous.furigana = [
          ...(previous.furigana || []),
          ...(line.furigana || []).map(item => ({
            ...item,
            start: textOffset + Number(item.start || 0),
          })),
        ];
        previous.events = [...(previous.events || []), ...(line.events || [])]
          .sort((left, right) => Number(left.time) - Number(right.time));
        previous.end = Math.max(Number(previous.end) || 0, Number(line.end) || 0);
        continue;
      }
      output.push(line);
    }
    return output;
  }

  function redistributeChordSpaceLines(inputLines, options = {}) {
    const maxBlocksPerLine = Math.max(1, Number(options.maxBlocksPerLine) || 10);
    const bridgeMax = Math.max(2, Number(options.bridgeMax) || 3);
    const lines = (inputLines || []).map(line => ({
      ...line,
      events: [...(line?.events || [])].sort((a, b) => a.time - b.time),
    }));
    const output = [];

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const events = line.events;
      let trailingStart = events.length;
      while (trailingStart > 0 && events[trailingStart - 1]?.chordSpace) trailingStart -= 1;
      const lyricEvents = events.slice(0, trailingStart);
      const blankEvents = events.slice(trailingStart);
      const nextLine = lines[index + 1];

      // 分组后若只剩一个纯空白和弦，不能让它独占一行。把它作为
      // 下一句的起拍放到下一行开头；这也覆盖“10 个前奏色块 + 余 1 个”
      // 的情况，避免屏幕上出现孤零零的一格。
      if (
        !hasVisibleLyrics(line)
        && events.length === 1
        && blankEvents.length === 1
        && hasVisibleLyrics(nextLine)
      ) {
        const nextLead = blankEvents[0];
        nextLine.start = Math.min(Number(nextLine.start) || Infinity, Number(nextLead.time) || 0);
        nextLine.events = [nextLead, ...nextLine.events].sort((a, b) => a.time - b.time);
        continue;
      }

      // 一至三个无字和弦处在两句歌词之间时，不应独占一整行：
      // 最后一个作为下一句的起拍，其余留在上一句结尾。
      if (
        hasVisibleLyrics(line)
        && blankEvents.length >= 1
        && blankEvents.length <= bridgeMax
        && hasVisibleLyrics(nextLine)
      ) {
        const nextLead = blankEvents.at(-1);
        line.events = [...lyricEvents, ...blankEvents.slice(0, -1)];
        line.end = Math.max(Number(line.start) || 0, Number(nextLead.time) || 0);
        nextLine.start = Math.min(Number(nextLine.start) || Infinity, Number(nextLead.time) || 0);
        nextLine.events = [nextLead, ...nextLine.events].sort((a, b) => a.time - b.time);
        output.push(line);
        continue;
      }

      if (!hasVisibleLyrics(line) || blankEvents.length < 2) {
        output.push(line);
        continue;
      }

      // 长尾奏仍使用独立色块行，每行最多 maxBlocksPerLine 个。
      const originalEnd = line.end;
      line.events = lyricEvents;
      line.end = Math.max(Number(line.start) || 0, Number(blankEvents[0].time) || 0);
      output.push(line);
      for (let i = 0; i < blankEvents.length; i += maxBlocksPerLine) {
        const chunk = blankEvents.slice(i, i + maxBlocksPerLine);
        const nextStart = blankEvents[i + maxBlocksPerLine]?.time;
        output.push({
          start: chunk[0].time,
          end: Math.max(chunk[0].time, nextStart ?? originalEnd),
          text: ' '.repeat(chunk.length),
          events: chunk,
          paragraphType: line.paragraphType,
          chordOnly: true,
        });
      }
    }

    return output.sort((a, b) => a.start - b.start);
  }

  function findLyricEventForChordCue(inputLines, cue, options = {}) {
    if (!cue || !Number.isFinite(Number(cue.time))) return null;
    const exactTolerance = Math.max(0, Number(options.exactTolerance) || 0.008);
    const beatSeconds = Math.max(0, Number(options.beatSeconds) || 0);
    const usedEvents = options.usedEvents instanceof Set ? options.usedEvents : null;
    const sameBeatLimit = beatSeconds * 0.76;
    const events = (inputLines || [])
      .flatMap(line => (line?.events || []).map((event, index) => ({ event, line, index })))
      .filter(item => String(item.event?.text || '').trim() && !usedEvents?.has(item.event))
      .sort((left, right) => Number(left.event.time) - Number(right.event.time));
    if (!events.length) return null;

    // Standard lyric events normally share the exact tick with their chord.
    // Prefer that authoritative match before applying beat-aware recovery.
    let exact = null;
    for (const item of events) {
      const distance = Math.abs(Number(item.event.time) - Number(cue.time));
      if (distance <= exactTolerance && (!exact || distance < exact.distance)) {
        exact = { ...item, distance };
      }
    }
    if (exact) return exact;

    // LiberLive JSON attaches a chord to a beat, while the first sung note in
    // that beat may start at subdivision 1/2/3. The enhanced MIDI therefore
    // places the chord before its lyric glyph. Bind it to the first glyph still
    // inside the same beat; a true lyric-less beat remains a square cue.
    if (!sameBeatLimit) return null;
    const next = events.find(item => {
      const distance = Number(item.event.time) - Number(cue.time);
      return distance > exactTolerance && distance <= sameBeatLimit + exactTolerance;
    });
    return next ? { ...next, distance: Number(next.event.time) - Number(cue.time) } : null;
  }

  const api = {
    mergeSingleCharacterLines,
    redistributeChordSpaceLines,
    findLyricEventForChordCue,
    shouldAlignExplicitLineText,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.FreezaLyricLayout = api;
})(typeof window !== 'undefined' ? window : globalThis);
