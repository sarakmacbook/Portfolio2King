"use client";

/** A short synthesized two-coin “ting ting” chime—no audio file or network request needed. */
export function playMoneyChime(context: AudioContext) {
  const start = context.currentTime;
  const master = context.createGain();
  master.gain.setValueAtTime(0.16, start);
  master.gain.exponentialRampToValueAtTime(0.0001, start + 0.72);
  master.connect(context.destination);

  [
    { delay: 0, frequency: 1318.51 },
    { delay: 0.2, frequency: 1760 },
  ].forEach(({ delay, frequency }) => {
    const at = start + delay;

    // Main bell tone.
    const bell = context.createOscillator();
    const envelope = context.createGain();
    bell.type = "sine";
    bell.frequency.setValueAtTime(frequency, at);
    bell.frequency.exponentialRampToValueAtTime(frequency * 1.025, at + 0.25);
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(0.95, at + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.42);
    bell.connect(envelope);
    envelope.connect(master);
    bell.start(at);
    bell.stop(at + 0.44);

    // Quiet upper harmonic makes each “ting” crisp like a coin or register bell.
    const harmonic = context.createOscillator();
    const harmonicGain = context.createGain();
    harmonic.type = "sine";
    harmonic.frequency.setValueAtTime(frequency * 2.01, at);
    harmonicGain.gain.setValueAtTime(0.22, at);
    harmonicGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
    harmonic.connect(harmonicGain);
    harmonicGain.connect(master);
    harmonic.start(at);
    harmonic.stop(at + 0.2);
  });
}

/** Starts audio from a user gesture, including in iOS standalone web apps. */
export function playMoneyChimeFromGesture() {
  const context = new AudioContext();
  void context.resume().then(() => playMoneyChime(context));
}
