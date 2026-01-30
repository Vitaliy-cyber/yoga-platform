import React, { useState, useCallback } from "react";
import { Loader2, Trash2, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { useI18n } from "../../i18n";
import { categoriesApi } from "../../services/api";
import { useAppStore } from "../../store/useAppStore";
import type { Category } from "../../types";

interface CategoryDeleteModalProps {
  category: Category | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export const CategoryDeleteModal: React.FC<CategoryDeleteModalProps> = ({
  category,
  open,
  onOpenChange,
  onSuccess,
}) => {
  const { t } = useI18n();
  const { addToast, invalidateCategories } = useAppStore();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = useCallback(async () => {
    if (!category) return;

    setIsDeleting(true);
    setError(null);

    try {
      await categoriesApi.delete(category.id);

      addToast({
        type: "success",
        message: t("category.deleted_success"),
      });

      invalidateCategories();
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : t("category.error_delete");
      setError(message);
      addToast({
        type: "error",
        message,
      });
    } finally {
      setIsDeleting(false);
    }
  }, [category, t, addToast, invalidateCategories, onOpenChange, onSuccess]);

  const handleClose = useCallback(() => {
    if (!isDeleting) {
      setError(null);
      onOpenChange(false);
    }
  }, [isDeleting, onOpenChange]);

  if (!category) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            {t("category.delete_title")}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3">
              <p>{t("category.delete_description", { name: category.name })}</p>
              {category.pose_count !== undefined && category.pose_count > 0 && (
                <div className="flex items-start gap-2 p-3 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-lg text-sm">
                  <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{t("category.delete_warning_poses", { count: category.pose_count })}</span>
                </div>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isDeleting}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("common.deleting")}
              </>
            ) : (
              t("category.delete_button")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
