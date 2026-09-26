import { Color, FogExp2, Raycaster, Scene, Vector2 } from 'three';
import { AudioManager } from '../audio/AudioManager';
import { Haptics } from '../audio/Haptics';
import { phonePortrait, isCoarsePointer } from '../core/device';
import { GameState } from '../core/GameState';
import { QualityMonitor } from '../core/QualityMonitor';
import { Renderer } from '../core/Renderer';
import { ParticleManager } from '../effects/ParticleManager';
import { ManipulationMode } from '../interaction/ManipulationMode';
import { InputManager } from '../input/InputManager';
import { getLevel, LEVELS } from '../levels';
import { resolveCaster, resolveLight, solutionStates } from '../levels/evaluate';
import type { LevelConfig } from '../levels/LevelData';
import { CharacterBody } from '../physics/CharacterBody';
import { CameraRig } from '../player/CameraRig';
import { PlayerView } from '../player/PlayerView';
import { SaveManager } from '../save/SaveManager';
import { initialAppliedQuality, profileFor, type AppliedQuality, type Settings } from '../settings/Settings';
import { ShadowManager } from '../shadows/ShadowManager';
import { Ui, formatTime, type HudState } from '../ui/Ui';
import { LevelWorld } from '../world/LevelWorld';

const raycaster = new Raycaster();
const ndc = new Vector2();

export class Game {
  private readonly save = new SaveManager();
  private readonly state = new GameState();
  private readonly scene = new Scene();
  private readonly renderer: Renderer;
  private readonly camera = new CameraRig();
  private readonly world: LevelWorld;
  private readonly particles: ParticleManager;
  private readonly player = new PlayerView();
  private readonly input: InputManager;
  private readonly audio = new AudioManager();
  private readonly haptics = new Haptics();
  private readonly ui: Ui;
  private readonly monitor = new QualityMonitor();
  private readonly manip = new ManipulationMode();
  private readonly debug: boolean;
  private tier: AppliedQuality;
  private config: LevelConfig | null = null;
  private shadows: ShadowManager | null = null;
  private body = new CharacterBody();
  private elapsed = 0;
  private attemptResets = 0;
  private transition = 0;
  private pendingSurface = '';
  private screenReturn: 'menu' | 'pause' = 'menu';
  private last = 0;
  private wasGrounded = true;
  private rotateLock = false;
  private debugWish = { x: 0, z: 0 };
  private debugWorld = false;

