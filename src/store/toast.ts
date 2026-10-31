import { create } from 'zustand';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
  action?: { label: string; run: () => void };
  timeout?: number;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>) => number;
  dismiss: (id: number) => void;
}

let seq = 1;
export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = seq++;
    set({ toasts: [...get().toasts, { ...t, id }] });
    const timeout = t.timeout ?? (t.action ? 10000 : 4000);
    if (timeout > 0) setTimeout(() => get().dismiss(id), timeout);
    return id;
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
}));

export const toast = {
  info: (message: string, action?: Toast['action']) => useToasts.getState().push({ message, kind: 'info', action }),
  success: (message: string) => useToasts.getState().push({ message, kind: 'success' }),
  error: (message: string) => useToasts.getState().push({ message, kind: 'error', timeout: 7000 }),
};
