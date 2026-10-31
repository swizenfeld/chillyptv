import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft, AudioLines, Check, Captions, ChevronDown, ChevronUp, Circle, Copy, ExternalLink, Gauge, Info, Maximize, Minimize, Moon, Pause,
  PictureInPicture2, Play, RefreshCw, Rewind, FastForward, Settings2, SkipForward, Volume1, Volume2, VolumeX, Radio, ListVideo, Download,
} from 'lucide-react';
import { PlaybackEngine, type EngineKind, type EngineStats, type EngineStatus } from './engine';
import { useSettings, type AspectMode } from '../store/settings';
import { useLibrary } from '../store/library';
import { useActiveProfile } from '../store/profiles';
import { useChannelProgrammes, nowNext } from '../store/epg';
import { backendHealth, recordingsApi } from '../lib/api';
import { formatClock, formatDuration } from '../lib/format';
import { toast } from '../store/toast';
import type { PlaySession } from '../store/player';
import type { Channel } from '../lib/types';
import { Img, ProgressBar } from '../components/ui';

export interface VideoPlayerProps {
  session: PlaySession;
  variant: 'full' | 'preview' | 'tile';
  muted?: boolean;
  channel?: Channel;
  onClose?: () => void;
  onZap?: (dir: 1 | -1) => void;
  onZapTo?: (num: number) => void;
  onPrevChannel?: () => void;
  onNext?: () => void;
  onExpand?: () => void;
  onToggleChannelList?: () => void;
  sidePanel?: ReactNode;
  tileActions?: ReactNode;
  /** Extra buttons in the top bar (full player). */
  topActions?: ReactNode;
  /** Playback has failed for good (after the engine's own retries and fallbacks). */
  onFatal?: (message: string) => void;
}

const ENGINE_LABEL: Record<EngineKind, string> = { hls: 'HLS (hls.js)', mpegts: 'MPEG-TS (mpegts.js)', native: 'Native', remux: 'Server remux (ffmpeg)' };
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const ASPECTS: { value: AspectMode; label: string }[] = [
  { value: 'contain', label: 'Fit' },
  { value: 'cover', label: 'Zoom / crop' },
  { value: 'fill', label: 'Stretch' },
  { value: '16:9', label: '16:9' },
  { value: '4:3', label: '4:3' },
];
const SLEEP_OPTIONS = [0, 15, 30, 45, 60, 90, 120];

type MenuPage = 'root' | 'audio' | 'subs' | 'quality' | 'aspect' | 'speed' | 'sleep' | 'engine';

