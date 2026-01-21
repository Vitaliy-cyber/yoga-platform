import React from "react";
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from "lucide-react";
import { cn } from "../../lib/utils";
import { useAppStore } from "../../store/useAppStore";
import { useI18n } from "../../i18n";
import type { Toast } from "../../types";

const toastIcons = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
} as const;

const toastStyles = {
  success: "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300",
  error: "bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300",
  info: "bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300",
  warning: "bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300",
} as const;

const iconStyles = {
  success: "text-emerald-500",
  error: "text-red-500",
  info: "text-blue-500",
  warning: "text-amber-500",
} as const;

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

const ToastItem: React.FC<ToastItemProps> = ({ toast, onDismiss }) => {
  const { t } = useI18n();
  const Icon = toastIcons[toast.type];

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        "flex items-start gap-3 p-4 rounded-xl border shadow-lg animate-in slide-in-from-right-full duration-300",
        toastStyles[toast.type]
      )}
    >
      <Icon className={cn("w-5 h-5 flex-shrink-0 mt-0.5", iconStyles[toast.type])} />
      <p className="flex-1 text-sm font-medium">{toast.message}</p>
      <button
        onClick={() => onDismiss(toast.id)}
        className="flex-shrink-0 p-1 rounded-lg hover:bg-black/5 transition-colors min-h-[32px] min-w-[32px] flex items-center justify-center"
        aria-label={t("aria.dismiss_notification")}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

/**
 * ToastContainer renders all active toast notifications.
 *
 * z-index scale reference:
 * - z-40: Sidebar
 * - z-45: MobileNav hamburger button
 * - z-50: CompareBar
 * - z-60: Sheet overlay
 * - z-61: Sheet content
 * - z-70: Dialog overlay
 * - z-71: Dialog content
 * - z-[100]: Skip link (when focused)
 * - z-[9999]: Toast container (always on top)
 */
export const ToastContainer: React.FC = () => {
  const toasts = useAppStore((state) => state.toasts);
  const removeToast = useAppStore((state) => state.removeToast);
  const { t } = useI18n();

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div
      className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none"
      aria-label={t("aria.notifications")}
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onDismiss={removeToast} />
        </div>
      ))}
    </div>
  );
};

export { ToastItem };
