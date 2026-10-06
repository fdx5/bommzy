/**
 * Procedural Web Audio: every SFX and both music loops are synthesized at runtime (0 bytes of assets).
 * Each sound is built from layers — transient (click/crack) · body (tone/noise) · sub (punch) · tail —
 * with per-play pitch jitter so rapid fire never sounds like a loop, plus a soft reverb send.
 */
export type Sfx =
  | 'gatling' | 'gatlingSuper' | 'shotgun' | 'throw' | 'bow' | 'boomerang' | 'bubble'
  | 'impBullet' | 'impPellet' | 'impArrow' | 'impBoomerang' | 'impBubble' | 'impExplosive'
  | 'hitConfirm' | 'crit' | 'shieldHit' | 'hitMe' | 'explode' | 'bigExplode' | 'kill' | 'killMe'
  | 'superReady' | 'superGatling' | 'superBigbang' | 'superMegabomb' | 'superMeteor' | 'superTornado' | 'superPrison'
  | 'pickup' | 'heal' | 'click' | 'reload' | 'dry' | 'rustle' | 'rock' | 'crate' | 'step' | 'land'
  | 'count' | 'go' | 'retire' | 'victory' | 'event' | 'pop' | 'streak' | 'dash' | 'shield' | 'tick' | 'whoosh';

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export interface PlayOpts { pitch?: number; noJitter?: boolean }

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private reverbSend!: GainNode;
  private noiseBuf!: AudioBuffer;
  private sfxVol = 0.8;
  private musicVol = 0.5;
  private track: 'lobby' | 'battle' | null = null;
  private wantTrack: 'lobby' | 'battle' | null = null;
  private nextNote = 0;
  private step = 0;
  private timer: number | null = null;
  private lastPlay = new Map<string, number>();
  private voices = 0;
  listener = { x: 0, z: 0 };
  /** Muffles the world while the listener hides in a bush. */
  private muffle!: BiquadFilterNode;

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const c = (this.ctx = new AC({ latencyHint: 'interactive' }));
      this.master = c.createGain();
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -12; comp.knee.value = 8; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.12;
      this.master.connect(comp).connect(c.destination);
      this.muffle = c.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000;
      this.muffle.connect(this.master);
      this.sfxBus = c.createGain(); this.sfxBus.gain.value = this.sfxVol; this.sfxBus.connect(this.muffle);
      this.musicBus = c.createGain(); this.musicBus.gain.value = this.musicVol * 0.45; this.musicBus.connect(this.master);
      // reverb: generated stereo impulse (soft, short room)
      const conv = c.createConvolver();
      const len = Math.floor(c.sampleRate * 1.1);
      const ir = c.createBuffer(2, len, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
      conv.buffer = ir;
      this.reverbSend = c.createGain(); this.reverbSend.gain.value = 0.16;
      this.reverbSend.connect(conv).connect(this.sfxBus);
      const nlen = c.sampleRate;
      this.noiseBuf = c.createBuffer(1, nlen, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < nlen; i++) d[i] = Math.random() * 2 - 1;
      if (this.wantTrack) this.music(this.wantTrack);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolumes(sfx: number, music: number) {
    this.sfxVol = sfx; this.musicVol = music;
    if (this.ctx) { this.sfxBus.gain.value = sfx; this.musicBus.gain.value = music * 0.45; }
  }
  suspend(on: boolean) { if (this.ctx) on ? this.ctx.suspend() : this.ctx.resume(); }
  setMuffled(on: boolean) { if (this.ctx) this.muffle.frequency.setTargetAtTime(on ? 1400 : 20000, this.ctx.currentTime, 0.08); }

  // ───────────────────────── synthesis primitives
  private env(g: GainNode, t: number, a: number, peak: number, dec: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }
  private osc(out: AudioNode, type: OscillatorType, f0: number, f1: number, t: number, dur: number, vol: number, attack = 0.003, filter?: number) {
    const c = this.ctx!;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(Math.max(20, f0), t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this.env(g, t, attack, vol, dur);
    if (filter) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; o.connect(f).connect(g); } else o.connect(g);
    g.connect(out);
    o.start(t); o.stop(t + attack + dur + 0.05);
  }
  private noise(out: AudioNode, t: number, dur: number, vol: number, type: BiquadFilterType, f0: number, f1 = f0, q = 1, attack = 0.002) {
    const c = this.ctx!;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain(); this.env(g, t, attack, vol, dur);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random() * 0.6); s.stop(t + attack + dur + 0.05);
  }
  /** Amplitude-modulated tone (whirs, wobbles). */
  private trem(out: AudioNode, type: OscillatorType, f0: number, f1: number, t: number, dur: number, vol: number, rate: number) {
    const c = this.ctx!;
    const o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain(), amp = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    lfo.frequency.value = rate; lg.gain.value = 0.5; amp.gain.value = 0.5;
    lfo.connect(lg).connect(amp.gain);
    this.env(g, t, 0.01, vol, dur);
    o.connect(amp).connect(g).connect(out);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  }

  /** Positional play: falls off with distance from the listener, panned left/right, reverb send. */
  play(name: Sfx, pos?: { x: number; z: number }, vol = 1, opts: PlayOpts = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const last = this.lastPlay.get(name) ?? 0;
    if (now - last < 0.022) return; // de-dupe same-frame bursts
    if (this.voices > 48) return;   // voice cap
    this.lastPlay.set(name, now);
    let out: AudioNode = this.sfxBus;
    let wet = 1;
    if (pos) {
      const dx = pos.x - this.listener.x, dz = pos.z - this.listener.z;
      const d = Math.hypot(dx, dz);
      const att = 1 / (1 + Math.max(0, d - 4) * 0.13);
      if (att < 0.05) return;
      vol *= att;
      wet = 1 + Math.min(1.5, d / 12); // far sounds are wetter
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-0.85, Math.min(0.85, dx / 13));
      p.connect(this.sfxBus);
      out = p;
    }
    const g = this.ctx.createGain(); g.gain.value = vol; g.connect(out);
    const send = this.ctx.createGain(); send.gain.value = wet; g.connect(send).connect(this.reverbSend);
    const pitch = (opts.pitch ?? 1) * (opts.noJitter ? 1 : 1 + (Math.random() - 0.5) * 0.09);
    this.voices++;
    setTimeout(() => { this.voices--; }, 700);
    this.recipe(name, g, now, pitch);
  }

  private recipe(name: Sfx, o: AudioNode, t: number, p: number) {
    switch (name) {
      // ── weapons (fire)
      case 'gatling':
        this.osc(o, 'square', 2600 * p, 1300 * p, t, 0.012, 0.12);
        this.osc(o, 'square', 300 * p, 150 * p, t, 0.06, 0.2, 0.002, 2200);
        this.noise(o, t, 0.035, 0.22, 'highpass', 2800);
        break;
      case 'gatlingSuper':
        this.osc(o, 'square', 2200 * p, 1100 * p, t, 0.012, 0.12);
        this.osc(o, 'sawtooth', 240 * p, 90 * p, t, 0.08, 0.22, 0.002, 1800);
        this.osc(o, 'sine', 120, 45, t, 0.09, 0.35);
        this.noise(o, t, 0.05, 0.25, 'bandpass', 3200, 1500, 1.5);
        break;
      case 'shotgun':
        this.noise(o, t, 0.035, 0.6, 'bandpass', 3400, 2400, 0.9);           // crack
        this.noise(o, t + 0.004, 0.3, 0.55, 'lowpass', 2200, 180);           // boom
        this.osc(o, 'sine', 120 * p, 38, t, 0.22, 0.75);                      // sub punch
        this.osc(o, 'square', 900, 1100, t + 0.32, 0.018, 0.09);              // pump "chk"
        this.osc(o, 'square', 650, 520, t + 0.4, 0.024, 0.1);                 // "chk"
        this.noise(o, t + 0.32, 0.03, 0.12, 'bandpass', 2400, 2400, 3);
        this.noise(o, t + 0.4, 0.04, 0.14, 'bandpass', 1600, 1600, 3);
        break;
      case 'throw':
        this.noise(o, t, 0.2, 0.28, 'bandpass', 380 * p, 2600 * p, 2.5, 0.03); // whoosh
        this.osc(o, 'sine', 700 * p, 1400 * p, t, 0.05, 0.14);                 // pin "plink"
        this.osc(o, 'triangle', 1800 * p, 2100 * p, t + 0.03, 0.04, 0.06);
        break;
      case 'bow':
        this.osc(o, 'triangle', 210 * p, 150 * p, t, 0.16, 0.32);              // string twang
        this.osc(o, 'sawtooth', 420 * p, 300 * p, t, 0.08, 0.08, 0.002, 2500);
        this.noise(o, t, 0.09, 0.3, 'highpass', 2500, 7000, 1);                // "thwip"
        this.osc(o, 'sine', 2600 * p, 3400 * p, t, 0.05, 0.06);
        break;
      case 'boomerang':
        this.trem(o, 'sawtooth', 260 * p, 340 * p, t, 0.32, 0.1, 28);           // whir
        this.noise(o, t, 0.28, 0.22, 'bandpass', 900 * p, 1800 * p, 5);
        break;
      case 'bubble':
        for (let i = 0; i < 3; i++) {
          this.osc(o, 'sine', (320 + i * 60) * p, (980 + i * 120) * p, t + i * 0.035, 0.08, 0.26);
          this.osc(o, 'sine', (640 + i * 80) * p, (1500 + i * 100) * p, t + i * 0.035 + 0.01, 0.05, 0.08);
        }
        break;
      // ── impacts (played at the target)
      case 'impBullet':
        this.osc(o, 'sine', 1100 * p, 320 * p, t, 0.04, 0.25);
        this.noise(o, t, 0.03, 0.22, 'highpass', 3500);
        break;
      case 'impPellet':
        this.osc(o, 'sine', 230 * p, 80, t, 0.09, 0.45);
        this.noise(o, t, 0.07, 0.3, 'lowpass', 2400, 600);
        break;
      case 'impArrow':
        this.osc(o, 'triangle', 380 * p, 120 * p, t, 0.08, 0.4);
        this.noise(o, t, 0.02, 0.35, 'bandpass', 4000, 4000, 2);
        this.osc(o, 'sine', 90, 50, t, 0.12, 0.35);
        break;
      case 'impBoomerang':
        this.osc(o, 'square', 460 * p, 160 * p, t, 0.07, 0.2, 0.002, 2400);
        this.noise(o, t, 0.06, 0.32, 'bandpass', 1800, 900, 2);
        break;
      case 'impBubble':
        this.osc(o, 'sine', 1400 * p, 380 * p, t, 0.05, 0.3);
        this.noise(o, t, 0.025, 0.25, 'highpass', 5000);
        break;
      case 'impExplosive':
        this.osc(o, 'sine', 160 * p, 50, t, 0.14, 0.4);
        this.noise(o, t, 0.1, 0.25, 'lowpass', 1800, 300);
        break;
      // ── feedback
      case 'hitConfirm':
        this.osc(o, 'sine', 1320 * p, 1320 * p, t, 0.07, 0.2, 0.001);
        this.osc(o, 'triangle', 2640 * p, 2640 * p, t, 0.03, 0.06, 0.001);
        break;
      case 'crit':
        this.osc(o, 'sine', 2600 * p, 2550 * p, t, 0.28, 0.16, 0.001);
        this.osc(o, 'sine', 3900 * p, 3850 * p, t, 0.22, 0.09, 0.001);
        this.osc(o, 'sine', 160, 60, t, 0.15, 0.35);
        break;
      case 'shieldHit':
        this.osc(o, 'square', 720 * p, 700 * p, t, 0.12, 0.09, 0.001, 3000);
        this.osc(o, 'square', 1085 * p, 1050 * p, t, 0.1, 0.07, 0.001, 3000);
        break;
      case 'hitMe':
        this.osc(o, 'sine', 210 * p, 65, t, 0.18, 0.6);
        this.noise(o, t, 0.1, 0.32, 'lowpass', 1500, 300);
        this.osc(o, 'triangle', 520 * p, 300 * p, t + 0.01, 0.09, 0.08);
        break;
      case 'explode':
        this.noise(o, t, 0.05, 0.6, 'bandpass', 2800, 1800, 0.8);
        this.noise(o, t + 0.01, 0.7, 0.75, 'lowpass', 3200 * p, 110);
        this.osc(o, 'sine', 95 * p, 32, t, 0.6, 0.8);
        for (let i = 0; i < 5; i++) this.noise(o, t + 0.12 + Math.random() * 0.35, 0.03, 0.08, 'highpass', 3000 + Math.random() * 3000);
        break;
      case 'bigExplode':
        this.noise(o, t, 0.06, 0.8, 'bandpass', 2400, 1400, 0.7);
        this.noise(o, t + 0.01, 1.1, 0.9, 'lowpass', 3600 * p, 80);
        this.osc(o, 'sine', 80 * p, 25, t, 0.9, 1.0);
        this.osc(o, 'triangle', 160, 40, t, 0.5, 0.3);
        for (let i = 0; i < 9; i++) this.noise(o, t + 0.1 + Math.random() * 0.6, 0.03, 0.09, 'highpass', 2500 + Math.random() * 4000);
        break;
      case 'kill':
        this.osc(o, 'sine', 160, 50, t, 0.25, 0.6);
        [76, 79, 83, 88].forEach((n, i) => this.osc(o, 'triangle', NOTE(n), NOTE(n), t + 0.04 + i * 0.055, 0.2, 0.22));
        this.osc(o, 'sine', NOTE(100), NOTE(100), t + 0.24, 0.35, 0.08);
        break;
      case 'killMe':
        this.osc(o, 'sine', 520 * p, 1600 * p, t, 0.08, 0.3);
        this.noise(o, t, 0.12, 0.2, 'highpass', 3000);
        break;
      case 'streak':
        [76, 79, 83, 88, 91, 95].forEach((n, i) => this.osc(o, 'square', NOTE(n), NOTE(n), t + i * 0.045, 0.12, 0.09, 0.002, 4000));
        break;
      case 'superReady':
        [79, 83, 86, 91].forEach((n, i) => this.osc(o, 'sine', NOTE(n), NOTE(n), t + i * 0.07, 0.3, 0.2));
        this.osc(o, 'triangle', NOTE(103), NOTE(103), t + 0.28, 0.4, 0.06);
        break;
      // ── supers (cast)
      case 'superGatling':
        this.osc(o, 'sawtooth', 70, 640, t, 0.35, 0.14, 0.01, 2500);   // spin-up
        this.noise(o, t, 0.4, 0.2, 'bandpass', 400, 3000, 2, 0.05);
        break;
      case 'superBigbang':
        this.noise(o, t, 0.05, 0.9, 'bandpass', 3000, 2000, 0.7);
        this.noise(o, t, 0.6, 0.9, 'lowpass', 3000, 120);
        this.osc(o, 'sine', 110, 28, t, 0.55, 1.0);
        this.osc(o, 'square', 1200, 1400, t + 0.45, 0.02, 0.1);
        break;
      case 'superMegabomb':
        this.osc(o, 'sine', 2200, 500, t + 0.25, 0.7, 0.12);            // falling whistle
        this.noise(o, t, 0.3, 0.3, 'bandpass', 300, 2500, 2, 0.05);
        break;
      case 'superMeteor':
        this.osc(o, 'sawtooth', 300, 2600, t, 0.34, 0.08, 0.02, 4000);  // charge whine
        this.osc(o, 'sine', 600, 3000, t, 0.34, 0.12, 0.02);
        this.noise(o, t + 0.34, 0.05, 0.8, 'bandpass', 3200, 2000, 0.7); // crack
        this.osc(o, 'sine', 140, 40, t + 0.34, 0.4, 0.8);
        this.noise(o, t + 0.36, 0.5, 0.4, 'highpass', 6000, 1500);
        break;
      case 'superTornado':
        this.trem(o, 'sawtooth', 180, 420, t, 1.4, 0.08, 14);
        this.noise(o, t, 1.6, 0.3, 'bandpass', 500, 1600, 3, 0.2);
        break;
      case 'superPrison':
        this.trem(o, 'sine', 150, 520, t, 0.45, 0.25, 18);              // inflate wobble
        this.osc(o, 'sine', 400, 1300, t + 0.42, 0.12, 0.3);
        break;
      // ── world / ui
      case 'pickup': this.osc(o, 'sine', NOTE(84), NOTE(84), t, 0.08, 0.25); this.osc(o, 'sine', NOTE(91), NOTE(91), t + 0.07, 0.22, 0.25); this.osc(o, 'triangle', NOTE(96), NOTE(96), t + 0.13, 0.2, 0.08); break;
      case 'heal': [72, 76, 79].forEach((n, i) => this.osc(o, 'sine', NOTE(n), NOTE(n + 2), t + i * 0.08, 0.3, 0.14)); break;
      case 'click': this.osc(o, 'sine', 1400 * p, 900 * p, t, 0.04, 0.25); this.noise(o, t, 0.01, 0.06, 'highpass', 5000); break;
      case 'tick': this.osc(o, 'sine', 2000 * p, 1800 * p, t, 0.02, 0.08); break;
      case 'pop': this.osc(o, 'sine', 500 * p, 1500 * p, t, 0.06, 0.3); break;
      case 'whoosh': this.noise(o, t, 0.22, 0.25, 'bandpass', 500 * p, 2400 * p, 2, 0.04); break;
      case 'reload': this.osc(o, 'square', 1800, 1700, t, 0.015, 0.05, 0.001, 4000); this.osc(o, 'square', 1200, 1100, t + 0.05, 0.02, 0.06, 0.001, 3500); break;
      case 'dry': this.osc(o, 'square', 300, 250, t, 0.03, 0.08, 0.001, 1500); break;
      case 'rustle': this.noise(o, t, 0.22, 0.22, 'bandpass', 3500, 2000, 1.2); this.noise(o, t + 0.07, 0.15, 0.14, 'bandpass', 4200, 2500, 1.2); break;
      case 'rock':
        this.noise(o, t, 0.05, 0.5, 'bandpass', 2000, 1200, 1);
        this.noise(o, t, 0.45, 0.55, 'lowpass', 1600, 140);
        this.osc(o, 'triangle', 150 * p, 55, t, 0.3, 0.45);
        for (let i = 0; i < 6; i++) this.noise(o, t + 0.08 + Math.random() * 0.4, 0.025, 0.1, 'bandpass', 1500 + Math.random() * 2500, 1000, 3);
        break;
      case 'crate':
        this.noise(o, t, 0.25, 0.45, 'bandpass', 900, 300, 2);
        this.osc(o, 'square', 210 * p, 90, t, 0.14, 0.16, 0.002, 1500);
        for (let i = 0; i < 4; i++) this.osc(o, 'triangle', 500 + Math.random() * 400, 300, t + 0.1 + Math.random() * 0.25, 0.04, 0.06);
        break;
      case 'step': this.noise(o, t, 0.05, 0.07, 'lowpass', 500 * p, 250); this.osc(o, 'sine', 120 * p, 80, t, 0.04, 0.05); break;
      case 'land': this.osc(o, 'sine', 140, 45, t, 0.2, 0.55); this.noise(o, t, 0.15, 0.3, 'lowpass', 1200, 200); break;
      case 'count': this.osc(o, 'sine', NOTE(76), NOTE(76), t, 0.15, 0.3); this.osc(o, 'triangle', NOTE(88), NOTE(88), t, 0.08, 0.06); break;
      case 'go': this.osc(o, 'square', NOTE(84), NOTE(84), t, 0.3, 0.16, 0.002, 4000); this.osc(o, 'sine', NOTE(88), NOTE(88), t, 0.35, 0.2); this.osc(o, 'sine', 100, 40, t, 0.3, 0.5); break;
      case 'retire': [79, 74, 71, 67].forEach((n, i) => this.osc(o, 'triangle', NOTE(n), NOTE(n - 1), t + i * 0.12, 0.2, 0.22)); break;
      case 'victory': [72, 76, 79, 84, 79, 84, 88].forEach((n, i) => this.osc(o, i % 2 ? 'square' : 'triangle', NOTE(n), NOTE(n), t + i * 0.11, 0.24, 0.15, 0.002, 4500)); break;
      case 'event': [84, 88, 84, 91].forEach((n, i) => this.osc(o, 'sine', NOTE(n), NOTE(n), t + i * 0.1, 0.2, 0.18)); break;
      case 'dash': this.noise(o, t, 0.22, 0.32, 'bandpass', 900, 4200, 2, 0.01); this.osc(o, 'sine', 300, 700, t, 0.1, 0.08); break;
      case 'shield': this.osc(o, 'sine', 300, 600, t, 0.3, 0.2); this.osc(o, 'triangle', 900, 1200, t, 0.25, 0.08); this.trem(o, 'sine', 1200, 1250, t, 0.4, 0.05, 20); break;
    }
  }

  // ───────────────────────── music
  music(track: 'lobby' | 'battle' | null) {
    this.wantTrack = track;
    if (!this.ctx || this.track === track) return;
    this.track = track;
    this.step = 0;
    this.nextNote = this.ctx.currentTime + 0.1;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (track) this.timer = window.setInterval(() => this.schedule(), 25);
  }

  private schedule() {
    const c = this.ctx!;
    const battle = this.track === 'battle';
    const bpm = battle ? 132 : 96;
    const s16 = 60 / bpm / 4;
    while (this.nextNote < c.currentTime + 0.15) {
      this.playStep(this.step, this.nextNote, battle);
      this.nextNote += s16;
      this.step = (this.step + 1) % 128;
    }
  }

  private playStep(step: number, t: number, battle: boolean) {
    const o = this.musicBus;
    const bar = Math.floor(step / 16) % 8, s = step % 16;
    const roots = [48, 43, 45, 41, 48, 43, 45, 41];
    const chords = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]];
    const root = roots[bar];
    const chord = chords[bar % 4];
    if (battle) {
      if (s % 4 === 0) this.osc(o, 'sine', 150, 45, t, 0.18, 0.55);
      if (s % 8 === 4) { this.noise(o, t, 0.12, 0.22, 'bandpass', 1800, 1200, 0.8); this.osc(o, 'triangle', 220, 160, t, 0.06, 0.1); }
      if (s % 2 === 1) this.noise(o, t, 0.03, 0.06, 'highpass', 7000);
      if (s % 2 === 0) this.osc(o, 'triangle', NOTE(root + (s % 8 === 6 ? 12 : 0)), NOTE(root), t, 0.14, 0.28);
      const mel = [0, -1, 7, -1, 4, -1, 9, 7, -1, 4, -1, 2, 0, -1, 4, -1];
      const m2 = [12, -1, 9, 7, -1, 4, -1, 7, 9, -1, 12, -1, 14, 12, -1, 9];
      const line = bar % 2 ? m2 : mel;
      if (line[s] >= 0) this.osc(o, 'square', NOTE(chord[0] + 12 + line[s]), NOTE(chord[0] + 12 + line[s]), t, 0.12, 0.045, 0.003, 3500);
      if (s === 0 || s === 8) chord.forEach((n) => this.osc(o, 'sawtooth', NOTE(n), NOTE(n), t, 0.35, 0.016, 0.04, 2000));
    } else {
      if (s % 4 === 0) this.osc(o, 'triangle', NOTE(root), NOTE(root), t, 0.4, 0.22);
      const arp = [0, 1, 2, 1];
      if (s % 2 === 0) this.osc(o, 'sine', NOTE(chord[arp[(s / 2) % 4]] + 12), NOTE(chord[arp[(s / 2) % 4]] + 12), t, 0.3, 0.07);
      if (s === 0) chord.forEach((n) => this.osc(o, 'triangle', NOTE(n), NOTE(n), t, 1.2, 0.03, 0.15));
      if (s % 8 === 6 && bar % 2) this.osc(o, 'sine', NOTE(chord[2] + 24), NOTE(chord[2] + 24), t, 0.2, 0.04);
    }
  }
}

export const audio = new AudioEngine();