export function VideoPlayer(props: VideoPlayerProps) {
  const { session, variant, channel } = props;
  const req = session.req;
  const full = variant === 'full';
  const profile = useActiveProfile();
  const settings = useSettings();
  const setSettings = useSettings((s) => s.set);
  const recordProgress = useLibrary((s) => s.recordProgress);

  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<PlaybackEngine | null>(null);
  const [status, setStatus] = useState<EngineStatus>('loading');
  const [detail, setDetail] = useState<string | undefined>();
  const [engineKind, setEngineKind] = useState<EngineKind | null>(null);
  const [tracksVersion, setTracksVersion] = useState(0);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(NaN);
  const [behindLive, setBehindLive] = useState(0);
  const [seekRange, setSeekRange] = useState<{ start: number; end: number } | null>(null);
  const [controls, setControls] = useState(true);
  const [menu, setMenu] = useState<MenuPage | null>(null);
  const [showStats, setShowStats] = useState(settings.showStats);
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [aspect, setAspect] = useState<AspectMode>(settings.defaultAspect);
  const [speed, setSpeed] = useState(1);
  const [sleepAt, setSleepAt] = useState<number | null>(null);
  const [digits, setDigits] = useState('');
  const [showInfo, setShowInfo] = useState(false);
  const [nextCountdown, setNextCountdown] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const hideTimer = useRef<number | undefined>(undefined);
  const lastPos = useRef<{ t: number; d: number }>({ t: 0, d: NaN });
  const muted = props.muted ?? settings.muted;

  // ------------------------------------------------------------- engine life
  useEffect(() => {
    const video = videoRef.current!;
    setStatus('loading');
    setDetail(undefined);
    setTime(0);
    setDuration(req.duration ?? NaN);
    setNextCountdown(null);
    const s = useSettings.getState();
    const engine = new PlaybackEngine(
      video,
      req,
      {
        liveBufferSec: s.liveBufferSec,
        autoReconnect: s.autoReconnect,
        preferRemux: s.preferRemux,
        preferredAudioLang: s.preferredAudioLang,
        preferredSubLang: s.preferredSubLang,
        onStatus: (st, d) => {
          setStatus(st);
          setDetail(d);
        },
        onTracks: () => setTracksVersion((v) => v + 1),
        onEngine: (k) => setEngineKind(k),
        quickFailover: s.autoFailover && (session.alternates?.all.length ?? 0) > 1,
      },
      session.seekUrl,
    );
    engineRef.current = engine;
    void engine.start();
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req.url, req.startAt, session]);

  // volume / mute
  useEffect(() => {
    const v = videoRef.current!;
    v.muted = muted;
    if (variant !== 'tile') v.volume = settings.volume;
  }, [muted, settings.volume, variant]);

  useEffect(() => {
    const v = videoRef.current!;
    v.playbackRate = speed;
  }, [speed, engineKind]);

  // time updates
  useEffect(() => {
    const t = window.setInterval(() => {
      const e = engineRef.current;
      if (!e) return;
      setTime(e.currentTime);
      setDuration(e.duration);
      if (e.currentTime > 0) lastPos.current = { t: e.currentTime, d: e.duration };
      if (e.isLive) {
        setBehindLive(e.behindLive);
        setSeekRange(e.canSeek ? e.seekableRange : null);
      }
      if (showStats) setStats(e.stats());
    }, 500);
    return () => window.clearInterval(t);
  }, [showStats]);

  // progress → library (resume + continue watching)
  useEffect(() => {
    if (!profile || !session.history || variant === 'tile') return;
    const h = session.history;
    if (h.kind === 'live') {
      recordProgress(profile.id, { ...h, position: 0, duration: 0 });
      useLibrary.getState().pushChannel(profile.id, h.id);
      return;
    }
    lastPos.current = { t: 0, d: NaN };
    const save = () => {
      const e = engineRef.current;
      // The engine may already be destroyed on unmount; fall back to the last sampled position.
      const t = e ? e.currentTime : lastPos.current.t;
      const d = e ? e.duration : lastPos.current.d;
      if (t < 5) return;
      recordProgress(profile.id, { ...h, position: t, duration: Number.isFinite(d) ? d : 0 });
    };
    const t = window.setInterval(save, 5000);
    return () => {
      window.clearInterval(t);
      save();
    };
  }, [profile, session, variant, recordProgress]);

  // permanent failure → let the page switch to another feed
  const onFatalRef = useRef(props.onFatal);
  onFatalRef.current = props.onFatal;
  useEffect(() => {
    if (status === 'error') onFatalRef.current?.(detail ?? 'Playback failed');
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // autoplay next episode
  useEffect(() => {
    if (status !== 'ended' || !full) return;
    if (session.next && props.onNext && settings.autoplayNext) setNextCountdown(10);
  }, [status, full, session.next, props.onNext, settings.autoplayNext]);
  useEffect(() => {
    if (nextCountdown === null) return;
    if (nextCountdown <= 0) {
      setNextCountdown(null);
      props.onNext?.();
      return;
    }
    const t = window.setTimeout(() => setNextCountdown((n) => (n === null ? null : n - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [nextCountdown, props]);

  // sleep timer
  useEffect(() => {
    if (!sleepAt) return;
    const t = window.setInterval(() => {
      if (Date.now() >= sleepAt) {
        videoRef.current?.pause();
        setSleepAt(null);
        toast.info('Sleep timer: playback stopped');
        props.onClose?.();
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, [sleepAt, props]);

  // fullscreen state
  useEffect(() => {
    const on = () => setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  // ------------------------------------------------------------ helpers
  const poke = useCallback(() => {
    setControls(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!videoRef.current?.paused) {
        setControls(false);
        setMenu(null);
      }
    }, 3500);
  }, []);
  useEffect(() => {
    poke();
    return () => window.clearTimeout(hideTimer.current);
  }, [poke, req.url]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current!;
    if (status === 'error') {
      engineRef.current?.retry();
      return;
    }
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  }, [status]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.().catch(() => {});
  }, []);

  const togglePip = useCallback(async () => {
    const v = videoRef.current!;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch {
      toast.error('Picture-in-picture is not available for this stream');
    }
  }, []);

  const setVolume = (vol: number) => setSettings({ volume: Math.max(0, Math.min(1, vol)), muted: vol <= 0 ? true : false });
  const toggleMute = () => setSettings({ muted: !settings.muted });

  const { list: programmes } = useChannelProgrammes(profile, req.kind === 'live' ? channel : undefined);
  const nn = useMemo(() => nowNext(programmes), [programmes, time]); // eslint-disable-line react-hooks/exhaustive-deps

  const startRecording = async () => {
    if (!backendHealth()?.recordings) return toast.error('Recording needs the ChillyPTV server with ffmpeg');
    setRecording(true);
    try {
      const end = nn.now ? nn.now.end : Date.now() + 60 * 60_000;
      await recordingsApi.create({ url: req.url, title: nn.now?.title ?? req.title, channel: req.title, logo: req.logo, end: Math.max(end, Date.now() + 5 * 60_000), userAgent: req.userAgent });
      toast.success(`Recording "${nn.now?.title ?? req.title}" until ${formatClock(end, settings.clock24)}`);
    } catch (e) {
      toast.error(`Could not start recording: ${(e as Error).message}`);
    } finally {
      setRecording(false);
    }
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(req.url);
      toast.success('Stream URL copied');
    } catch {
      window.prompt('Stream URL', req.url);
    }
  };

  const downloadM3u = () => {
    const blob = new Blob([`#EXTM3U\n#EXTINF:-1,${req.title}\n${req.userAgent ? `#EXTVLCOPT:http-user-agent=${req.userAgent}\n` : ''}${req.url}\n`], { type: 'audio/x-mpegurl' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${req.title.replace(/[^\w\- ]+/g, '').trim() || 'stream'}.m3u`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // ------------------------------------------------------------ keyboard
  // Number-zap state lives in refs: the key handler below is re-subscribed on
  // re-renders, and digits typed across one must not be lost or cancelled.
  const zapBuffer = useRef('');
  const zapTimer = useRef<number | undefined>(undefined);
  const onZapToRef = useRef(props.onZapTo);
  onZapToRef.current = props.onZapTo;
  useEffect(() => () => window.clearTimeout(zapTimer.current), []);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const v = videoRef.current!;
      const engine = engineRef.current;
      poke();
      switch (e.key) {
        case ' ':
        case 'k':
        case 'MediaPlayPause':
          e.preventDefault();
          togglePlay();
          break;
        case 'f':
          toggleFullscreen();
          break;
        case 'm':
          toggleMute();
          break;
        case 'p':
          void togglePip();
          break;
        case 's':
          setShowStats((x) => !x);
          break;
        case 'i':
          setShowInfo((x) => !x);
          break;
        case 'c':
        case 'Enter':
          if (req.kind === 'live' && props.onToggleChannelList && !(e.key === 'Enter' && target.closest('button, a'))) {
            e.preventDefault();
            props.onToggleChannelList();
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          engine?.seekBy(-10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          engine?.seekBy(10);
          break;
        case 'j':
          engine?.seekBy(-30);
          break;
        case 'l':
          engine?.seekBy(30);
          break;
        case 'ArrowUp':
        case 'PageUp':
        case 'ChannelUp':
          if (req.kind === 'live' && props.onZap) {
            e.preventDefault();
            props.onZap(-1);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setVolume(v.volume + 0.1);
          }
          break;
        case 'ArrowDown':
        case 'PageDown':
        case 'ChannelDown':
          if (req.kind === 'live' && props.onZap) {
            e.preventDefault();
            props.onZap(1);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setVolume(v.volume - 0.1);
          }
          break;
        case '+':
        case '=':
          setVolume(v.volume + 0.1);
          break;
        case '-':
          setVolume(v.volume - 0.1);
          break;
        case 'Backspace':
        case 'b':
          if (req.kind === 'live' && props.onPrevChannel) {
            e.preventDefault();
            props.onPrevChannel();
          }
          break;
        case 'n':
          if (session.next && props.onNext) props.onNext();
          break;
        case 'Escape':
          if (menu) setMenu(null);
          else if (!document.fullscreenElement) props.onClose?.();
          break;
        default:
          if (/^\d$/.test(e.key) && req.kind === 'live' && props.onZapTo) {
            zapBuffer.current = (zapBuffer.current + e.key).slice(-4);
            setDigits(zapBuffer.current);
            window.clearTimeout(zapTimer.current);
            zapTimer.current = window.setTimeout(() => {
              const n = Number(zapBuffer.current);
              zapBuffer.current = '';
              setDigits('');
              if (n) onZapToRef.current?.(n);
            }, 1400);
          }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full, togglePlay, toggleFullscreen, togglePip, poke, props, req.kind, session.next, menu]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show the channel banner briefly when zapping.
  useEffect(() => {
    if (req.kind !== 'live' || !full) return;
    setShowInfo(true);
    const t = window.setTimeout(() => setShowInfo(false), 5000);
    return () => window.clearTimeout(t);
  }, [req.url, req.kind, full]);

  // ------------------------------------------------------------ render
  const engine = engineRef.current;
  const live = req.kind === 'live';
  const paused = videoRef.current?.paused ?? true;
  const audioTracks = useMemo(() => engine?.audioTracks() ?? [], [engine, tracksVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const subTracks = useMemo(() => engine?.subtitleTracks() ?? [], [engine, tracksVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const levels = useMemo(() => engine?.levels() ?? [], [engine, tracksVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const busy = status === 'loading' || status === 'buffering' || status === 'reconnecting';
  const canSeek = !!engine?.canSeek;
  const seekMax = live ? (seekRange ? seekRange.end - seekRange.start : 0) : Number.isFinite(duration) ? duration : 0;
  const seekValue = live ? (seekRange ? Math.max(0, time - seekRange.start) : 0) : time;
  const VolIcon = muted || settings.volume === 0 ? VolumeX : settings.volume < 0.5 ? Volume1 : Volume2;

  const videoStyle: React.CSSProperties =
    aspect === '16:9' || aspect === '4:3'
      ? { objectFit: 'fill', width: `min(100cqw, 100cqh * ${aspect === '16:9' ? '16 / 9' : '4 / 3'})`, height: `min(100cqh, 100cqw * ${aspect === '16:9' ? '9 / 16' : '3 / 4'})` }
      : { objectFit: aspect, width: '100%', height: '100%' };

  return (
    <div
      ref={rootRef}
      className={`player player-${variant} ${controls || paused || status === 'error' ? 'show-controls' : 'hide-cursor'}`}
      onMouseMove={poke}
      onTouchStart={poke}
      onClick={(e) => {
        if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('player-surface')) return;
        if (variant === 'preview') props.onExpand?.();
        else if (variant === 'full') togglePlay();
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('.player-controls, .player-top, .player-menu')) return;
        if (variant === 'full') toggleFullscreen();
      }}
      data-status={status}
      data-engine={engineKind ?? ''}
    >
      <div className="player-surface">
        <video ref={videoRef} playsInline style={videoStyle} />
      </div>

      {busy && (
        <div className="player-center">
          <div className="spinner big" />
          {status === 'reconnecting' && <div className="player-msg">{detail ?? 'Reconnecting…'}</div>}
        </div>
      )}

      {status === 'error' && (
        <div className="player-center player-error">
          <h3>Playback failed</h3>
          <p>{detail}</p>
          {variant !== 'tile' && (
            <div className="row gap wrap center">
              <button className="btn primary" onClick={() => engine?.retry()}>
                <RefreshCw size={16} /> Retry
              </button>
              {backendHealth()?.ffmpeg && engineKind !== 'remux' && (
                <button className="btn" onClick={() => engine?.switchTo('remux')}>
                  Try server remux
                </button>
              )}
              <button className="btn" onClick={copyUrl}>
                <Copy size={16} /> Copy URL
              </button>
            </div>
          )}
        </div>
      )}

      {digits && <div className="zap-digits">{digits}</div>}

      {nextCountdown !== null && (
        <div className="next-up">
          <div>Next episode in {nextCountdown}s</div>
          <div className="row gap">
            <button className="btn primary" onClick={() => props.onNext?.()}>
              <SkipForward size={16} /> Play now
            </button>
            <button className="btn" onClick={() => setNextCountdown(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {showStats && stats && (
        <div className="stats-overlay">
          <div><b>Engine</b> {ENGINE_LABEL[stats.engine]}</div>
          {stats.resolution && <div><b>Resolution</b> {stats.resolution}</div>}
          {stats.videoCodec && <div><b>Codecs</b> {stats.videoCodec}{stats.audioCodec ? ` / ${stats.audioCodec}` : ''}</div>}
          {stats.bitrateKbps !== undefined && <div><b>Bitrate</b> {stats.bitrateKbps} kbps</div>}
          {stats.bandwidthKbps !== undefined && <div><b>Bandwidth</b> {stats.bandwidthKbps} kbps</div>}
          <div><b>Buffer</b> {stats.bufferSec.toFixed(1)} s</div>
          {stats.latencySec !== undefined && Number.isFinite(stats.latencySec) && <div><b>Latency</b> {stats.latencySec.toFixed(1)} s</div>}
          {stats.droppedFrames !== undefined && <div><b>Dropped</b> {stats.droppedFrames} / {stats.decodedFrames}</div>}
        </div>
      )}

      {variant === 'tile' && <div className="tile-bar">{props.tileActions}</div>}

      {variant !== 'tile' && (
        <>
          <div className="player-top">
            {full && props.onClose && (
              <button className="icon-btn" onClick={props.onClose} aria-label="Back">
                <ArrowLeft size={22} />
              </button>
            )}
            {req.logo && full && <Img src={req.logo} alt={req.title} className="player-logo" />}
            <div className="player-title">
              <div className="t1">{req.title}</div>
              {(req.subtitle || (live && nn.now)) && <div className="t2">{req.subtitle ?? nn.now?.title}</div>}
            </div>
            <div className="spacer" />
            {sleepAt && (
              <span className="chip">
                <Moon size={14} /> {Math.ceil((sleepAt - Date.now()) / 60000)} min
              </span>
            )}
            {full && props.topActions}
            {full && live && backendHealth()?.recordings && (
              <button className="btn small danger-ghost" onClick={startRecording} disabled={recording} title="Record (server)">
                <Circle size={14} fill="currentColor" /> Rec
              </button>
            )}
            {full && live && props.onToggleChannelList && (
              <button className="icon-btn" onClick={props.onToggleChannelList} title="Channel list (C)">
                <ListVideo size={20} />
              </button>
            )}
            {variant === 'preview' && props.onExpand && (
              <button className="icon-btn" onClick={props.onExpand} title="Full screen">
                <Maximize size={18} />
              </button>
            )}
          </div>

          {live && full && showInfo && channel && (
            <div className="live-banner">
              <Img src={channel.logo} alt={channel.name} className="banner-logo" />
              <div className="banner-body">
                <div className="banner-ch">
                  <span className="ch-num">{channel.num}</span> {channel.name}
                </div>
                {nn.now ? (
                  <>
                    <div className="banner-now">
                      <span className="time">{formatClock(nn.now.start, settings.clock24)} – {formatClock(nn.now.end, settings.clock24)}</span> {nn.now.title}
                    </div>
                    <ProgressBar value={(Date.now() - nn.now.start) / (nn.now.end - nn.now.start)} />
                    {nn.now.desc && <div className="banner-desc">{nn.now.desc}</div>}
                  </>
                ) : (
                  <div className="banner-now muted">No programme information</div>
                )}
                {nn.next && (
                  <div className="banner-next">
                    Next: <span className="time">{formatClock(nn.next.start, settings.clock24)}</span> {nn.next.title}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="player-controls" onClick={(e) => e.stopPropagation()}>
            {(canSeek || !live) && (
              <SeekBar
                value={seekValue}
                max={seekMax}
                disabled={!canSeek}
                onSeek={(v) => {
                  if (!engine) return;
                  if (live && seekRange) engine.seek(seekRange.start + v);
                  else engine.seek(v);
                }}
              />
            )}
            <div className="controls-row">
              <button className="icon-btn" onClick={togglePlay} aria-label={paused ? 'Play' : 'Pause'}>
                {paused ? <Play size={22} fill="currentColor" /> : <Pause size={22} fill="currentColor" />}
              </button>
              {canSeek && (
                <>
                  <button className="icon-btn seek-step optional-control" onClick={() => engine?.seekBy(-10)} aria-label="Back 10 seconds">
                    <Rewind size={20} />
                  </button>
                  <button className="icon-btn seek-step optional-control" onClick={() => engine?.seekBy(10)} aria-label="Forward 10 seconds">
                    <FastForward size={20} />
                  </button>
                </>
              )}
              {live && full && props.onZap && (
                <>
                  <button className="icon-btn" onClick={() => props.onZap?.(-1)} aria-label="Previous channel" title="Channel up (↑)">
                    <ChevronUp size={20} />
                  </button>
                  <button className="icon-btn" onClick={() => props.onZap?.(1)} aria-label="Next channel" title="Channel down (↓)">
                    <ChevronDown size={20} />
                  </button>
                </>
              )}
              {session.next && props.onNext && full && (
                <button className="icon-btn" onClick={props.onNext} aria-label="Next episode" title="Next episode (N)">
                  <SkipForward size={20} />
                </button>
              )}
              <div className="volume">
                <button className="icon-btn" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
                  <VolIcon size={20} />
                </button>
                <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : settings.volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Volume" />
              </div>
              {live ? (
                <button className={`live-badge ${behindLive > 8 ? 'behind' : ''}`} onClick={() => engine?.goLive()} title="Jump to live">
                  <Radio size={14} /> {behindLive > 8 ? `-${formatDuration(behindLive)}` : 'LIVE'}
                </button>
              ) : (
                <span className="time-label">
                  {formatDuration(time)} / {formatDuration(duration)}
                </span>
              )}
              <div className="spacer" />
              {subTracks.length > 0 && (
                <button className="icon-btn" onClick={() => setMenu(menu === 'subs' ? null : 'subs')} aria-label="Subtitles">
                  <Captions size={20} />
                </button>
              )}
              {audioTracks.length > 1 && (
                <button className="icon-btn" onClick={() => setMenu(menu === 'audio' ? null : 'audio')} aria-label="Audio track">
                  <AudioLines size={20} />
                </button>
              )}
              <button className="icon-btn" onClick={() => setMenu(menu ? null : 'root')} aria-label="Settings">
                <Settings2 size={20} />
              </button>
              {full && (
                <button className={`icon-btn optional-control ${showStats ? 'active' : ''}`} onClick={() => setShowStats((x) => !x)} aria-label="Stream stats" aria-pressed={showStats} title="Stats (S)">
                  <Gauge size={20} />
                </button>
              )}
              {live && full && (
                <button className={`icon-btn optional-control ${showInfo ? 'active' : ''}`} onClick={() => setShowInfo((x) => !x)} aria-label="Programme info" aria-pressed={showInfo} title="Info (I)">
                  <Info size={20} />
                </button>
              )}
              {'pictureInPictureEnabled' in document && (
                <button className="icon-btn" onClick={togglePip} aria-label="Picture in picture" title="Picture-in-picture (P)">
                  <PictureInPicture2 size={20} />
                </button>
              )}
              <button className="icon-btn" onClick={variant === 'preview' && props.onExpand ? props.onExpand : toggleFullscreen} aria-label="Fullscreen" title="Fullscreen (F)">
                {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
              </button>
            </div>
          </div>

          {menu && (
            <div className="player-menu" onClick={(e) => e.stopPropagation()}>
              {menu === 'root' && (
                <>
                  {levels.length > 1 && <MenuItem label="Quality" value={engine?.currentLevel() === -1 ? 'Auto' : levels[engine?.currentLevel() ?? 0]?.label} onClick={() => setMenu('quality')} />}
                  {audioTracks.length > 1 && <MenuItem label="Audio" value={audioTracks[engine?.currentAudioTrack() ?? 0]?.label} onClick={() => setMenu('audio')} />}
                  {subTracks.length > 0 && <MenuItem label="Subtitles" value={subTracks.find((t) => t.id === engine?.currentSubtitle())?.label ?? 'Off'} onClick={() => setMenu('subs')} />}
                  <MenuItem label="Aspect ratio" value={ASPECTS.find((a) => a.value === aspect)?.label} onClick={() => setMenu('aspect')} />
                  {!live && <MenuItem label="Speed" value={`${speed}×`} onClick={() => setMenu('speed')} />}
                  <MenuItem label="Sleep timer" value={sleepAt ? `${Math.ceil((sleepAt - Date.now()) / 60000)} min` : 'Off'} onClick={() => setMenu('sleep')} />
                  <MenuItem label="Playback engine" value={engineKind ? ENGINE_LABEL[engineKind] : '…'} onClick={() => setMenu('engine')} />
                  <div className="menu-sep" />
                  <button className="menu-row" onClick={copyUrl}>
                    <Copy size={16} /> Copy stream URL
                  </button>
                  <button className="menu-row" onClick={downloadM3u}>
                    <Download size={16} /> Open in external player (.m3u)
                  </button>
                  <a className="menu-row" href={`vlc://${req.url}`}>
                    <ExternalLink size={16} /> Open in VLC
                  </a>
                </>
              )}
              {menu === 'quality' && (
                <SubMenu title="Quality" onBack={() => setMenu('root')} items={[{ id: -1, label: 'Auto' }, ...levels]} current={engine?.currentLevel() ?? -1} onPick={(id) => { engine?.setLevel(id); setTracksVersion((v) => v + 1); setMenu(null); }} />
              )}
              {menu === 'audio' && (
                <SubMenu title="Audio" onBack={() => setMenu('root')} items={audioTracks} current={engine?.currentAudioTrack() ?? 0} onPick={(id) => { engine?.setAudioTrack(id); setTracksVersion((v) => v + 1); setMenu(null); }} />
              )}
              {menu === 'subs' && (
                <SubMenu title="Subtitles" onBack={() => setMenu('root')} items={[{ id: -1, label: 'Off' }, ...subTracks]} current={engine?.currentSubtitle() ?? -1} onPick={(id) => { engine?.setSubtitle(id); setTracksVersion((v) => v + 1); setMenu(null); }} />
              )}
              {menu === 'aspect' && (
                <SubMenu title="Aspect ratio" onBack={() => setMenu('root')} items={ASPECTS.map((a, i) => ({ id: i, label: a.label }))} current={ASPECTS.findIndex((a) => a.value === aspect)} onPick={(id) => { setAspect(ASPECTS[id].value); setMenu(null); }} />
              )}
              {menu === 'speed' && (
                <SubMenu title="Speed" onBack={() => setMenu('root')} items={SPEEDS.map((s, i) => ({ id: i, label: `${s}×` }))} current={SPEEDS.indexOf(speed)} onPick={(id) => { setSpeed(SPEEDS[id]); setMenu(null); }} />
              )}
              {menu === 'sleep' && (
                <SubMenu title="Sleep timer" onBack={() => setMenu('root')} items={SLEEP_OPTIONS.map((m, i) => ({ id: i, label: m ? `${m} minutes` : 'Off' }))} current={sleepAt ? -2 : 0} onPick={(id) => { const m = SLEEP_OPTIONS[id]; setSleepAt(m ? Date.now() + m * 60_000 : null); if (m) toast.info(`Playback will stop in ${m} minutes`); setMenu(null); }} />
              )}
              {menu === 'engine' && engine && (
                <SubMenu
                  title="Playback engine"
                  onBack={() => setMenu('root')}
                  items={engine.availableKinds().map((k, i) => ({ id: i, label: `${ENGINE_LABEL[k.kind]}${k.transcode ? ' + video transcode' : ''}` }))}
                  current={engine.availableKinds().findIndex((k) => k.kind === engineKind && !!k.transcode === !!engine.current?.transcode)}
                  onPick={(id) => {
                    const k = engine.availableKinds()[id];
                    engine.switchTo(k.kind, !!k.transcode);
                    setMenu(null);
                  }}
                />
              )}
            </div>
          )}
        </>
      )}
      {props.sidePanel}
    </div>
  );
}

function MenuItem({ label, value, onClick }: { label: string; value?: string; onClick: () => void }) {
  return (
    <button className="menu-row" onClick={onClick}>
      <span>{label}</span>
      <span className="menu-value">{value}</span>
    </button>
  );
}

function SubMenu({ title, items, current, onPick, onBack }: { title: string; items: { id: number; label: string }[]; current: number; onPick: (id: number) => void; onBack: () => void }) {
  return (
    <>
      <button className="menu-row menu-title" onClick={onBack}>
        <ArrowLeft size={16} /> {title}
      </button>
      <div className="menu-scroll">
        {items.map((it) => (
          <button key={it.id} className={`menu-row ${it.id === current ? 'selected' : ''}`} aria-checked={it.id === current} role="menuitemradio" onClick={() => onPick(it.id)}>
            {it.label}
            {it.id === current && <Check size={16} className="menu-check" aria-hidden />}
          </button>
        ))}
      </div>
    </>
  );
}

function SeekBar({ value, max, onSeek, disabled }: { value: number; max: number; onSeek: (v: number) => void; disabled?: boolean }) {
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const pct = max > 0 ? ((drag ?? value) / max) * 100 : 0;
  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * max;
  };
  return (
    <div
      ref={ref}
      className={`seekbar ${disabled ? 'disabled' : ''}`}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      tabIndex={-1}
      onPointerDown={(e) => {
        if (disabled || !max) return;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        setDrag(at(e.clientX));
      }}
      onPointerMove={(e) => {
        if (!max) return;
        const t = at(e.clientX);
        setHover({ x: (t / max) * 100, t });
        if (drag !== null) setDrag(t);
      }}
      onPointerLeave={() => setHover(null)}
      onPointerUp={(e) => {
        if (drag === null) return;
        onSeek(at(e.clientX));
        setDrag(null);
      }}
    >
      <div className="seek-track">
        <div className="seek-fill" style={{ width: `${pct}%` }} />
        <div className="seek-thumb" style={{ left: `${pct}%` }} />
      </div>
      {hover && !disabled && (
        <div className="seek-hover" style={{ left: `${hover.x}%` }}>
          {formatDuration(hover.t)}
        </div>
      )}
    </div>
  );
}
