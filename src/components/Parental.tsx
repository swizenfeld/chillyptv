import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Modal } from './ui';
import { isCategoryLocked, isUnlocked, setUnlocked, useSettings } from '../store/settings';

interface ParentalCtx {
  /** Runs `fn` immediately, or after the PIN was entered if the category is locked. */
  guard: (categoryId: string, categoryName: string, fn: () => void) => void;
  locked: (categoryId: string, categoryName: string) => boolean;
  requestPin: (fn: () => void, reason?: string) => void;
}

const Ctx = createContext<ParentalCtx | null>(null);

export function ParentalProvider({ children }: { children: ReactNode }) {
  const settings = useSettings();
  const [pending, setPending] = useState<{ fn: () => void; reason?: string } | null>(null);
  const [, force] = useState(0);

  const locked = useCallback((id: string, name: string) => !isUnlocked() && isCategoryLocked(settings, id, name), [settings]);
  const requestPin = useCallback((fn: () => void, reason?: string) => setPending({ fn, reason }), []);
  const guard = useCallback(
    (id: string, name: string, fn: () => void) => {
      if (locked(id, name)) setPending({ fn, reason: `"${name}" is protected` });
      else fn();
    },
    [locked],
  );

  return (
    <Ctx.Provider value={{ guard, locked, requestPin }}>
      {children}
      {pending && (
        <PinDialog
          reason={pending.reason}
          onCancel={() => setPending(null)}
          onSuccess={() => {
            setUnlocked(true);
            force((n) => n + 1);
            const fn = pending.fn;
            setPending(null);
            fn();
          }}
        />
      )}
    </Ctx.Provider>
  );
}

export function useParental(): ParentalCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('ParentalProvider missing');
  return c;
}

function PinDialog({ reason, onCancel, onSuccess }: { reason?: string; onCancel: () => void; onSuccess: () => void }) {
  const pin = useSettings((s) => s.pin);
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const submit = (v: string) => {
    if (v === pin) onSuccess();
    else {
      setError(true);
      setValue('');
    }
  };
  return (
    <Modal title={<><Lock size={18} /> Parental lock</>} onClose={onCancel}>
      <p className="muted">{reason ?? 'This content is protected.'} Enter your PIN to continue (unlocks for this session).</p>
      <input
        className={`input pin-input ${error ? 'invalid' : ''}`}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={8}
        value={value}
        aria-label="PIN"
        onChange={(e) => {
          setError(false);
          const v = e.target.value.replace(/\D/g, '');
          setValue(v);
          if (pin && v.length === pin.length) submit(v);
        }}
        onKeyDown={(e) => e.key === 'Enter' && submit(value)}
      />
      {error && <p className="error-text">Wrong PIN</p>}
    </Modal>
  );
}
