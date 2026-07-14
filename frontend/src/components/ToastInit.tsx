import { useEffect } from 'react';
import { Toaster, toast } from 'sonner';

function toastFn(msg: string, type = 'success', dur = 3000) {
  const fn = (toast as any)[type] || toast.success;
  fn(msg, { duration: dur });
}

export function ToastInit() {
  useEffect(() => {
    (window as any).__toast = toastFn;
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      toastFn(d.message || '', d.type || 'success', d.duration || 3000);
    };
    window.addEventListener('wm-toast', handler);
    return () => {
      delete (window as any).__toast;
      window.removeEventListener('wm-toast', handler);
    };
  }, []);

  return (
    <Toaster
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{
        style: { fontSize: '13px', padding: '12px 16px', borderRadius: '12px' },
      }}
    />
  );
}
