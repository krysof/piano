class FreezaPcmRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.sessionId = 0;
    this.channelCount = 2;
    this.blockFrames = 4096;
    this.buffer = new Int16Array(this.blockFrames * this.channelCount);
    this.frameOffset = 0;
    this.port.onmessage = event => {
      const message = event.data || {};
      if (message.type === 'start') {
        this.sessionId = Number(message.sessionId) || 0;
        this.recording = true;
        this.frameOffset = 0;
      } else if (message.type === 'stop') {
        this.recording = false;
        this.flush();
        this.port.postMessage({ type: 'stopped', sessionId: this.sessionId });
      }
    };
  }

  flush() {
    if (!this.frameOffset) return;
    const samples = this.buffer.slice(0, this.frameOffset * this.channelCount);
    this.port.postMessage({
      type: 'pcm',
      sessionId: this.sessionId,
      frames: this.frameOffset,
      buffer: samples.buffer,
    }, [samples.buffer]);
    this.buffer = new Int16Array(this.blockFrames * this.channelCount);
    this.frameOffset = 0;
  }

  writeSample(value) {
    const clamped = Math.max(-1, Math.min(1, Number(value) || 0));
    return clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
  }

  process(inputs) {
    if (!this.recording) return true;
    const input = inputs[0];
    if (!input?.length || !input[0]?.length) return true;
    const left = input[0];
    const right = input[1] || left;
    for (let frame = 0; frame < left.length; frame += 1) {
      if (this.frameOffset >= this.blockFrames) this.flush();
      const sampleOffset = this.frameOffset * this.channelCount;
      this.buffer[sampleOffset] = this.writeSample(left[frame]);
      this.buffer[sampleOffset + 1] = this.writeSample(right[frame]);
      this.frameOffset += 1;
    }
    return true;
  }
}

registerProcessor('freeza-pcm-recorder', FreezaPcmRecorderProcessor);
