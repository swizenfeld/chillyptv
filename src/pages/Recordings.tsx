import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarPlus, Circle, Download, Play, Square, Trash2, Video } from 'lucide-react';
import { backendHealth, recordingsApi, type RecordingDto } from '../lib/api';
import { useCatalog } from '../store/catalog';
import { useActiveProfile } from '../store/profiles';
import { usePlayer } from '../store/player';
import { liveRequest } from '../lib/streams';
import { useSettings } from '../store/settings';
import { formatBytes, formatClock, formatDay } from '../lib/format';
import { Empty, Img, Modal, Spinner } from '../components/ui';
import { ChannelPicker } from './MultiView';
import { toast } from '../store/toast';
import type { Channel } from '../lib/types';

const STATUS_LABEL: Record<RecordingDto['status'], string> = {
  scheduled: 'Scheduled',
  recording: 'Recording',
  processing: 'Finishing…',
  completed: 'Ready',
  failed: 'Failed',
  stopped: 'Cancelled',
};

export function RecordingsPage() {
  const [items, setItems] = useState<RecordingDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const clock24 = useSettings((s) => s.clock24);
  const setSession = usePlayer((s) => s.setSession);
  const navigate = useNavigate();
  const health = backendHealth();

  const refresh = useCallback(() => {
    recordingsApi
      .list()
      .then((list) => {
        setItems(list);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!health?.recordings)
    return (
      <Empty icon={<Video size={36} />} title="Recording needs the ChillyPTV server">
        <p>Run the bundled server with ffmpeg installed to record live TV and schedule recordings from the guide. Recordings keep running even when this tab is closed.</p>
      </Empty>
    );
  if (!items && !error) return <Spinner />;

  const playRec = (r: RecordingDto) => {
    setSession({ req: { kind: 'recording', url: recordingsApi.fileUrl(r.id), ext: r.file?.endsWith('.mp4') ? 'mp4' : 'ts', title: r.title, subtitle: `${r.channel ?? ''} · ${formatDay(r.start)}`, logo: r.logo, key: `rec:${r.id}` }, returnTo: '/recordings' });
    navigate('/play');
  };

  return (
    <div className="recordings">
      <div className="row-head">
        <h1>
          <Video size={22} /> Recordings
        </h1>
        <button className="btn primary" onClick={() => setScheduling(true)}>
          <CalendarPlus size={16} /> New recording
        </button>
      </div>
      <p className="muted">Recordings run on your ChillyPTV server, so they continue when the browser is closed. Schedule them from the TV guide or here.</p>
      {error && <div className="error-box">{error}</div>}
      {items && !items.length && <Empty icon={<Video size={36} />} title="No recordings yet">Open a programme in the TV guide and choose “Schedule recording”, or press Rec while watching live TV.</Empty>}
      <ul className="rec-list">
        {items?.map((r) => (
          <li key={r.id} className={`rec-item status-${r.status}`}>
            <Img src={r.logo} alt={r.channel ?? r.title} className="ch-logo" />
            <div className="grow">
              <div className="ch-name">
                {r.status === 'recording' && <Circle size={10} fill="currentColor" className="rec-dot" />} {r.title}
              </div>
              <div className="muted small">
                {r.channel} · {formatDay(r.start)} {formatClock(r.start, clock24)}–{formatClock(r.end, clock24)} · <b>{STATUS_LABEL[r.status]}</b>
                {r.size ? ` · ${formatBytes(r.size)}` : ''}
                {r.error && r.status === 'failed' ? ` · ${r.error}` : ''}
              </div>
            </div>
            {r.status === 'completed' && (
              <>
                <button className="btn small primary" onClick={() => playRec(r)}>
                  <Play size={14} fill="currentColor" /> Play
                </button>
                <a className="icon-btn" href={recordingsApi.fileUrl(r.id, true)} download aria-label="Download">
                  <Download size={16} />
                </a>
              </>
            )}
            {(r.status === 'recording' || r.status === 'scheduled') && (
              <button
                className="btn small"
                onClick={async () => {
                  await recordingsApi.stop(r.id).catch((e: Error) => toast.error(e.message));
                  refresh();
                }}
              >
                <Square size={14} /> {r.status === 'recording' ? 'Stop' : 'Cancel'}
              </button>
            )}
            <button
              className="icon-btn"
              aria-label="Delete"
              onClick={async () => {
                if (!confirm(`Delete "${r.title}"?`)) return;
                await recordingsApi.remove(r.id).catch((e: Error) => toast.error(e.message));
                refresh();
              }}
            >
              <Trash2 size={16} />
            </button>
          </li>
        ))}
      </ul>
      {scheduling && <ScheduleDialog onClose={() => setScheduling(false)} onDone={refresh} />}
    </div>
  );
}

function toLocalInput(ms: number): string {
  const d = new Date(ms - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

function ScheduleDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const profile = useActiveProfile();
  const index = useCatalog((s) => s.index);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [picking, setPicking] = useState(false);
  const [start, setStart] = useState(toLocalInput(Date.now()));
  const [minutes, setMinutes] = useState(60);
  const [title, setTitle] = useState('');
  if (!profile || !index) return null;
  const submit = async () => {
    if (!channel) return toast.error('Choose a channel');
    try {
      const req = liveRequest(profile, channel);
      const s = new Date(start).getTime();
      await recordingsApi.create({ url: req.url, title: title || channel.name, channel: channel.name, logo: channel.logo, start: s, end: s + minutes * 60_000, userAgent: req.userAgent });
      toast.success('Recording scheduled');
      onDone();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Modal title="New recording" onClose={onClose} footer={<div className="row gap end"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={submit}>Schedule</button></div>}>
      <div className="form">
        <label className="field">
          <span>Channel</span>
          <button className="btn" onClick={() => setPicking(true)}>
            {channel ? channel.name : 'Choose channel…'}
          </button>
        </label>
        <label className="field">
          <span>Title</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional" />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Start</span>
            <input className="input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="field">
            <span>Duration (minutes)</span>
            <input className="input" type="number" min={1} max={720} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </label>
        </div>
      </div>
      {picking && (
        <ChannelPicker
          onClose={() => setPicking(false)}
          onPick={(c) => {
            setChannel(c);
            setPicking(false);
          }}
        />
      )}
    </Modal>
  );
}
