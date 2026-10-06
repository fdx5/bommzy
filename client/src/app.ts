import { CHARACTERS, CHAR_BY_ID, weaponOf, superOf, gadgetOf, radarStats, trophyDelta, xpFor, levelXp, MAPS, MAP_BY_ID, buildMap, randomMapId, type CharacterId, type Fighter, type MapId } from '@pastel/shared';
import { Stage } from './render/stage';
import { LobbyScene, renderPortraits } from './render/lobby';
import { guessQuality, type QualityLevel } from './render/quality';
import { Controls } from './input/controls';
import { audio } from './audio/audio';
import { Match, type MatchResult } from './game/match';
import { loadProfile, saveProfile, totalTrophies, addXp, recordMatch, favoriteCharacter, type Profile } from './game/profile';
import { t, setLang, getLang } from './ui/i18n';
import { escapeHtml, drawMapPreview } from './ui/hud';

type Screen = 'title' | 'lobby' | 'chars' | 'mm' | 'match' | 'retire' | 'results';

const h = (html: string) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild as HTMLElement; };

export class App {
  private stage: Stage;
  private lobby = new LobbyScene();
  private controls: Controls;
  private profile: Profile;
  private portraits = {} as Record<CharacterId, string>;
  private screen: Screen = 'title';
  private screenEl: HTMLElement | null = null;
  private match: Match | null = null;
  private last = performance.now();
  private hidden = false;
  private lowPower = false;
  private frameSkip = false;
  private rotateEl: HTMLElement;
  private previewChar: CharacterId;

