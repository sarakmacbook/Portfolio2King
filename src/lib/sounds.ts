"use client";

/** A short, synthesized two-coin chime—no audio file or network request needed. */
export function playMoneyChime(context: AudioContext) {
  const start = context.currentTime;
  const master = context.createGain();
  master.gain.setValueAtTime(0.18, start);
  master.connect(context.destination);

  [
    { delay: 0, frequency: 1318.51 },
    { delay: 0.13, frequency: 1760 },
  ].forEach(({ delay, frequency }) => {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const at = start + delay;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, at);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.06, at + 0.16);
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(0.9, at + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
    oscillator.connect(envelope);
    envelope.connect(master);
    oscillator.start(at);
    oscillator.stop(at + 0.3);
  });
}

/** Starts audio from a user gesture, including in iOS standalone web apps. */
export function playMoneyChimeFromGesture() {
  const context = new AudioContext();
  void context.resume().then(() => playMoneyChime(context));
}
