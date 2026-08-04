(function initLyricLayout(global) {
  function hasVisibleLyrics(line) {
    return String(line?.text || '').trim().length > 0
      || (line?.events || []).some(event => String(event?.text || '').trim());
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

      // 两三个无字和弦处在两句歌词之间时，不应独占一整行：
      // 最后一个作为下一句的起拍，其余留在上一句结尾。
      if (
        hasVisibleLyrics(line)
        && blankEvents.length >= 2
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

  const api = { redistributeChordSpaceLines };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.FreezaLyricLayout = api;
})(typeof window !== 'undefined' ? window : globalThis);