  constructor(private canvas: HTMLCanvasElement, private ui: HTMLElement) {
    this.profile = loadProfile();
    setLang(this.profile.settings.lang);
    const s = this.profile.settings;
    const level: QualityLevel = s.quality === 'auto' ? this.profile.autoQuality ?? guessQuality() : s.quality;
    this.stage = new Stage(canvas, level);
    this.controls = new Controls(canvas, this.stage.camera, ui, {
      stickSize: s.stickSize, stickOpacity: s.stickOpacity, leftHanded: s.leftHanded, aimSensitivity: s.aimSensitivity, vibration: s.vibration,
    });
    this.controls.setVisible(false);
    this.controls.onPause = () => { if (this.match && this.screen === 'match') this.openPause(); };
    this.previewChar = this.profile.selected;
    this.applySettings();
    this.rotateEl = h(`<div class="rotate"><div class="phone"></div><div class="stroke" style="font-size:1.8em">${t('rotate')}</div><div>${t('rotateSub')}</div></div>`);
    document.body.appendChild(this.rotateEl);

    this.stage.setView(this.lobby.scene, this.lobby.camera);
    this.lobby.setMode('title');
    this.bindLobbyPointer();
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden;
      audio.suspend(this.hidden);
      if (this.hidden && this.match && this.screen === 'match') this.openPause();
    });
    (navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> }).getBattery?.().then((b) => { this.lowPower = !b.charging && b.level < 0.2; }).catch(() => {});

    this.showTitle();
    requestAnimationFrame(() => {
      try { this.portraits = renderPortraits(); } catch { /* portraits are cosmetic */ }
    });
    this.loop();
  }

  private applySettings() {
    const s = this.profile.settings;
    document.documentElement.style.setProperty('--ui-scale', String(s.uiScale));
    document.documentElement.classList.toggle('colorblind', s.colorblind);
    audio.setVolumes(s.sfx, s.music);
    Object.assign(this.controls.settings, { stickSize: s.stickSize, stickOpacity: s.stickOpacity, leftHanded: s.leftHanded, aimSensitivity: s.aimSensitivity, vibration: s.vibration });
    this.controls.applySettings();
    this.match?.hud.showStats(s.showStats);
  }

  private save() { saveProfile(this.profile); }

  private loop = () => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    let dt = (now - this.last) / 1000;
    if (this.hidden) { this.last = now; return; }
    // low-power: cap ~30fps
    if (this.lowPower) { this.frameSkip = !this.frameSkip; if (this.frameSkip) return; }
    this.last = now;
    dt = Math.min(dt, 0.1);
    if (this.match) this.match.update(dt);
    else this.lobby.update(dt);
    this.stage.render(dt);
  };

  // ───────────────────────────── screen plumbing
  private setScreen(name: Screen, el: HTMLElement | null) {
    const old = this.screenEl;
    if (old) { old.classList.add('fade-out'); setTimeout(() => old.remove(), 220); }
    this.screen = name;
    this.screenEl = el;
    if (el) { el.classList.add('screen'); this.ui.appendChild(el); }
    this.rotateEl.classList.toggle('armed', name === 'match' || name === 'retire');
    el?.querySelectorAll('.btn').forEach((b) => b.addEventListener('pointerdown', () => audio.play('click')));
  }

  private modal(inner: string, onClose?: () => void) {
    const wrap = h(`<div class="modal-wrap"><div class="modal panel">${inner}<button class="btn white icon-btn x" aria-label="close">✕</button></div></div>`);
    const close = () => { wrap.remove(); onClose?.(); };
    wrap.querySelector('.x')!.addEventListener('click', () => { audio.play('click'); close(); });
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
    wrap.querySelectorAll('.btn').forEach((b) => b.addEventListener('pointerdown', () => audio.play('click')));
    this.ui.appendChild(wrap);
    return { el: wrap, close };
  }

  private bindLobbyPointer() {
    let down: { x: number; y: number; t: number } | null = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.match || (this.screen !== 'lobby' && this.screen !== 'chars')) return;
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.lobby.dragStart(e.clientX);
    });
    window.addEventListener('pointermove', (e) => { if (down) this.lobby.dragMove(e.clientX); });
    window.addEventListener('pointerup', (e) => {
      if (!down) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8 && performance.now() - down.t < 350) { this.lobby.poke(); audio.play('pop'); }
      down = null; this.lobby.dragEnd();
    });
  }

  private skinPalette(id: CharacterId) {
    const def = CHAR_BY_ID[id];
    const sk = this.profile.skins[id];
    return (def.skins.find((s) => s.id === sk) ?? def.skins[0]).palette;
  }

  // ───────────────────────────── title
  private showTitle() {
    const el = h(`<div class="title-screen">
      <div class="logo">${['#FFC8DD', '#A8E6CF', '#FFF5BA', '#B5DEFF', '#C3B1E1', '#FFAAA5'].map((c, i) => `<span style="color:${c};animation-delay:${i * 0.12}s">${'BOOMZY'[i]}</span>`).join('')}<span class="l2" style="color:#FFF5BA">붐지</span></div>
      <div class="tap stroke">${t('tapToStart')}</div>
      <div class="chip" style="font-size:.85em;opacity:.85">v0.2 · 8인 캐주얼 3D 슈팅</div>
    </div>`);
    el.addEventListener('pointerup', () => {
      audio.unlock();
      audio.play('go');
      audio.music('lobby');
      if (this.controls.touchMode) {
        document.documentElement.requestFullscreen?.().then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape')).catch(() => {});
      }
      this.showLobby();
      if (!this.profile.tutorialDone && this.profile.games === 0) setTimeout(() => this.askTutorial(), 500);
    }, { once: true });
    this.setScreen('title', el);
  }

  private askTutorial() {
    const m = this.modal(`<h2>${t('tutStart')}</h2><p style="text-align:center">${t('tutStartSub')}</p>
      <div class="actions"><button class="btn mint big" data-a="yes">${t('yes')}</button><button class="btn white" data-a="no">${t('later')}</button></div>`);
    m.el.querySelector('[data-a=yes]')!.addEventListener('click', () => { m.close(); this.startMatch('tutorial'); });
    m.el.querySelector('[data-a=no]')!.addEventListener('click', () => { this.profile.tutorialDone = true; this.save(); m.close(); });
  }

  // ───────────────────────────── lobby
  private showLobby() {
    this.stage.setView(this.lobby.scene, this.lobby.camera);
    this.lobby.resize();
    this.lobby.setMode('lobby');
    const id = this.profile.selected;
    this.lobby.setHero(id, this.skinPalette(id));
    const def = CHAR_BY_ID[id];
    const p = this.profile;
    const xpNeed = levelXp(p.level);
    const el = h(`<div class="lobby">
      <div class="topbar">
        <div class="panel profile-card">
          <div class="avatar">${this.portraits[id] ? `<img src="${this.portraits[id]}" style="width:120%;margin-top:10%">` : '🐻'}</div>
          <div><input class="nick-input" maxlength="12" value="${escapeHtml(p.nickname)}" aria-label="${t('nickname')}">
            <div class="lvl">${t('level')}${p.level} <span class="xpbar" style="display:inline-block;vertical-align:middle"><i style="width:${(p.xp / xpNeed) * 100}%"></i></span></div></div>
        </div>
        <span class="chip"><span class="trophy">🏆</span> ${totalTrophies(p)}</span>
        <span class="chip">⭐ ${p.totalScore.toLocaleString()}</span>
        <span class="chip">👑 ${p.wins}</span>
      </div>
      <div class="side-menu">
        <button class="btn lav" data-a="chars">🧸 ${t('characters')}</button>
        <button class="btn sky" data-a="records">🏅 ${t('records')}</button>
        <button class="btn pink" data-a="tutorial">📖 ${t('tutorial')}</button>
        <button class="btn white" data-a="settings">⚙️ ${t('settings')}</button>
      </div>
      <div class="showcase-label">
        <h2 class="stroke">${def.displayName}</h2>
        <p class="chip">${def.role} · <span class="trophy">🏆</span>${p.trophies[id]}</p>
      </div>
      <div class="play-area">
        <button class="btn white map-btn" data-a="map" aria-label="${t('mapSelect')}"><canvas class="map-thumb" width="96" height="96"></canvas><span><small>${t('map')}</small><b>${this.mapLabel()}</b></span></button>
        <span class="chip mode-chip">🎮 ${t('mode')}</span>
        <button class="btn coral play-btn stroke" data-a="play">${t('play')}</button>
      </div>
    </div>`);
    const nick = el.querySelector('.nick-input') as HTMLInputElement;
    nick.addEventListener('change', () => { const v = nick.value.trim().slice(0, 12); if (v) { p.nickname = v; this.save(); } else nick.value = p.nickname; });
    nick.addEventListener('keydown', (e) => { if (e.key === 'Enter') nick.blur(); });
    el.querySelector('[data-a=chars]')!.addEventListener('click', () => this.showCharSelect());
    el.querySelector('[data-a=records]')!.addEventListener('click', () => this.openRecords());
    el.querySelector('[data-a=settings]')!.addEventListener('click', () => this.openSettings());
    el.querySelector('[data-a=tutorial]')!.addEventListener('click', () => this.startMatch('tutorial'));
    el.querySelector('[data-a=play]')!.addEventListener('click', () => this.showMatchmaking());
    el.querySelector('[data-a=map]')!.addEventListener('click', () => this.openMapSelect());
    this.paintThumb(el.querySelector('.map-thumb') as HTMLCanvasElement, p.mapId);
    this.setScreen('lobby', el);
  }

  // ───────────────────────────── character select
  private showCharSelect() {
    this.previewChar = this.profile.selected;
    const el = h(`<div class="charsel">
      <div class="header"><button class="btn white icon-btn" data-a="back">◀</button><h1 class="stroke">${t('characters')}</h1></div>
      <div class="card-grid"></div>
      <div class="detail panel"></div>
    </div>`);
    const grid = el.querySelector('.card-grid')!;
    const renderCards = () => {
      grid.innerHTML = CHARACTERS.map((c) => `<div class="ccard ${c.id === this.previewChar ? 'sel' : ''}" data-id="${c.id}" style="--c:${c.colorPalette[0]}">
        <span class="tr chip"><span class="trophy">🏆</span>${this.profile.trophies[c.id]}</span>
        ${this.portraits[c.id] ? `<img src="${this.portraits[c.id]}" alt="">` : '<div style="height:78%"></div>'}
        <div class="nm stroke-thin">${c.displayName}</div></div>`).join('');
      grid.querySelectorAll<HTMLElement>('.ccard').forEach((card) => card.addEventListener('click', () => {
        audio.play('pop');
        this.previewChar = card.dataset.id as CharacterId;
        this.lobby.setHero(this.previewChar, this.skinPalette(this.previewChar));
        renderCards(); renderDetail();
      }));
    };
    const renderDetail = () => {
      const c = CHAR_BY_ID[this.previewChar], w = weaponOf(c), s = superOf(c), g = gadgetOf(c), r = radarStats(c);
      const tro = this.profile.trophies[c.id];
      const selSkin = this.profile.skins[c.id] ?? 'default';
      const isSel = this.profile.selected === c.id;
      el.querySelector('.detail')!.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5em">
          <div><h2 class="stroke">${c.displayName}</h2><div class="role">${c.role} · ${c.concept}</div></div>
        </div>
        ${radar(r, c.colorPalette[0])}
        <div class="stats-row"><span class="chip">❤️ ${t('hp')} ${c.hp}</span><span class="chip">👟 ${t('speed')} ${c.speedLabel}</span></div>
        <div class="ability"><b>🔫 ${w.name}</b><small>${w.desc} · ${w.damage}${w.pelletCount > 1 ? '×' + w.pelletCount : ''}${w.burstCount > 1 ? '×' + w.burstCount : ''}</small></div>
        <div class="ability" style="background:#FFFBE6"><b>⭐ ${s.name}</b><small>${s.desc}</small></div>
        <div class="ability" style="background:#EFFFF7"><b>✨ ${g.name}</b><small>${g.desc} (×3)</small></div>
        <div><b>${t('skins')}</b><div class="skins">${c.skins.map((sk) => `<div class="skin ${sk.id === selSkin ? 'sel' : ''} ${tro < sk.unlockTrophies ? 'locked' : ''}" data-skin="${sk.id}" title="${sk.name}${tro < sk.unlockTrophies ? ' · ' + t('locked', { n: sk.unlockTrophies }) : ''}" style="background:linear-gradient(135deg, ${sk.palette[0]} 50%, ${sk.palette[1]} 50%)"></div>`).join('')}</div></div>
        <button class="btn ${isSel ? 'white' : 'mint'} big" data-a="pick" ${isSel ? 'disabled' : ''}>${isSel ? t('selected') : t('select')}</button>`;
      el.querySelectorAll<HTMLElement>('.skin').forEach((sk) => sk.addEventListener('click', () => {
        const def = c.skins.find((x) => x.id === sk.dataset.skin)!;
        if (tro < def.unlockTrophies) { audio.play('dry'); return; }
        audio.play('pop');
        this.profile.skins[c.id] = def.id; this.save();
        this.lobby.setHero(c.id, def.palette);
        renderDetail();
      }));
      el.querySelector('[data-a=pick]')?.addEventListener('click', () => {
        audio.play('superReady');
        this.profile.selected = c.id; this.save();
        this.lobby.poke();
        renderDetail();
      });
    };
    renderCards(); renderDetail();
    el.querySelector('[data-a=back]')!.addEventListener('click', () => { this.lobby.setHero(this.profile.selected, this.skinPalette(this.profile.selected)); this.showLobby(); });
    this.setScreen('chars', el);
  }

  // ───────────────────────────── matchmaking (bots fill the lobby)
  private mapLabel(id: MapId | 'random' = this.profile.mapId) {
    if (id === 'random') return '🎲 ' + t('randomMap');
    const m = MAP_BY_ID[id];
    return `${m.emoji} ${getLang() === 'ko' ? m.name : m.nameEn}`;
  }

  private paintThumb(c: HTMLCanvasElement, id: MapId | 'random') {
    const g = c.getContext('2d')!;
    if (id === 'random') {
      g.fillStyle = '#F3ECFF'; g.fillRect(0, 0, c.width, c.height);
      g.font = `${c.width * 0.55}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('🎲', c.width / 2, c.height / 2 + 2);
      return;
    }
    drawMapPreview(g, buildMap(id), c.width);
  }

  private openMapSelect() {
    const cur = this.profile.mapId;
    const ko = getLang() === 'ko';
    const cards = [...MAPS.map((m) => ({ id: m.id as MapId | 'random', name: `${m.emoji} ${ko ? m.name : m.nameEn}`, desc: ko ? m.desc : m.descEn })),
      { id: 'random' as const, name: '🎲 ' + t('randomMap'), desc: t('randomMapDesc') }];
    const m = this.modal(`<h2>🗺️ ${t('mapSelect')}</h2><div class="map-grid">${cards.map((c) => `
      <button class="map-card ${c.id === cur ? 'sel' : ''}" data-map="${c.id}">
        <canvas width="180" height="180"></canvas>
        <b>${c.name}</b><small>${c.desc}</small>
      </button>`).join('')}</div>`);
    m.el.querySelector('.modal')!.classList.add('wide');
    m.el.querySelectorAll<HTMLElement>('.map-card').forEach((b) => {
      this.paintThumb(b.querySelector('canvas')!, b.dataset.map as MapId | 'random');
      b.addEventListener('click', () => {
        audio.play('pop');
        this.profile.mapId = b.dataset.map as MapId | 'random';
        this.save();
        m.close();
        this.showLobby();
      });
    });
  }

  private showMatchmaking() {
    const mapId: MapId = this.profile.mapId === 'random' ? randomMapId() : this.profile.mapId;
    const el = h(`<div class="mm"><div class="box panel">
      <h2 class="stroke" style="margin:0;font-size:1.8em"><span class="dots">${t('searching').replace('…', '')}</span></h2>
      <div class="chip" style="margin-top:.4em">🎮 ${t('mode')} · <b class="cnt">1</b>/8</div>
      <div class="chip" style="margin:.4em 0 0 .3em">🗺️ ${this.mapLabel(mapId)}</div>
      <div class="slots">${Array.from({ length: 8 }, (_, i) => `<div class="slot ${i === 0 ? 'in' : ''}">${i === 0 && this.portraits[this.profile.selected] ? `<img src="${this.portraits[this.profile.selected]}">` : '❔'}</div>`).join('')}</div>
      <div style="color:var(--ink-soft);font-size:.9em;margin-bottom:.8em">🤖 ${t('fillingBots')}</div>
      <button class="btn white" data-a="cancel">${t('cancel')}</button></div></div>`);
    let n = 1, cancelled = false;
    const slots = el.querySelectorAll('.slot');
    const tick = () => {
      if (cancelled) return;
      if (n >= 8) { setTimeout(() => !cancelled && this.startMatch('ffa', mapId), 450); return; }
      const c = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
      slots[n].classList.add('in');
      slots[n].innerHTML = this.portraits[c.id] ? `<img src="${this.portraits[c.id]}">` : '🙂';
      n++;
      (el.querySelector('.cnt') as HTMLElement).textContent = String(n);
      audio.play('pop', undefined, 0.6);
      setTimeout(tick, 180 + Math.random() * 320);
    };
    setTimeout(tick, 500);
    el.querySelector('[data-a=cancel]')!.addEventListener('click', () => { cancelled = true; this.showLobby(); });
    this.setScreen('mm', el);
  }

  // ───────────────────────────── match
  private startMatch(mode: 'ffa' | 'tutorial', mapId: MapId = 'meadow') {
    this.setScreen('match', null);
    const p = this.profile;
    const tro = p.trophies[p.selected];
    const difficulty = (mode === 'tutorial' ? 0 : tro < 30 ? 0 : tro < 120 ? 1 : 2) as 0 | 1 | 2;
    this.match?.dispose();
    this.match = new Match(this.stage, this.controls, this.ui, this.portraits, p, {
      mode, charId: p.selected, skin: p.skins[p.selected] ?? 'default', nickname: p.nickname, difficulty, mapId,
    });
    this.match.hud.onPause = () => this.openPause();
    this.match.onRetire = (killer, place) => this.showRetire(killer, place);
    this.match.onEnd = (r) => this.showResults(r);
    this.match.onTutorialDone = () => { p.tutorialDone = true; this.save(); this.exitMatch(); this.showMatchmaking(); };
    this.match.onQualityProbe = (level) => {
      if (p.settings.quality !== 'auto') return;
      p.autoQuality = level; this.save();
      this.stage.setQuality(level);
    };
  }

  private exitMatch() {
    this.match?.dispose();
    this.match = null;
    this.stage.setView(this.lobby.scene, this.lobby.camera);
    audio.music('lobby');
  }

  private openPause() {
    if (!this.match || this.ui.querySelector('.pause-modal')) return;
    this.match.setPaused(true);
    const m = this.modal(`<div class="pause-modal"><h2>${t('pause')}</h2>
      <div class="actions" style="flex-direction:column;align-items:stretch">
        <button class="btn mint big" data-a="resume">▶ ${t('resume')}</button>
        <button class="btn white" data-a="settings">⚙️ ${t('settings')}</button>
        <button class="btn coral" data-a="quit">🚪 ${t('quit')}</button></div></div>`, () => this.match?.setPaused(false));
    m.el.querySelector('[data-a=resume]')!.addEventListener('click', () => m.close());
    m.el.querySelector('[data-a=settings]')!.addEventListener('click', () => this.openSettings());
    m.el.querySelector('[data-a=quit]')!.addEventListener('click', () => {
      if (this.match?.opts.mode === 'tutorial') { m.close(); this.exitMatch(); this.showLobby(); return; }
      const c = this.modal(`<h2>${t('quit')}?</h2><p style="text-align:center">${t('exitMatch')}</p>
        <div class="actions"><button class="btn coral" data-a="yes">${t('quit')}</button><button class="btn white" data-a="no">${t('resume')}</button></div>`);
      c.el.querySelector('[data-a=no]')!.addEventListener('click', () => c.close());
      c.el.querySelector('[data-a=yes]')!.addEventListener('click', () => { c.close(); m.close(); this.forfeit(); });
    });
  }

  /** Leave mid-match: count as retired and fast-forward the bots to the end. */
  private forfeit() {
    const me = this.match?.world.byId.get('me');
    if (me && me.alive) { me.hp = 0; me.alive = false; me.place = this.match!.world.aliveCount + 1; }
    this.match?.fastForwardToEnd();
    this.match?.setPaused(false);
  }

  private showRetire(killer: Fighter | null, place: number) {
    const el = h(`<div class="retire">
      <h1 class="stroke">${t('retired')}</h1>
      <div class="rk stroke">${t('place', { n: place })}</div>
      <div class="chip">${killer ? `${this.portraits[killer.charId] ? `<img src="${this.portraits[killer.charId]}" style="width:2em">` : ''} ${t('defeatedBy', { name: escapeHtml(killer.name) })}` : t('poisonBy')}</div>
      <div class="row">
        <button class="btn sky" data-a="spec">👀 ${t('spectate')}</button>
        <button class="btn mint" data-a="results">🏁 ${t('results')}</button>
      </div></div>`);
    el.querySelector('[data-a=spec]')!.addEventListener('click', () => this.showSpectate(killer));
    el.querySelector('[data-a=results]')!.addEventListener('click', () => this.match?.fastForwardToEnd());
    this.setScreen('retire', el);
  }

  private showSpectate(killer: Fighter | null) {
    if (!this.match) return;
    if (killer?.alive) this.match.viewerId = killer.id; else this.match.spectateNext(1);
    const el = h(`<div style="pointer-events:none"><div class="spectate-bar panel" style="padding:.4em .6em">
      <button class="btn white icon-btn" data-d="-1">◀</button><span class="nm" style="min-width:8em;text-align:center"></span><button class="btn white icon-btn" data-d="1">▶</button>
      <button class="btn mint" data-a="results">🏁 ${t('results')}</button></div></div>`);
    const nm = el.querySelector('.nm') as HTMLElement;
    const upd = () => (nm.textContent = t('spectating', { name: this.match?.viewerName ?? '' }));
    upd();
    const iv = setInterval(() => { if (!this.match) clearInterval(iv); else upd(); }, 500);
    el.querySelectorAll<HTMLElement>('[data-d]').forEach((b) => b.addEventListener('click', () => { this.match?.spectateNext(+b.dataset.d!); upd(); }));
    el.querySelector('[data-a=results]')!.addEventListener('click', () => this.match?.fastForwardToEnd());
    this.setScreen('retire', el);
  }

  // ───────────────────────────── results
  private showResults(r: MatchResult) {
    const p = this.profile;
    const tutorial = this.match?.opts.mode === 'tutorial';
    const delta = trophyDelta(r.place);
    const xp = xpFor(r.place, r.kills);
    const before = p.trophies[r.charId];
    const lvBefore = p.level;
    const best = recordMatch(p, { date: Date.now(), nickname: p.nickname, charId: r.charId, place: r.place, score: r.score, kills: r.kills, damage: r.damage, trophyDelta: delta });
    const ups = addXp(p, xp);
    const after = p.trophies[r.charId];
    const unlocked = CHAR_BY_ID[r.charId].skins.filter((s) => before < s.unlockTrophies && after >= s.unlockTrophies);
    this.save();
    void tutorial;
    const w = r.world;
    const mvp = w.byId.get(r.mvpId)!;
    const title = r.place === 1 ? '🏆 ' + t('victory') : r.place <= 3 ? t('top3') : t('retired');
    const rows = w.ranking.map((x, i) => `<div class="rank-row ${x.id === r.localId ? 'me' : ''}" style="animation-delay:${0.1 + i * 0.06}s">
      <b>#${x.place}</b>${this.portraits[x.charId as CharacterId] ? `<img src="${this.portraits[x.charId as CharacterId]}">` : '<span></span>'}<span>${escapeHtml(x.name)}${x.id === r.mvpId ? ' <span class="chip" style="font-size:.7em;padding:0 .4em">MVP</span>' : ''}</span><span>⚔️${x.kills}</span><span>⭐${x.score}</span></div>`).join('');
    const el = h(`<div class="results">
      <div class="left">
        <div class="big-rank stroke">${t('place', { n: r.place })}</div>
        <div class="sub stroke-thin">${title}</div>
        <div class="score stroke">⭐ <span class="cu">0</span></div>
        <div class="badges">
          <span class="chip badge" style="animation-delay:.3s">⚔️ ${t('kills')} ${r.kills}</span>
          <span class="chip badge" style="animation-delay:.4s">💥 ${t('damage')} ${r.damage}</span>
          <span class="chip badge" style="animation-delay:.5s">🤝 ${t('assists')} ${r.assists}</span>
          <span class="chip badge" style="animation-delay:.6s;background:${delta >= 0 ? 'var(--mint)' : 'var(--coral)'}">🏆 ${delta >= 0 ? '+' : ''}${delta}</span>
          ${best ? `<span class="chip badge" style="animation-delay:.8s;background:var(--pink)">🎉 ${t('newBest')}</span>` : ''}
          ${ups ? `<span class="chip badge" style="animation-delay:.9s;background:var(--sky)">⬆️ ${t('levelUp')} ${t('level')}${p.level}</span>` : ''}
          ${unlocked.map((s) => `<span class="chip badge" style="animation-delay:1s;background:var(--lav)">🎁 ${t('unlocked', { name: s.name })}</span>`).join('')}
        </div>
        <div class="progress">${t('level')}${lvBefore}${ups ? ' → ' + p.level : ''} · XP +${xp}<div class="bar"><i class="xpfill"></i></div></div>
        <div class="progress">🏆 ${CHAR_BY_ID[r.charId].displayName} ${before} → ${after}<div class="bar"><i class="trfill"></i></div></div>
        <div class="actions">
          <button class="btn coral big stroke" data-a="again">${t('again')}</button>
          <button class="btn white" data-a="lobby">${t('toLobby')}</button>
        </div>
      </div>
      <div class="right panel">
        <div style="display:flex;align-items:center;gap:.6em;margin-bottom:.4em"><b>🌟 ${t('mvp')}</b>${this.portraits[mvp.charId] ? `<img src="${this.portraits[mvp.charId]}" style="width:2.6em">` : ''}<span>${escapeHtml(mvp.name)} · ⭐${mvp.score}</span></div>
        ${rows}
      </div></div>`);
    // animated count-up
    const cu = el.querySelector('.cu') as HTMLElement;
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 1200);
      cu.textContent = String(Math.round(r.score * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(step); else audio.play('pickup');
      if (k < 1 && Math.random() < 0.3) audio.play('tick', undefined, 0.4);
    };
    requestAnimationFrame(step);
    setTimeout(() => {
      (el.querySelector('.xpfill') as HTMLElement).style.width = `${(p.xp / levelXp(p.level)) * 100}%`;
      (el.querySelector('.trfill') as HTMLElement).style.width = `${Math.min(100, (after % 40) / 40 * 100 || (after ? 100 : 0))}%`;
    }, 200);
    if (r.place === 1) audio.play('victory');
    el.querySelector('[data-a=again]')!.addEventListener('click', () => { this.exitMatch(); this.showMatchmaking(); });
    el.querySelector('[data-a=lobby]')!.addEventListener('click', () => { this.exitMatch(); this.showLobby(); });
    this.setScreen('results', el);
  }

  // ───────────────────────────── modals
  private openSettings() {
    const s = this.profile.settings;
    const seg = (key: keyof typeof s, opts: [string, string][]) => `<span class="seg" data-k="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(s[key]) === v ? 'on' : ''}">${l}</button>`).join('')}</span>`;
    const tog = (key: keyof typeof s) => `<span class="toggle ${s[key] ? 'on' : ''}" data-k="${key}" role="switch"></span>`;
    const rng = (key: keyof typeof s, min: number, max: number, step: number) => `<input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}">`;
    const m = this.modal(`<h2>⚙️ ${t('settings')}</h2>
      <div class="setting"><span>${t('quality')}</span>${seg('quality', [['auto', t('auto')], ['low', t('low')], ['medium', t('medium')], ['high', t('high')]])}</div>
      <div class="setting"><span>${t('sfx')}</span>${rng('sfx', 0, 1, 0.05)}</div>
      <div class="setting"><span>${t('music')}</span>${rng('music', 0, 1, 0.05)}</div>
      <div class="setting"><span>${t('vibration')}</span>${tog('vibration')}</div>
      <div class="setting"><span>${t('leftHanded')}</span>${tog('leftHanded')}</div>
      <div class="setting"><span>${t('stickSize')}</span>${rng('stickSize', 50, 110, 5)}</div>
      <div class="setting"><span>${t('stickOpacity')}</span>${rng('stickOpacity', 0.3, 1, 0.05)}</div>
      <div class="setting"><span>${t('aimSens')}</span>${rng('aimSensitivity', 0.6, 1.4, 0.05)}</div>
      <div class="setting"><span>${t('uiScale')}</span>${rng('uiScale', 0.8, 1.3, 0.05)}</div>
      <div class="setting"><span>${t('colorblind')}</span>${tog('colorblind')}</div>
      <div class="setting"><span>${t('showStats')}</span>${tog('showStats')}</div>
      <div class="setting"><span>${t('language')}</span>${seg('lang', [['ko', '한국어'], ['en', 'English']])}</div>`, () => { if (this.screen === 'lobby') this.showLobby(); });
    const el = m.el;
    const set = (k: string, v: unknown) => {
      (s as unknown as Record<string, unknown>)[k] = v;
      this.save();
      if (k === 'quality') this.stage.setQuality(v === 'auto' ? this.profile.autoQuality ?? guessQuality() : (v as QualityLevel));
      if (k === 'lang') setLang(v as 'ko' | 'en');
      this.applySettings();
    };
    el.querySelectorAll<HTMLElement>('.seg').forEach((sg) => sg.querySelectorAll<HTMLElement>('button').forEach((b) => b.addEventListener('click', () => {
      sg.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); audio.play('click'); set(sg.dataset.k!, b.dataset.v);
    })));
    el.querySelectorAll<HTMLElement>('.toggle').forEach((tg) => tg.addEventListener('click', () => { tg.classList.toggle('on'); audio.play('click'); set(tg.dataset.k!, tg.classList.contains('on')); }));
    el.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((r) => r.addEventListener('input', () => set(r.dataset.k!, parseFloat(r.value))));
  }

  private openRecords() {
    const p = this.profile;
    const weekAgo = Date.now() - 7 * 864e5;
    const m = this.modal(`<h2>🏅 ${t('records')}</h2>
      <div class="stat-grid"><div><b>${p.games}</b>${t('games')}</div><div><b>${p.wins}</b>${t('wins')}</div><div><b>${p.bestScore}</b>${t('best')}</div><div><b>${p.kills}</b>${t('kills')}</div></div>
      <div class="tabs"><button class="btn mint" data-tab="all">${t('all')}</button><button class="btn white" data-tab="weekly">${t('weekly')}</button><button class="btn white" data-tab="char">${t('byChar')}</button></div>
      <div class="lb"></div>`);
    const lb = m.el.querySelector('.lb') as HTMLElement;
    const render = (tab: string) => {
      let list = p.records;
      if (tab === 'weekly') list = list.filter((r) => r.date >= weekAgo);
      if (tab === 'char') list = list.filter((r) => r.charId === favoriteCharacter(p));
      lb.innerHTML = list.length ? list.slice(0, 100).map((r, i) => `<div class="lb-row"><span class="rk">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span><span>${this.portraits[r.charId] ? `<img src="${this.portraits[r.charId]}" style="width:1.6em;vertical-align:middle">` : ''} ${escapeHtml(r.nickname)} <small style="color:var(--ink-soft)">#${r.place} · ⚔️${r.kills}</small></span><b>⭐${r.score}</b><small style="color:var(--ink-soft)">${new Date(r.date).toLocaleDateString()}</small></div>`).join('') : `<div class="empty">${t('noRecords')}</div>`;
    };
    m.el.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      m.el.querySelectorAll('[data-tab]').forEach((x) => { x.classList.remove('mint'); x.classList.add('white'); });
      b.classList.add('mint'); b.classList.remove('white');
      render(b.dataset.tab!);
    }));
    render('all');
  }
}

