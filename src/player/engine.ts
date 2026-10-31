import type Hls from 'hls.js';
import type { ErrorData, Level } from 'hls.js';
import type Mpegts from 'mpegts.js';
import { backendHealth, probe, proxied, remuxUrl } from '../lib/api';
import { extOf } from '../lib/format';
import type { PlayRequest } from '../lib/types';

export type EngineKind = 'hls' | 'mpegts' | 'native' | 'remux';
export type EngineStatus = 'loading' | 'playing' | 'buffering' | 'paused' | 'reconnecting' | 'ended' | 'error';

export interface TrackInfo {
  id: number;
  label: string;
  lang?: string;
}

export interface EngineStats {
  engine: EngineKind;
  resolution?: string;
  bitrateKbps?: number;
  bandwidthKbps?: number;
  bufferSec: number;
  droppedFrames?: number;
  decodedFrames?: number;
  latencySec?: number;
  videoCodec?: string;
  audioCodec?: string;
  url: string;
}

export interface EngineOptions {
  liveBufferSec: number;
  autoReconnect: boolean;
  preferRemux: boolean;
  preferredAudioLang?: string;
  preferredSubLang?: string;
  onStatus: (s: EngineStatus, detail?: string) => void;
  onTracks: () => void;
  onEngine: (k: EngineKind) => void;
}

interface Candidate {
  kind: EngineKind;
  url: string;
  ext?: string;
  transcode?: boolean;
}

/** Request-specific helper to rebuild a URL starting at an offset (timeshift seeking). */
export type SeekUrlBuilder = (offsetSec: number) => string | null;

const VIRTUAL_SEEK_KINDS = new Set<PlayRequest['kind']>(['catchup']);

export function planCandidates(req: PlayRequest, opts: { preferRemux: boolean; ffmpeg: boolean; hlsSupported: boolean; mseSupported: boolean; nativeHls: boolean }): Candidate[] {
  const out: Candidate[] = [];
  const ext = (req.ext ?? extOf(req.url) ?? (req.kind === 'live' ? 'ts' : 'mp4')).toLowerCase();
  const add = (c: Candidate) => {
    if (!out.some((o) => o.kind === c.kind && o.url === c.url && !!o.transcode === !!c.transcode)) out.push(c);
  };
  const forUrl = (url: string, e: string) => {
    if (e === 'm3u8' || /\.m3u8(\?|$)/i.test(url)) {
      if (opts.hlsSupported) add({ kind: 'hls', url, ext: 'm3u8' });
      else if (opts.nativeHls) add({ kind: 'native', url, ext: 'm3u8' });
    } else if (e === 'ts' || e === 'mpegts' || (req.kind === 'live' && !['mp4', 'mkv', 'webm', 'flv'].includes(e))) {
      if (opts.mseSupported) add({ kind: 'mpegts', url, ext: 'ts' });
    } else if (e === 'flv') {
      if (opts.mseSupported) add({ kind: 'mpegts', url, ext: 'flv' });
    } else if (['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mp3', 'aac', 'm4a'].includes(e)) {
      add({ kind: 'native', url, ext: e });
    } else if (e === 'mkv') {
      if (opts.preferRemux && opts.ffmpeg) add({ kind: 'remux', url, ext: e });
      add({ kind: 'native', url, ext: e });
    } else {
      if (opts.ffmpeg) add({ kind: 'remux', url, ext: e });
      add({ kind: 'native', url, ext: e });
    }
  };
  if (req.kind === 'recording') {
    add({ kind: 'native', url: req.url, ext });
    return out;
  }
  forUrl(req.url, ext);
  if (req.fallbackUrl) forUrl(req.fallbackUrl, (req.fallbackExt ?? extOf(req.fallbackUrl) ?? 'ts').toLowerCase());
  if (opts.ffmpeg) {
    add({ kind: 'remux', url: req.url, ext });
    if (req.kind !== 'live') add({ kind: 'remux', url: req.url, ext, transcode: true });
  }
  return out;
}

/**
 * Wraps hls.js / mpegts.js / native playback / server remux behind one API with
 * automatic fallback, reconnection for live streams and a virtual timeline for
 * streams that can only be "seeked" by re-requesting them from an offset.
 */