  constructor(canvas: HTMLCanvasElement, root: HTMLElement) {
    this.debug = new URLSearchParams(location.search).has('debug');
    this.renderer = new Renderer(canvas);
    this.tier = initialAppliedQuality(this.save.data.settings.quality, isCoarsePointer());
    this.world = new LevelWorld(this.scene);
    this.particles = new ParticleManager(this.scene, 80);
    this.scene.add(this.player.group);
    this.input = new InputManager(canvas, root);
    this.ui = new Ui(root, {
      continue: () => this.continueGame(),
      levels: () => this.showLevels(),
      tutorial: () => {
        localStorage.setItem('shadowforge-tutorial', '1');
        this.ui.show('tutorial');
      },
      settings: () => this.showSettings(),
      menu: () => this.enterMenu(),
      back: () => this.back(),
      startLevel: (id) => this.openLevel(id),
      begin: () => this.begin(),
      resume: () => this.resume(),
      pause: () => this.pause(),
      restart: () => this.restart(),
      next: () => this.nextLevel(),
      setting: (partial) => this.changeSettings(partial),
      resetProgress: () => this.resetProgress(),
      jump: () => this.input.press('jump'),
      interact: () => this.input.press('interact'),
      confirm: () => this.input.press('confirm'),
      cancel: () => this.input.press('cancel'),
      slider: (index) => this.commitIndex(index),
    });
    this.audio.onCaption = (text) => this.ui.caption(text);
    this.applySettings();
    this.player.group.visible = false;
    this.scene.background = new Color(0x07080e);
    this.scene.fog = new FogExp2(0x07080e, 0.08);
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('error', (event) => this.ui.error(event.message || 'Something went wrong'));
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason instanceof Error ? event.reason.message : 'Something went wrong';
      this.ui.error(reason);
    });
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    if (this.debug) {
      window.__SF = {
        jump: (level: number) => this.openLevel(level, true),
        begin: () => this.begin(),
        use: () => this.tryInteract(),
        solve: () => this.debugSolve(),
        forge: () => this.debugForge(),
        pos: () => ({ x: this.body.x, y: this.body.y, z: this.body.z, grounded: this.body.grounded }),
        drive: (x: number, z: number, ms: number) =>
          new Promise((resolve) => {
            this.debugWorld = true;
            this.debugWish = { x, z };
            window.setTimeout(() => {
              this.debugWorld = false;
              this.debugWish = { x: 0, z: 0 };
              resolve(window.__SF?.pos());
            }, ms);
          }),
        boxes: () =>
          (this.shadows?.collisionBoxes() ?? []).map((box) => ({
            minX: Number(box.minX.toFixed(2)),
            maxX: Number(box.maxX.toFixed(2)),
            minY: Number(box.minY.toFixed(2)),
            maxY: Number(box.maxY.toFixed(2)),
            minZ: Number(box.minZ.toFixed(2)),
            maxZ: Number(box.maxZ.toFixed(2)),
            climb: box.climbable,
          })),
        fps: () => Math.round(this.monitor.fps),
      };
    }
    if (!localStorage.getItem('shadowforge-tutorial')) {
      localStorage.setItem('shadowforge-tutorial', '1');
      this.ui.show('tutorial');
    } else this.ui.show('menu');
  }

  start(): void {
    this.resize();
    this.last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.tick(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private tick(dt: number): void {
    const portrait = phonePortrait();
    this.ui.setRotate(portrait);
    if (portrait && (this.state.name === 'PLAYING' || this.state.name === 'SHADOW_TRANSITION')) {
      this.rotateLock = true;
      this.input.sample();
      this.renderer.render(this.scene, this.camera.camera);
      return;
    }
    if (!portrait) this.rotateLock = false;
    const frame = this.input.sample();
    const mode = this.state.name;
    if (mode === 'MENU' || mode === 'LEVEL_SELECT') this.driftMenu(dt);
    if (mode === 'LEVEL_INTRO' && this.config) this.viewLevel(dt, frame.lookX, frame.lookY);
    if (mode === 'PLAYING') this.play(dt, frame);
    if (mode === 'SHADOW_TRANSITION') this.playTransition(dt);
    if (mode === 'PAUSED' || mode === 'LEVEL_COMPLETE' || mode === 'GAME_COMPLETE') {
      this.world.update(0);
    }
    const dropped = this.monitor.update(dt, this.tier, this.save.data.settings.quality);
    if (dropped) {
      this.tier = dropped;
      this.applyTier();
      this.ui.caption(`Graphics lowered to ${dropped}`);
    }
    this.renderer.render(this.scene, this.camera.camera);
  }

  private play(dt: number, frame: ReturnType<InputManager['sample']>): void {
    if (!this.config || !this.shadows) return;
    if (frame.pause) {
      this.pause();
      return;
    }
    this.elapsed += dt;
    if (this.manip.active) this.playManip(dt, frame);
    else this.playMove(dt, frame);
    const collapsed = this.shadows.update(dt);
    for (const id of collapsed) {
      this.audio.play('collapse');
      this.haptics.pulse(28);
      const def = this.shadows.defs.get(id);
      if (def) this.particles.burst(def.origin.x, def.origin.y + 0.2, def.origin.z, 28, 0xff6a4a, 'shard');
    }
    for (const [id, stab] of this.shadows.stability) {
      if (!stab.forged || !stab.unstable || Math.random() > dt * 2.5) continue;
      const ember = this.shadows.defs.get(id);
      if (ember) this.particles.burst(ember.origin.x, ember.origin.y + 0.15, ember.origin.z, 3, 0xffb15a, 'ember');
    }
    if (this.shadows.takeVisualDirty()) this.world.sync(this.shadows);
    this.world.update(dt, this.body.x, this.body.z);
    this.particles.setFocus(this.body.x, this.body.y, this.body.z);
    this.particles.update(dt);
    this.ui.setHud(this.hud());
    if (this.body.y < -6) this.respawn();
    else this.checkExit();
  }

  private playMove(dt: number, frame: ReturnType<InputManager['sample']>): void {
    if (!this.shadows) return;
    this.camera.look(frame.lookX, frame.lookY);
    const wish = this.debugWorld
      ? this.debugWish
      : this.camera.wish(frame.moveX, frame.moveZ, this.save.data.settings.controlSensitivity);
    const boxes = this.shadows.collisionBoxes();
    const before = this.wasGrounded;
    this.body.step(dt, wish.x, wish.z, frame.jump, boxes);
    this.wasGrounded = this.body.grounded;
    if (frame.jump && before) this.audio.play('jump');
    if (!before && this.body.grounded) this.audio.play('land');
    if (this.body.grounded && Math.hypot(this.body.vx, this.body.vz) > 1.4) this.audio.step();
    this.player.update(dt, this.body);
    this.camera.update(dt, this.body, boxes);
    if (frame.interact) this.tryInteract();
    if (frame.clicked) this.pickNode(frame.clickX, frame.clickY);
  }

  private playManip(dt: number, frame: ReturnType<InputManager['sample']>): void {
    if (!this.shadows || !this.config) return;
    if (frame.cancel) {
      this.cancelManip();
      return;
    }
    if (frame.confirm) {
      this.confirmManip();
      return;
    }
    if (frame.cycle) this.commitIndex(this.manip.index + Math.sign(frame.cycle));
    if (frame.clicked) this.pickNode(frame.clickX, frame.clickY);
    const boxes = this.shadows.collisionBoxes();
    this.body.step(dt, 0, 0, false, boxes);
    this.player.update(dt, this.body);
    this.camera.look(frame.lookX * 0.35, frame.lookY * 0.35);
    this.camera.update(dt, this.body, boxes);
  }

  private playTransition(dt: number): void {
    if (!this.shadows || !this.config) return;
    this.transition += dt;
    this.world.update(dt);
    this.particles.update(dt);
    this.camera.shake = 0.6;
    const boxes = this.shadows.collisionBoxes();
    this.body.step(dt, 0, 0, false, boxes);
    this.player.update(dt, this.body);
    this.camera.update(dt, this.body, boxes);
    if (this.transition < 0.55) return;
    const forged = this.shadows.forge(this.pendingSurface);
    this.world.sync(this.shadows);
    if (forged) this.world.pulseForge(this.pendingSurface);
    this.state.set('PLAYING');
    if (!forged) this.audio.play('deny');
  }

  private tryInteract(): void {
    if (!this.config || !this.shadows) return;
    const hit = this.nearest();
    if (!hit) return;
    this.player.pulseInteract();
    this.audio.play('interact');
    this.haptics.pulse(8);
    if (hit.kind === 'console') {
      const preview = this.shadows.preview.get(hit.surfaceId);
      const any = preview ? preview.some((cell) => cell) : false;
      if (!any) {
        this.audio.play('deny');
        return;
      }
      this.pendingSurface = hit.surfaceId;
      this.transition = 0;
      this.state.set('SHADOW_TRANSITION');
      this.audio.play('forge');
      this.haptics.pulse(30);
      const def = this.shadows.defs.get(hit.surfaceId);
      if (def) this.particles.burst(def.origin.x, def.origin.y + 0.3, def.origin.z, 36, 0x5ce1ff, 'spark');
      return;
    }
    if (hit.interaction === 'toggle') {
      const current = this.shadows.states[hit.id] ?? 0;
      this.shadows.setState(hit.id, current === 0 ? 1 : 0);
      this.world.sync(this.shadows);
      this.audio.play('snap');
      return;
    }
    this.manip.begin({
      id: hit.id,
      kind: hit.kind,
      index: this.shadows.states[hit.id] ?? 0,
      count: hit.count,
      label: hit.label,
      prompt: hit.prompt,
      guide: hit.guide,
    });
    this.input.setMode('manipulate');
    this.world.showGuides(hit.id, this.manip.index);
    this.frameManip(hit.id);
  }

  private commitIndex(index: number): void {
    if (!this.manip.active || !this.shadows) return;
    const before = this.shadows.states[this.manip.id] ?? 0;
    const next = this.manip.set(index);
    if (next === before) return;
    this.shadows.setState(this.manip.id, next);
    this.world.showGuides(this.manip.id, next);
    this.world.sync(this.shadows);
    this.audio.play('snap');
    this.haptics.pulse(12);
  }

  private confirmManip(): void {
    this.manip.confirm();
    this.input.setMode('play');
    this.world.hideGuides();
    this.camera.clearFrame();
    this.audio.play('ui');
  }

  private cancelManip(): void {
    if (!this.shadows) return;
    const saved = this.manip.cancel();
    this.shadows.setState(this.manip.id, saved);
    this.input.setMode('play');
    this.world.hideGuides();
    this.camera.clearFrame();
    this.world.sync(this.shadows);
  }

  private pickNode(x: number, y: number): void {
    if (!this.manip.active) return;
    ndc.set(x, y);
    raycaster.setFromCamera(ndc, this.camera.camera);
    const hits = raycaster.intersectObjects(this.world.guideMeshes, false);
    const index = hits[0]?.object.userData.index;
    if (typeof index === 'number') this.commitIndex(index);
  }

  private frameManip(id: string): void {
    if (!this.config) return;
    const light = this.config.lights.find((entry) => entry.id === id);
    const caster = this.config.casters.find((entry) => entry.id === id);
    const cfg = light ?? caster;
    if (!cfg || !this.shadows) return;
    const volume = light
      ? resolveLight(light, this.shadows.states[id] ?? 0)
      : resolveCaster(caster!, this.shadows.states[id] ?? 0);
    const pos = 'x' in volume ? { x: volume.x, y: volume.y, z: volume.z } : { x: volume.cx, y: volume.cy, z: volume.cz };
    const surface = this.config.surfaces.find((entry) => entry.zone && entry.zone === cfg.zone) ?? this.config.surfaces[0];
    this.camera.frame(pos.x - 2.2, pos.y + 1.8, pos.z + 3.4, surface.origin[0], surface.origin[1] + 0.4, surface.origin[2]);
  }

  private nearest(): {
    kind: 'light' | 'caster' | 'console';
    id: string;
    surfaceId: string;
    label: string;
    prompt: string;
    interaction: string;
    guide: 'nodes' | 'rail' | 'arc';
    count: number;
  } | null {
    if (!this.config || !this.shadows) return null;
    let best: ReturnType<Game['nearest']> = null;
    let bestDist = 2.2;
    const consider = (x: number, y: number, z: number, item: NonNullable<typeof best>) => {
      const dist = Math.hypot(this.body.x - x, this.body.y - y, this.body.z - z);
      if (dist < bestDist) {
        bestDist = dist;
        best = item;
      }
    };
    for (const console of this.config.consoles) {
      consider(console.position[0], console.position[1], console.position[2], {
        kind: 'console',
        id: console.id,
        surfaceId: console.surfaceId,
        label: 'Forge console',
        prompt: 'FORGE SHADOW',
        interaction: 'console',
        guide: 'nodes',
        count: 1,
      });
    }
    for (const light of this.config.lights) {
      if (light.interaction === 'none') continue;
      const at = light.interactAt ?? light.position;
      consider(at[0], at[1], at[2], {
        kind: 'light',
        id: light.id,
        surfaceId: '',
        label: light.label,
        prompt: light.prompt,
        interaction: light.interaction,
        guide: light.guide,
        count: light.states.length,
      });
    }
    for (const caster of this.config.casters) {
      if (caster.interaction === 'none') continue;
      const at = caster.interactAt ?? [caster.position[0], 0, caster.position[2]];
      consider(at[0], at[1], at[2], {
        kind: 'caster',
        id: caster.id,
        surfaceId: '',
        label: caster.label,
        prompt: caster.prompt,
        interaction: caster.interaction,
        guide: caster.guide,
        count: caster.states.length,
      });
    }
    return best;
  }

  private hud(): HudState {
    const near = this.manip.active ? null : this.nearest();
    const bars = [];
    if (this.shadows) {
      for (const [id, stab] of this.shadows.stability) {
        if (stab.forged) bars.push({ id, value: Math.max(0, stab.value) });
      }
    }
    let prompt = '';
    if (near?.kind === 'console') prompt = 'E  Forge shadow';
    else if (near) prompt = `E  ${near.prompt || near.label}`;
    return {
      objective: this.config?.objective ?? '',
      time: formatTime(this.elapsed),
      prompt,
      showInteract: !!near,
      manipulating: this.manip.active,
      manipLabel: this.manip.label,
      manipPrompt: this.manip.prompt,
      manipIndex: this.manip.index,
      manipCount: this.manip.count,
      bars,
    };
  }

  private checkExit(): void {
    if (!this.config) return;
    const exit = this.config.exit;
    const dist = Math.hypot(this.body.x - exit.position[0], this.body.z - exit.position[2]);
    if (dist > exit.radius || !this.body.grounded || Math.abs(this.body.y - exit.position[1]) > 1.6) return;
    const index = this.config.id - 1;
    this.save.markComplete(this.config.id, this.elapsed, this.save.data.resets[index] ?? this.attemptResets);
    this.audio.play('complete');
    this.haptics.pulse(24);
    this.input.setMode('play');
    this.releasePointer();
    if (this.config.id >= LEVELS.length) {
      this.state.set('GAME_COMPLETE');
      this.ui.show('victory');
      return;
    }
    this.ui.setComplete(this.config.name, `${formatTime(this.elapsed)} · ${this.attemptResets} resets`, false);
    this.state.set('LEVEL_COMPLETE');
    this.ui.show('complete');
  }

  private respawn(): void {
    if (!this.config) return;
    const start = this.config.playerStart.position;
    this.body.x = start[0];
    this.body.y = start[1] + 0.2;
    this.body.z = start[2];
    this.body.vx = 0;
    this.body.vy = 0;
    this.body.vz = 0;
    this.attemptResets += 1;
    this.save.addReset(this.config.id);
    this.ui.caption('Returned to the start');
  }

  private openLevel(id: number, force = false): void {
    const level = LEVELS.find((entry) => entry.id === id);
    if (!level) return;
    if (!force && !this.debug && id > this.save.data.unlocked) return;
    this.config = getLevel(id);
    this.shadows = new ShadowManager(this.config);
    const profile = profileFor(this.tier, isCoarsePointer());
    this.world.load(this.config, profile.shadowMapSize);
    this.world.sync(this.shadows);
    this.placePlayer();
    this.elapsed = 0;
    this.attemptResets = 0;
    this.manip.active = false;
    this.input.setMode('play');
    this.world.showMenu(false);
    this.player.group.visible = true;
    this.ui.setIntro(this.config.id, this.config.name, this.config.blurb, this.config.objective);
    this.state.set('LEVEL_INTRO');
    this.ui.show('intro');
    this.ui.setTouch(isCoarsePointer());
  }

  private begin(): void {
    if (!this.config) return;
    this.state.set('PLAYING');
    this.ui.show('play');
    this.ui.setHud(this.hud());
  }

  private pause(): void {
    if (this.state.name !== 'PLAYING' && this.state.name !== 'SHADOW_TRANSITION') return;
    if (this.manip.active) this.cancelManip();
    this.releasePointer();
    this.state.set('PAUSED');
    this.ui.show('pause');
  }

  private resume(): void {
    if (this.rotateLock) return;
    this.state.set('PLAYING');
    this.ui.show('play');
  }

  private restart(): void {
    if (!this.config) return;
    this.attemptResets += 1;
    this.save.addReset(this.config.id);
    this.shadows = new ShadowManager(this.config);
    const profile = profileFor(this.tier, isCoarsePointer());
    this.world.load(this.config, profile.shadowMapSize);
    this.world.sync(this.shadows);
    this.placePlayer();
    this.elapsed = 0;
    this.manip.active = false;
    this.input.setMode('play');
    this.world.showMenu(false);
    this.player.group.visible = true;
    this.state.set('PLAYING');
    this.ui.show('play');
  }

  private nextLevel(): void {
    if (!this.config) return;
    this.openLevel(this.config.id + 1);
  }

  private continueGame(): void {
    const incomplete = this.save.data.completed.findIndex((done) => !done);
    let id = incomplete < 0 ? LEVELS.length : incomplete + 1;
    id = Math.min(id, this.save.data.unlocked);
    this.openLevel(id);
  }

  private showLevels(): void {
    this.world.showMenu(true);
    this.player.group.visible = false;
    this.releasePointer();
    this.ui.setLevels(
      LEVELS.map((level) => ({
        id: level.id,
        name: level.name,
        locked: !this.debug && level.id > this.save.data.unlocked,
        complete: this.save.data.completed[level.id - 1] === true,
        time: this.save.data.bestTimes[level.id - 1] ?? 0,
        resets: this.save.data.resets[level.id - 1] ?? 0,
      })),
    );
    this.state.set('LEVEL_SELECT');
    this.ui.show('levels');
  }

  private showSettings(): void {
    this.screenReturn = this.state.name === 'PAUSED' ? 'pause' : 'menu';
    this.ui.setSettings(this.save.data.settings, this.tier);
    this.ui.show('settings');
  }

  private back(): void {
    if (this.screenReturn === 'pause' && this.state.name === 'PAUSED') {
      this.ui.show('pause');
      return;
    }
    this.enterMenu();
  }

  private enterMenu(): void {
    if (this.manip.active) this.cancelManip();
    this.releasePointer();
    this.world.showMenu(true);
    this.player.group.visible = false;
    this.scene.background = new Color(0x07080e);
    this.scene.fog = new FogExp2(0x07080e, 0.08);
    this.state.set('MENU');
    this.ui.show('menu');
  }

  private driftMenu(dt: number): void {
    this.world.update(dt);
    this.particles.setFocus(0, 1, 0);
    this.particles.update(dt);
    const t = this.world.time;
    this.camera.camera.position.set(Math.sin(t * 0.25) * 0.6 + 3.1, 1.9, 5.2);
    this.camera.camera.lookAt(0, 0.7, 0);
  }

  private viewLevel(dt: number, lookX: number, lookY: number): void {
    if (!this.shadows) return;
    this.camera.look(lookX, lookY);
    this.world.update(dt);
    this.player.update(dt, this.body);
    this.camera.update(dt, this.body, this.shadows.collisionBoxes());
  }

  private placePlayer(): void {
    if (!this.config) return;
    const start = this.config.playerStart;
    this.body = new CharacterBody();
    this.body.x = start.position[0];
    this.body.y = start.position[1];
    this.body.z = start.position[2];
    this.body.facing = start.yaw;
    this.camera.yaw = start.yaw;
    this.camera.pitch = 0.42;
    this.camera.clearFrame();
    this.wasGrounded = true;
    this.player.update(0, this.body);
  }

  private changeSettings(partial: Partial<Settings>): void {
    this.save.updateSettings({ ...this.save.data.settings, ...partial });
    this.applySettings();
  }

  private applySettings(): void {
    const settings = this.save.data.settings;
    this.audio.sound = settings.sound;
    this.audio.music = settings.music;
    this.audio.volume = settings.volume;
    this.audio.apply();
    this.haptics.enabled = settings.haptics;
    this.camera.sensitivity = settings.cameraSensitivity;
    this.camera.invertY = settings.invertY;
    this.tier = initialAppliedQuality(settings.quality, isCoarsePointer());
    this.applyTier();
    this.ui.setTouch(isCoarsePointer());
  }

  private applyTier(): void {
    const profile = profileFor(this.tier, isCoarsePointer());
    this.renderer.applyQuality(profile);
    this.renderer.setPresentation(profile, this.scene, this.camera.camera);
    this.world.bindRenderer(this.renderer.renderer);
    this.world.applyProfile(profile);
    this.world.applyShadowSize(profile.shadowMapSize);
    this.particles.setBudget(profile.particles);
    this.particles.setDust(profile.dust);
    this.player.setLamp(profile.playerLight);
    this.resize();
  }

  private resize(): void {
    this.renderer.resize();
    this.camera.resize(window.innerWidth, window.innerHeight);
  }

  private resetProgress(): void {
    if (!window.confirm('Erase saved progress?')) return;
    this.save.resetProgress();
    this.ui.caption('Progress cleared');
    this.enterMenu();
  }

  private debugSolve(): void {
    if (!this.config || !this.shadows) return;
    const solved = solutionStates(this.config);
    for (const [id, index] of Object.entries(solved)) this.shadows.setState(id, index);
    this.world.sync(this.shadows);
  }

  private debugForge(): void {
    if (!this.config || !this.shadows) return;
    for (const surface of this.config.surfaces) this.shadows.forge(surface.id);
    this.world.sync(this.shadows);
  }

  private releasePointer(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
