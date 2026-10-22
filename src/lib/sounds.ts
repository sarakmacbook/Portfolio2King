"use client";

/** A short synthesized ATM cash-dispensing sound—no audio file or network request needed. */
export function playMoneyChime(context: AudioContext) {
  const start = context.currentTime;
  const output = context.createGain();
  output.gain.setValueAtTime(0.0001, start);
  output.gain.exponentialRampToValueAtTime(0.2, start + 0.025);
  output.gain.setValueAtTime(0.2, start + 0.58);
  output.gain.exponentialRampToValueAtTime(0.0001, start + 0.82);
  output.connect(context.destination);

  // Low mechanical motor hum from the ATM rollers.
  const motor = context.createOscillator();
  const motorGain = context.createGain();
  motor.type = "sawtooth";
  motor.frequency.setValueAtTime(82, start);
  motor.frequency.linearRampToValueAtTime(106, start + 0.18);
  motor.frequency.linearRampToValueAtTime(88, start + 0.72);
  motorGain.gain.setValueAtTime(0.18, start);
  motorGain.gain.linearRampToValueAtTime(0.08, start + 0.75);
  motor.connect(motorGain);
  motorGain.connect(output);
  motor.start(start);
  motor.stop(start + 0.8);

  // Filtered noise gives the sound of notes moving through rubber rollers.
  const frameCount = Math.ceil(context.sampleRate * 0.82);
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i++) channel[i] = Math.random() * 2 - 1;
  const noise = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const noiseGain = context.createGain();
  filter.type = "bandpass";
  filter.frequency.value = 1250;
  filter.Q.value = 0.7;
  noiseGain.gain.value = 0.22;
  noise.buffer = buffer;
  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(output);
  noise.start(start);
  noise.stop(start + 0.82);

  // Fast note-counter clicks followed by the ATM completion beep.
  [0.08, 0.17, 0.26, 0.35, 0.44, 0.53].forEach((delay) => {
    const click = context.createOscillator();
    const clickGain = context.createGain();
    const at = start + delay;
    click.type = "square";
    click.frequency.setValueAtTime(210, at);
    clickGain.gain.setValueAtTime(0.32, at);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.035);
    click.connect(clickGain);
    clickGain.connect(output);
    click.start(at);
    click.stop(at + 0.04);
  });

  const beep = context.createOscillator();
  const beepGain = context.createGain();
  beep.type = "sine";
  beep.frequency.value = 1046.5;
  beepGain.gain.setValueAtTime(0.0001, start + 0.64);
  beepGain.gain.exponentialRampToValueAtTime(0.45, start + 0.65);
  beepGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.79);
  beep.connect(beepGain);
  beepGain.connect(output);
  beep.start(start + 0.64);
  beep.stop(start + 0.8);
}

/** Starts audio from a user gesture, including in iOS standalone web apps. */
export function playMoneyChimeFromGesture() {
  const context = new AudioContext();
  void context.resume().then(() => playMoneyChime(context));
}
