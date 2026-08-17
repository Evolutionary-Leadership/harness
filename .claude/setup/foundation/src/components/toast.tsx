"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * Toasts, the surface for SOFT WARNINGS.
 *
 * A warning the server sends back on the success path (a duplicate that was kept
 * anyway, a third party sync that failed but must not block the local change) is
 * shown here and never as an error state: the write succeeded, and telling the
 * user otherwise would be a lie.
 */

export type ToastTone = "info" | "warning" | "error";
type Toast = { id: string; message: string; tone: ToastTone };

type ToastApi = { show: (message: string, tone?: ToastTone) => void };

const ToastContext = createContext<ToastApi | null>(null);

const TOAST_TTL_MS = 6000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // Clear pending dismiss timers on unmount.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (message: string, tone: ToastTone = "info") => {
      const id = crypto.randomUUID();
      setToasts((current) => [...current, { id, message, tone }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), TOAST_TTL_MS),
      );
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => (
          <output
            key={toast.id}
            className={[
              "pointer-events-auto w-full max-w-md rounded-lg border px-4 py-3 text-sm shadow-lg",
              toast.tone === "error"
                ? "border-red-300 bg-red-50 text-red-900"
                : toast.tone === "warning"
                  ? "border-amber-300 bg-amber-50 text-amber-900"
                  : "border-slate-300 bg-white text-slate-900",
            ].join(" ")}
          >
            <div className="flex items-start justify-between gap-3">
              <span>{toast.message}</span>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="shrink-0 rounded px-1 text-xs underline opacity-70 hover:opacity-100"
              >
                dismiss
              </button>
            </div>
          </output>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside a ToastProvider");
  return context;
}
