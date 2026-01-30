import React, { useState, useCallback, useEffect } from "react";
import { Loader2, Pencil } from "lucide-react";
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
import type { Category } from "../../types";

interface CategoryEditModalProps {
  category: Category | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export const CategoryEditModal: React.FC<CategoryEditModalProps> = ({
  category,
  open,
  onOpenChange,
  onSuccess,
}) => {
  const { t } = useI18n();
  const { addToast, invalidateCategories } = useAppStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Reset form when category changes
  useEffect(() => {
    if (category) {
      setName(category.name);
      setDescription(category.description || "");
    }
  }, [category]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    if (!category) return;

    if (!name.trim()) {
      setError(t("category.error_name_required"));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await categoriesApi.update(category.id, {
        name: name.trim(),
        description: description.trim() || undefined,
      });

      addToast({
        type: "success",
        message: t("category.updated_success"),
      });

      invalidateCategories();
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : t("category.error_update");
      setError(message);
      addToast({
        type: "error",
        message,
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [category, name, description, t, addToast, invalidateCategories, onOpenChange, onSuccess]);

  const handleClose = useCallback(() => {
    if (!isSubmitting) {
      setError(null);
      onOpenChange(false);
    }
  }, [isSubmitting, onOpenChange]);

  if (!category) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5 text-primary" />
            {t("category.edit_title")}
          </DialogTitle>
          <DialogDescription>
            {t("category.edit_description")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-category-name">{t("category.name")}</Label>
            <Input
              id="edit-category-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("category.name_placeholder")}
              disabled={isSubmitting}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-category-description">{t("category.description")}</Label>
            <Textarea
              id="edit-category-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
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
            <Button type="submit" disabled={isSubmitting || !name.trim()}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("common.saving")}
                </>
              ) : (
                t("common.save")
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