/** Five-axis radar chart as inline SVG. */
function radar(r: Record<string, number>, color: string) {
  const keys = ['hp', 'damage', 'range', 'speed', 'control'];
  const labels = ['체력', '공격', '사거리', '속도', '제어'];
  const pt = (i: number, v: number) => { const a = -Math.PI / 2 + (i / 5) * Math.PI * 2; return [50 + Math.cos(a) * 38 * v, 50 + Math.sin(a) * 38 * v]; };
  const ring = (v: number) => keys.map((_, i) => pt(i, v).join(',')).join(' ');
  const poly = keys.map((k, i) => pt(i, Math.max(0.12, Math.min(1, r[k]))).join(',')).join(' ');
  return `<svg class="radar" viewBox="-8 -4 116 108">
    ${[0.33, 0.66, 1].map((v) => `<polygon points="${ring(v)}" fill="none" stroke="#D9CCEC" stroke-width="1.2"/>`).join('')}
    <polygon points="${poly}" fill="${color}" fill-opacity=".75" stroke="#4A3B5C" stroke-width="2" stroke-linejoin="round"/>
    ${labels.map((l, i) => { const [x, y] = pt(i, 1.22); return `<text x="${x}" y="${y + 3}" font-size="8" text-anchor="middle" fill="#4A3B5C">${l}</text>`; }).join('')}
  </svg>`;
}