export class PlaybackEngine {
  kind: EngineKind = 'native';
  private hls: Hls | null = null;
  private ts: Mpegts.Player | null = null;
  private candidates: Candidate[] = [];
  private index = 0;
  private attempts = 0;
  private destroyed = false;
  private retryTimer: number | undefined;
  private watchdog: number | undefined;
  private silentCheck: number | undefined;
  private offset = 0;
  private cleanup: (() => void)[] = [];
  private mpegtsLib: typeof Mpegts | null = null;
  private lastProgressAt = Date.now();
  private lastTime = 0;
  current: Candidate | null = null;

  constructor(
    private video: HTMLVideoElement,
    readonly req: PlayRequest,
    private opts: EngineOptions,
    private seekUrl?: SeekUrlBuilder,
  ) {}

  get isLive(): boolean {
    return this.req.kind === 'live';
  }

  /** True when seeking is implemented by reloading from an offset. */
  get virtualTimeline(): boolean {
    return this.current?.kind === 'remux' || (VIRTUAL_SEEK_KINDS.has(this.req.kind) && !!this.seekUrl && this.current?.kind === 'mpegts');
  }

  async start(): Promise<void> {
    const [{ default: HlsLib }, mpegtsMod] = await Promise.all([import('hls.js'), import('mpegts.js')]);
    if (this.destroyed) return;
    this.mpegtsLib = mpegtsMod.default;
    this.mpegtsLib.LoggingControl.applyConfig({ enableAll: false, enableError: false, enableWarn: false, enableInfo: false, enableDebug: false, enableVerbose: false });
    const health = backendHealth();
    this.candidates = planCandidates(this.req, {
      preferRemux: this.opts.preferRemux,
      ffmpeg: !!health?.ffmpeg,
      hlsSupported: HlsLib.isSupported(),
      mseSupported: this.mpegtsLib.isSupported(),
      nativeHls: !!this.video.canPlayType('application/vnd.apple.mpegurl'),
    });
    if (!this.candidates.length) {
      this.opts.onStatus('error', 'This browser cannot play this stream type.');
      return;
    }
    this.offset = this.req.startAt && this.req.kind !== 'live' ? this.req.startAt : 0;
    this.bindVideo();
    this.load(HlsLib);
  }

  private hlsCtor: typeof Hls | null = null;

  private bindVideo(): void {
    const v = this.video;
    const on = (ev: string, fn: () => void) => {
      v.addEventListener(ev, fn);
      this.cleanup.push(() => v.removeEventListener(ev, fn));
    };
    on('playing', () => {
      this.attempts = 0;
      this.opts.onStatus('playing');
    });
    on('waiting', () => this.opts.onStatus('buffering'));
    on('pause', () => !v.ended && this.opts.onStatus('paused'));
    on('ended', () => {
      if (this.isLive) this.fail('Stream ended');
      else this.opts.onStatus('ended');
    });
    on('timeupdate', () => {
      if (v.currentTime !== this.lastTime) {
        this.lastTime = v.currentTime;
        this.lastProgressAt = Date.now();
      }
    });
    on('error', () => {
      const err = v.error;
      if (!err || !this.current) return;
      if (this.current.kind === 'native' || this.current.kind === 'remux') {
        this.fail(err.message || `Media error ${err.code}`, err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || err.code === MediaError.MEDIA_ERR_DECODE);
      }
    });
    // Stall watchdog for live streams: no progress for 15s while "playing" → reconnect.
    this.watchdog = window.setInterval(() => {
      if (!this.isLive || v.paused || this.destroyed) return;
      if (Date.now() - this.lastProgressAt > 15000) {
        this.lastProgressAt = Date.now();
        this.fail('Stream stalled');
      }
    }, 3000);
  }

