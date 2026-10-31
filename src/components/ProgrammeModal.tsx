import { Archive, Bell, BellRing, Circle, Play, Tv } from 'lucide-react';
import { Modal, ProgressBar } from './ui';
import { useActiveProfile } from '../store/profiles';
import { useLibrary } from '../store/library';
import { useSettings } from '../store/settings';
import { usePlay } from '../hooks/usePlay';
import { canCatchup, liveRequest } from '../lib/streams';
import { backendHealth, recordingsApi } from '../lib/api';
import { formatClock, formatDay } from '../lib/format';
import { toast } from '../store/toast';
import type { Channel, Programme } from '../lib/types';

export function ProgrammeModal({ channel, programme: p, onClose, zapList }: { channel: Channel; programme: Programme; onClose: () => void; zapList?: string[] }) {
  const profile = useActiveProfile();
  const clock24 = useSettings((s) => s.clock24);
  const reminders = useLibrary((s) => s.reminders);
  const addReminder = useLibrary((s) => s.addReminder);
  const removeReminder = useLibrary((s) => s.removeReminder);
  const play = usePlay();
  const now = Date.now();
  const isNow = p.start <= now && p.end > now;
  const past = p.end <= now;
  const rid = `${profile?.id}:${channel.id}:${p.start}`;
  const reminderOn = reminders.some((r) => r.id === rid);

  const schedule = async () => {
    if (!profile) return;
    try {
      const req = liveRequest(profile, channel);
      await recordingsApi.create({ url: req.url, title: p.title, channel: channel.name, logo: channel.logo, start: Math.max(now, p.start - 60_000), end: p.end + 2 * 60_000, userAgent: req.userAgent });
      toast.success(isNow ? `Recording "${p.title}"` : `Recording scheduled: ${p.title}`);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Modal title={p.title} onClose={onClose}>
      <div className="prog-meta">
        <span>
          <Tv size={14} /> {channel.name}
        </span>
        <span>
          {formatDay(p.start)} · {formatClock(p.start, clock24)} – {formatClock(p.end, clock24)} ({Math.round((p.end - p.start) / 60000)} min)
        </span>
        {p.category && <span className="chip subtle">{p.category}</span>}
        {p.episode && <span className="chip subtle">{p.episode}</span>}
      </div>
      {isNow && <ProgressBar value={(now - p.start) / (p.end - p.start)} />}
      {p.subtitle && <h4>{p.subtitle}</h4>}
      {p.desc ? <p className="plot">{p.desc}</p> : <p className="muted">No description.</p>}
      <div className="row gap wrap">
        {isNow && (
          <button className="btn primary" onClick={() => play.playChannel(channel, zapList)}>
            <Play size={16} fill="currentColor" /> Watch live
          </button>
        )}
        {isNow && channel.archive && (
          <button className="btn" onClick={() => play.playCatchup(channel, p)}>
            <Archive size={16} /> From the start
          </button>
        )}
        {past && canCatchup(channel, p, now) && (
          <button className="btn primary" onClick={() => play.playCatchup(channel, p)}>
            <Archive size={16} /> Watch catch-up
          </button>
        )}
        {past && !canCatchup(channel, p, now) && <span className="muted">This programme has ended{channel.archive ? ' and is outside the archive window' : ''}.</span>}
        {!past && !isNow && profile && (
          <button
            className={`btn ${reminderOn ? 'active' : ''}`}
            onClick={() => {
              if (reminderOn) removeReminder(rid);
              else {
                if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
                addReminder({ id: rid, profileId: profile.id, channelId: channel.id, channelName: channel.name, title: p.title, start: p.start, end: p.end });
                toast.success('Reminder set');
              }
            }}
          >
            {reminderOn ? <BellRing size={16} /> : <Bell size={16} />} {reminderOn ? 'Reminder set' : 'Remind me'}
          </button>
        )}
        {!past && backendHealth()?.recordings && (
          <button className="btn danger-ghost" onClick={schedule}>
            <Circle size={14} fill="currentColor" /> {isNow ? 'Record now' : 'Schedule recording'}
          </button>
        )}
      </div>
    </Modal>
  );
}
