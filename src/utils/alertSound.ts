import type { AlertSoundOption } from '../types/trading';

let sharedAudioCtx: AudioContext | null = null;
let listenersBound = false;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtx) return null;

  if (!sharedAudioCtx) {
    try {
      sharedAudioCtx = new AudioCtx();
    } catch {
      return null;
    }
  }
  return sharedAudioCtx;
}

export function unlockAlertAudio(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {
      // Ignore autoplay restriction until user interacts
    });
  }
}

export function bindAudioUnlockListeners(): () => void {
  if (typeof window === 'undefined' || listenersBound) {
    return () => {};
  }
  listenersBound = true;
  const handler = () => {
    unlockAlertAudio();
  };
  window.addEventListener('pointerdown', handler, { passive: true });
  window.addEventListener('keydown', handler, { passive: true });

  return () => {
    listenersBound = false;
    window.removeEventListener('pointerdown', handler);
    window.removeEventListener('keydown', handler);
  };
}

function scheduleTone(
  ctx: AudioContext,
  opts: {
    freq: number;
    endFreq?: number;
    start: number;
    dur: number;
    peak: number;
    type?: OscillatorType;
  }
) {
  const now = ctx.currentTime + opts.start;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.freq, now);
  if (opts.endFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(opts.endFreq, now + opts.dur);
  }

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(opts.peak, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0006, now + opts.dur);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + opts.dur + 0.025);
}

function playSynthesizedSound(ctx: AudioContext, soundType: AlertSoundOption): void {
  if (soundType === 'silent') return;

  if (soundType === 'classic_bell') {
    // Rich metallic bell with harmonic overtones
    scheduleTone(ctx, { freq: 987.77, start: 0, dur: 0.75, peak: 0.24, type: 'sine' });
    scheduleTone(ctx, { freq: 1975.53, start: 0, dur: 0.52, peak: 0.12, type: 'triangle' });
    scheduleTone(ctx, { freq: 2960, start: 0.004, dur: 0.32, peak: 0.06, type: 'sine' });
    return;
  }

  if (soundType === 'digital_chime') {
    // Crisp rising 3-note triad chime
    scheduleTone(ctx, { freq: 880, start: 0, dur: 0.16, peak: 0.22, type: 'triangle' });
    scheduleTone(ctx, { freq: 1174.66, start: 0.1, dur: 0.2, peak: 0.26, type: 'triangle' });
    scheduleTone(ctx, { freq: 1567.98, start: 0.2, dur: 0.34, peak: 0.22, type: 'triangle' });
    return;
  }

  if (soundType === 'sonar_ping') {
    // Clean radar sonar pulse + soft echo
    scheduleTone(ctx, { freq: 1046.5, start: 0, dur: 0.38, peak: 0.28, type: 'sine' });
    scheduleTone(ctx, { freq: 1046.5, start: 0.28, dur: 0.36, peak: 0.12, type: 'sine' });
    return;
  }

  if (soundType === 'double_beep') {
    // Two sharp terminal pips
    scheduleTone(ctx, { freq: 1318.5, start: 0, dur: 0.085, peak: 0.2, type: 'square' });
    scheduleTone(ctx, { freq: 1318.5, start: 0.13, dur: 0.1, peak: 0.22, type: 'square' });
    return;
  }

  if (soundType === 'cash_register') {
    // Mechanical "cha" burst + crisp "ching!" bell resonance
    try {
      const bufferSize = Math.floor(ctx.sampleRate * 0.055);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(2200, ctx.currentTime);

      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.18, ctx.currentTime);
      nGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.055);

      noise.connect(filter);
      filter.connect(nGain);
      nGain.connect(ctx.destination);
      noise.start(ctx.currentTime);
    } catch {
      // Fallback click if buffer creation fails
    }

    scheduleTone(ctx, { freq: 520, endFreq: 1180, start: 0.01, dur: 0.06, peak: 0.14, type: 'triangle' });
    scheduleTone(ctx, { freq: 2093.0, start: 0.085, dur: 0.55, peak: 0.24, type: 'sine' });
    scheduleTone(ctx, { freq: 2637.02, start: 0.09, dur: 0.45, peak: 0.16, type: 'triangle' });
    scheduleTone(ctx, { freq: 4186.01, start: 0.095, dur: 0.3, peak: 0.08, type: 'sine' });
  }
}

export function playAlertSound(soundType: AlertSoundOption = 'classic_bell'): void {
  if (soundType === 'silent') return;
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    void ctx
      .resume()
      .then(() => {
        playSynthesizedSound(ctx, soundType);
      })
      .catch(() => {
        // Ignore browser autoplay block if no gesture yet
      });
  } else {
    playSynthesizedSound(ctx, soundType);
  }
}