  private load(HlsLib?: typeof Hls): void {
    if (HlsLib) this.hlsCtor = HlsLib;
    this.teardownPlayers();
    const c = this.candidates[this.index];
    if (!c) {
      this.opts.onStatus('error', 'Could not play this stream with any available method.');
      return;
    }
    this.current = c;
    this.kind = c.kind;
    this.opts.onEngine(c.kind);
    this.opts.onStatus('loading');
    this.lastProgressAt = Date.now();
    const ua = this.req.userAgent;
    const ref = this.req.referrer;
    const v = this.video;

    switch (c.kind) {
      case 'hls': {
        const HlsC = this.hlsCtor!;
        const hls = new HlsC({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: this.isLive ? 120 : 30,
          maxBufferLength: this.isLive ? Math.max(10, this.opts.liveBufferSec) : 60,
          liveSyncDurationCount: 3,
          manifestLoadingMaxRetry: 2,
          levelLoadingMaxRetry: 3,
          fragLoadingMaxRetry: 4,
          startPosition: this.offset > 0 ? this.offset : -1,
        });
        this.hls = hls;
        let mediaRecoveries = 0;
        hls.on(HlsC.Events.MANIFEST_PARSED, () => {
          this.applyPreferredTracks();
          this.opts.onTracks();
          void v.play().catch(() => this.opts.onStatus('paused'));
        });
        hls.on(HlsC.Events.AUDIO_TRACKS_UPDATED, () => this.opts.onTracks());
        hls.on(HlsC.Events.SUBTITLE_TRACKS_UPDATED, () => this.opts.onTracks());
        hls.on(HlsC.Events.LEVEL_SWITCHED, () => this.opts.onTracks());
        hls.on(HlsC.Events.ERROR, (_e, data: ErrorData) => {
          if (!data.fatal) return;
          if (data.type === HlsC.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
            mediaRecoveries++;
            if (mediaRecoveries === 2) hls.swapAudioCodec();
            hls.recoverMediaError();
            return;
          }
          const status = (data.response as { code?: number } | undefined)?.code;
          const unsupported = data.type === HlsC.ErrorTypes.MEDIA_ERROR || data.details === 'manifestParsingError' || data.details === 'manifestIncompatibleCodecsError';
          this.fail(status ? `HTTP ${status} (${data.details})` : data.details, unsupported);
        });
        hls.loadSource(proxied(c.url, { ua, ref }));
        hls.attachMedia(v);
        break;
      }
      case 'mpegts':
      case 'remux': {
        const lib = this.mpegtsLib!;
        let url: string;
        if (c.kind === 'remux') {
          url = remuxUrl(c.url, { ua, start: this.offset, transcode: c.transcode });
          this.ensureDuration();
        } else if (this.offset > 0 && this.seekUrl) {
          url = proxied(this.seekUrl(this.offset) ?? c.url, { ua, ref });
        } else {
          url = proxied(c.url, { ua, ref });
        }
        const live = this.isLive || c.kind === 'remux';
        const player = lib.createPlayer(
          { type: c.ext === 'flv' ? 'flv' : 'mpegts', isLive: live, url: new URL(url, location.href).toString() },
          {
            enableWorker: true,
            enableStashBuffer: !this.isLive,
            stashInitialSize: this.isLive ? 384 * 1024 : undefined,
            lazyLoad: !live,
            autoCleanupSourceBuffer: true,
            liveBufferLatencyChasing: this.isLive,
            liveBufferLatencyMaxLatency: Math.max(6, this.opts.liveBufferSec),
            liveBufferLatencyMinRemain: 2,
          } as unknown as Mpegts.Config,
        );
        this.ts = player;
        player.on(lib.Events.ERROR, (type: string, detail: string) => {
          const unsupported = type === lib.ErrorTypes.MEDIA_ERROR;
          this.fail(`${type}: ${detail}`, unsupported);
        });
        player.on(lib.Events.MEDIA_INFO, () => this.opts.onTracks());
        if (!this.isLive && c.kind === 'mpegts') {
          player.on(lib.Events.LOADING_COMPLETE, () => undefined);
        }
        player.attachMediaElement(v);
        player.load();
        const p = player.play();
        if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => this.opts.onStatus('paused'));
        break;
      }
      case 'native': {
        const src = this.req.kind === 'recording' ? c.url : proxied(c.url, { ua, ref });
        v.src = src;
        const startAt = this.offset;
        const onMeta = () => {
          if (startAt > 0 && Number.isFinite(v.duration)) v.currentTime = Math.min(startAt, v.duration - 5);
          this.opts.onTracks();
          this.scheduleSilentCheck();
        };
        v.addEventListener('loadedmetadata', onMeta, { once: true });
        this.cleanup.push(() => v.removeEventListener('loadedmetadata', onMeta));
        void v.play().catch((e: Error) => {
          if (e.name === 'NotAllowedError') this.opts.onStatus('paused');
        });
        break;
      }
    }
  }

  /**
   * Browsers happily play MKV/AVI with an unsupported audio codec (AC3/DTS) in
   * silence. Detect that (Chrome exposes decoded byte counters) and switch to the
   * server remux which converts audio to AAC.
   */
  private scheduleSilentCheck(): void {
    window.clearTimeout(this.silentCheck);
    if (!backendHealth()?.ffmpeg) return;
    const ext = this.current?.ext ?? '';
    if (!['mkv', 'avi', 'mov', 'wmv'].includes(ext)) return;
    this.silentCheck = window.setTimeout(() => {
      const v = this.video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number; webkitVideoDecodedByteCount?: number };
      if (v.paused || this.destroyed) return;
      const noAudio = v.webkitAudioDecodedByteCount === 0;
      const noVideo = v.videoWidth === 0 || v.webkitVideoDecodedByteCount === 0;
      if (noAudio || noVideo) {
        this.offset = v.currentTime;
        const remuxIdx = this.candidates.findIndex((c, i) => i > this.index && c.kind === 'remux' && (!noVideo || c.transcode));
        if (remuxIdx >= 0) {
          this.index = remuxIdx;
          this.load();
        }
      }
    }, 4000);
  }

  private fail(message: string, unsupported = false): void {
    if (this.destroyed) return;
    const liveRetry = this.isLive && this.opts.autoReconnect && !unsupported;
    // Remember where we were so the next attempt resumes there.
    if (!this.isLive) this.offset = this.currentTime;
    if (liveRetry && this.attempts < 3) {
      this.attempts++;
      const delay = Math.min(10000, 1000 * 2 ** (this.attempts - 1));
      this.opts.onStatus('reconnecting', `${message} — retrying in ${Math.round(delay / 1000)}s`);
      this.teardownPlayers();
      this.retryTimer = window.setTimeout(() => this.load(), delay);
      return;
    }
    if (this.index + 1 < this.candidates.length) {
      this.index++;
      this.attempts = 0;
      this.opts.onStatus('reconnecting', `${message} — trying ${this.candidates[this.index].kind}`);
      this.retryTimer = window.setTimeout(() => this.load(), 300);
      return;
    }
    if (this.isLive && this.opts.autoReconnect && this.attempts < 6) {
      // Cycle through the candidates once more before giving up.
      this.attempts++;
      this.index = 0;
      this.opts.onStatus('reconnecting', `${message} — reconnecting`);
      this.retryTimer = window.setTimeout(() => this.load(), 5000);
      return;
    }
    this.teardownPlayers();
    this.opts.onStatus('error', message);
  }

  /** Force a specific playback method (e.g. user picks "server remux"). */
  switchTo(kind: EngineKind, transcode = false): boolean {
    const idx = this.candidates.findIndex((c) => c.kind === kind && !!c.transcode === transcode);
    let target = idx;
    if (target < 0) {
      if (kind !== 'remux' || !backendHealth()?.ffmpeg) return false;
      this.candidates.push({ kind: 'remux', url: this.req.url, ext: this.req.ext, transcode });
      target = this.candidates.length - 1;
    }
    if (!this.isLive) this.offset = this.currentTime;
    this.index = target;
    this.attempts = 0;
    this.load();
    return true;
  }

  retry(): void {
    this.attempts = 0;
    this.index = 0;
    this.load();
  }

  availableKinds(): { kind: EngineKind; transcode?: boolean }[] {
    const kinds = this.candidates.map((c) => ({ kind: c.kind, transcode: c.transcode }));
    if (backendHealth()?.ffmpeg && !kinds.some((k) => k.kind === 'remux')) kinds.push({ kind: 'remux', transcode: false });
    return kinds;
  }

  // ---------------------------------------------------------------- timeline
  private probedDuration: number | undefined;
  private probing = false;

  /** Remux output has no duration; ask the server (ffprobe) so the seek bar works. */
  private ensureDuration(): void {
    if (this.req.duration || this.probedDuration || this.probing || this.isLive) return;
    this.probing = true;
    void probe(this.req.url, this.req.userAgent).then((r) => {
      if (r?.duration) {
        this.probedDuration = r.duration;
        this.opts.onTracks();
      }
    });
  }

  get currentTime(): number {
    return (this.virtualTimeline ? this.offset : 0) + (this.video.currentTime || 0);
  }

  get duration(): number {
    if (this.virtualTimeline) return this.req.duration ?? this.probedDuration ?? NaN;
    const d = this.video.duration;
    if (Number.isFinite(d) && d > 0) return d;
    return this.req.duration ?? NaN;
  }

  /** For live HLS: the seekable window (DVR). */
  get seekableRange(): { start: number; end: number } | null {
    const s = this.video.seekable;
    if (!s || !s.length) return null;
    return { start: s.start(0), end: s.end(s.length - 1) };
  }

  get canSeek(): boolean {
    if (this.isLive) {
      const r = this.seekableRange;
      return !!r && r.end - r.start > 10;
    }
    if (this.virtualTimeline) return Number.isFinite(this.duration);
    return Number.isFinite(this.duration);
  }

  seek(t: number): void {
    const dur = this.duration;
    const target = Math.max(0, Number.isFinite(dur) ? Math.min(t, dur - 1) : t);
    if (this.virtualTimeline) {
      this.offset = target;
      this.load();
      return;
    }
    this.video.currentTime = target;
  }

  seekBy(delta: number): void {
    if (this.isLive) {
      const r = this.seekableRange;
      if (!r) return;
      this.video.currentTime = Math.max(r.start, Math.min(r.end - 1, this.video.currentTime + delta));
      return;
    }
    this.seek(this.currentTime + delta);
  }

  /** Seconds behind the live edge (live HLS only). */
  get behindLive(): number {
    if (!this.isLive) return 0;
    if (this.hls && this.hls.liveSyncPosition) return Math.max(0, this.hls.liveSyncPosition - this.video.currentTime);
    const r = this.seekableRange;
    return r ? Math.max(0, r.end - this.video.currentTime) : 0;
  }

  goLive(): void {
    if (this.hls?.liveSyncPosition) this.video.currentTime = this.hls.liveSyncPosition;
    else {
      const r = this.seekableRange;
      if (r) this.video.currentTime = r.end - 2;
    }
    void this.video.play();
  }

  // ------------------------------------------------------------------ tracks
  audioTracks(): TrackInfo[] {
    if (this.hls) return this.hls.audioTracks.map((t, i) => ({ id: i, label: t.name || t.lang || `Track ${i + 1}`, lang: t.lang }));
    const native = (this.video as HTMLVideoElement & { audioTracks?: { length: number; [i: number]: { label: string; language: string; enabled: boolean } } }).audioTracks;
    if (native && native.length > 1) {
      return Array.from({ length: native.length }, (_, i) => ({ id: i, label: native[i].label || native[i].language || `Track ${i + 1}`, lang: native[i].language }));
    }
    return [];
  }

  currentAudioTrack(): number {
    if (this.hls) return this.hls.audioTrack;
    const native = (this.video as HTMLVideoElement & { audioTracks?: { length: number; [i: number]: { enabled: boolean } } }).audioTracks;
    if (native) for (let i = 0; i < native.length; i++) if (native[i].enabled) return i;
    return -1;
  }

  setAudioTrack(id: number): void {
    if (this.hls) {
      this.hls.audioTrack = id;
      return;
    }
    const native = (this.video as HTMLVideoElement & { audioTracks?: { length: number; [i: number]: { enabled: boolean } } }).audioTracks;
    if (native) for (let i = 0; i < native.length; i++) native[i].enabled = i === id;
  }

  subtitleTracks(): TrackInfo[] {
    if (this.hls) return this.hls.subtitleTracks.map((t, i) => ({ id: i, label: t.name || t.lang || `Subtitle ${i + 1}`, lang: t.lang }));
    const tt = this.video.textTracks;
    const out: TrackInfo[] = [];
    for (let i = 0; i < tt.length; i++) if (tt[i].kind === 'subtitles' || tt[i].kind === 'captions') out.push({ id: i, label: tt[i].label || tt[i].language || `Subtitle ${i + 1}`, lang: tt[i].language });
    return out;
  }

  currentSubtitle(): number {
    if (this.hls) return this.hls.subtitleDisplay ? this.hls.subtitleTrack : -1;
    const tt = this.video.textTracks;
    for (let i = 0; i < tt.length; i++) if (tt[i].mode === 'showing') return i;
    return -1;
  }

  setSubtitle(id: number): void {
    if (this.hls) {
      this.hls.subtitleTrack = id;
      this.hls.subtitleDisplay = id >= 0;
      return;
    }
    const tt = this.video.textTracks;
    for (let i = 0; i < tt.length; i++) tt[i].mode = i === id ? 'showing' : 'disabled';
  }

  levels(): TrackInfo[] {
    if (!this.hls) return [];
    return this.hls.levels.map((l: Level, i) => ({ id: i, label: l.height ? `${l.height}p${l.bitrate ? ` · ${Math.round(l.bitrate / 1000)} kbps` : ''}` : `${Math.round((l.bitrate || 0) / 1000)} kbps` }));
  }

  currentLevel(): number {
    return this.hls ? (this.hls.autoLevelEnabled ? -1 : this.hls.currentLevel) : -1;
  }

  setLevel(id: number): void {
    if (this.hls) this.hls.currentLevel = id;
  }

  private applyPreferredTracks(): void {
    if (!this.hls) return;
    const al = this.opts.preferredAudioLang?.toLowerCase();
    if (al) {
      const i = this.hls.audioTracks.findIndex((t) => t.lang?.toLowerCase().startsWith(al));
      if (i >= 0) this.hls.audioTrack = i;
    }
    const sl = this.opts.preferredSubLang?.toLowerCase();
    if (sl) {
      const i = this.hls.subtitleTracks.findIndex((t) => t.lang?.toLowerCase().startsWith(sl));
      if (i >= 0) {
        this.hls.subtitleTrack = i;
        this.hls.subtitleDisplay = true;
      }
    }
  }

  // ------------------------------------------------------------------- stats
  stats(): EngineStats {
    const v = this.video;
    let bufferSec = 0;
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= v.currentTime + 0.5 && v.buffered.end(i) >= v.currentTime) bufferSec = v.buffered.end(i) - v.currentTime;
    }
    const q = v.getVideoPlaybackQuality?.();
    const s: EngineStats = {
      engine: this.kind,
      resolution: v.videoWidth ? `${v.videoWidth}×${v.videoHeight}` : undefined,
      bufferSec,
      droppedFrames: q?.droppedVideoFrames,
      decodedFrames: q?.totalVideoFrames,
      url: this.current?.url ?? this.req.url,
    };
    if (this.hls) {
      const lvl = this.hls.levels[this.hls.currentLevel];
      if (lvl?.bitrate) s.bitrateKbps = Math.round(lvl.bitrate / 1000);
      if (lvl?.videoCodec) s.videoCodec = lvl.videoCodec;
      if (lvl?.audioCodec) s.audioCodec = lvl.audioCodec;
      s.bandwidthKbps = Math.round(this.hls.bandwidthEstimate / 1000);
      if (this.isLive) s.latencySec = this.hls.latency;
    }
    if (this.ts) {
      const mi = this.ts.mediaInfo as Mpegts.MSEPlayerMediaInfo;
      const si = this.ts.statisticsInfo as Mpegts.MSEPlayerStatisticsInfo;
      if (mi?.videoCodec) s.videoCodec = mi.videoCodec;
      if (mi?.audioCodec) s.audioCodec = mi.audioCodec;
      if (si?.speed) s.bandwidthKbps = Math.round(si.speed * 8);
      if (mi?.videoDataRate || mi?.audioDataRate) s.bitrateKbps = Math.round((mi.videoDataRate ?? 0) + (mi.audioDataRate ?? 0));
    }
    return s;
  }

  // ----------------------------------------------------------------- cleanup
  private teardownPlayers(): void {
    window.clearTimeout(this.retryTimer);
    window.clearTimeout(this.silentCheck);
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.ts) {
      try {
        this.ts.pause();
        this.ts.unload();
        this.ts.detachMediaElement();
        this.ts.destroy();
      } catch {
        /* ignore */
      }
      this.ts = null;
    }
    const v = this.video;
    if (v.getAttribute('src')) {
      v.removeAttribute('src');
      v.load();
    }
  }

  destroy(): void {
    this.destroyed = true;
    window.clearInterval(this.watchdog);
    this.teardownPlayers();
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
  }
}
