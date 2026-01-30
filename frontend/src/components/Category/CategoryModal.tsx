import React, { useState, useCallback } from "react";
import { Loader2, FolderPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Label } from "../ui/label";
import { useI18n } from "../../i18n";
import { categoriesApi } from "../../services/api";
import { useAppStore } from "../../store/useAppStore";
import type { CategoryCreate } from "../../types";

interface CategoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export const CategoryModal: React.FC<CategoryModalProps> = ({
  open,
  onOpenChange,
  onSuccess,
}) => {
  const { t } = useI18n();
  const { addToast, invalidateCategories } = useAppStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<CategoryCreate>({
    name: "",
    description: "",
  });
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      setError(t("category.error_name_required"));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await categoriesApi.create({
        name: formData.name.trim(),
        description: formData.description?.trim() || undefined,
      });

      addToast({
        type: "success",
        message: t("category.created_success"),
      });

      // Invalidate categories cache to trigger refetch
      invalidateCategories();

      // Reset form and close modal
      setFormData({ name: "", description: "" });
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : t("category.error_create");
      setError(message);
      addToast({
        type: "error",
        message,
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, t, addToast, invalidateCategories, onOpenChange, onSuccess]);

  const handleClose = useCallback(() => {
    if (!isSubmitting) {
      setFormData({ name: "", description: "" });
      setError(null);
      onOpenChange(false);
    }
  }, [isSubmitting, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderPlus className="h-5 w-5 text-primary" />
            {t("category.create_title")}
          </DialogTitle>
          <DialogDescription>
            {t("category.create_description")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="category-name">{t("category.name")}</Label>
            <Input
              id="category-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder={t("category.name_placeholder")}
              disabled={isSubmitting}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category-description">{t("category.description")}</Label>
            <Textarea
              id="category-description"
              value={formData.description || ""}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder={t("category.description_placeholder")}
              disabled={isSubmitting}
              rows={3}
            />
          </div>

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
              disabled={isSubmitting}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting || !formData.name.trim()}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("common.creating")}
                </>
              ) : (
                t("category.create_button")
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
