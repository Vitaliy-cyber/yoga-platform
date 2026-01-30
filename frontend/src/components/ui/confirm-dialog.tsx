import React, { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./dialog";
import { Button } from "./button";
import { Loader2, AlertTriangle, Trash2, Info } from "lucide-react";
import { useViewTransition } from "../../hooks/useViewTransition";

type ConfirmVariant = "danger" | "warning" | "info";

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
  isLoading?: boolean;
}

const variantStyles: Record<ConfirmVariant, { icon: typeof AlertTriangle; iconColor: string; buttonClass: string }> = {
  danger: {
    icon: Trash2,
    iconColor: "text-red-500",
    buttonClass: "bg-red-500 hover:bg-red-600 text-white",
  },
  warning: {
    icon: AlertTriangle,
    iconColor: "text-amber-500",
    buttonClass: "bg-amber-500 hover:bg-amber-600 text-white",
  },
  info: {
    icon: Info,
    iconColor: "text-blue-500",
    buttonClass: "bg-blue-500 hover:bg-blue-600 text-white",
  },
};

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger",
  isLoading = false,
}) => {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const { startTransition } = useViewTransition();
  const { icon: Icon, iconColor, buttonClass } = variantStyles[variant];

  // Focus cancel button on open for safety (user must actively choose to confirm)
  useEffect(() => {
    if (isOpen && cancelButtonRef.current) {
      // Small delay to ensure dialog is rendered
      const timer = setTimeout(() => {
        cancelButtonRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Handle escape key - dialog component handles this but we also prevent closing during loading
  const handleOpenChange = (open: boolean) => {
    if (!open && !isLoading) {
      onClose();
    }
  };

  const handleConfirm = async () => {
    await onConfirm();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" mobileFullscreen={false}>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-full bg-muted ${iconColor}`}>
              <Icon className="w-5 h-5" />
            </div>
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription className="pt-2">
            {description}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:gap-0 mt-4">
          <Button
            ref={cancelButtonRef}
            variant="outline"
            onClick={onClose}
            disabled={isLoading}
          >
            {cancelText}
          </Button>
          <Button
            onClick={() => void startTransition(() => handleConfirm())}
            disabled={isLoading}
            className={buttonClass}
          >
            <AnimatePresence mode="wait">
              {isLoading ? (
                <motion.span
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center"
                >
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {confirmText}
                </motion.span>
              ) : (
                <motion.span
                  key="idle"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  {confirmText}
                </motion.span>
              )}
            </AnimatePresence>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ConfirmDialog;
