import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Save, Loader2, GraduationCap } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { useSequenceStore } from "../store/useSequenceStore";
import { useI18n } from "../i18n";
import type { DifficultyLevel } from "../types";

export const SequenceNew: React.FC = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { createSequence, isSaving, error } = useSequenceStore();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [difficulty, setDifficulty] = useState<DifficultyLevel>("beginner");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) return;

    try {
      const sequence = await createSequence({
        name: name.trim(),
        description: description.trim() || undefined,
        difficulty,
      });
      navigate(`/sequences/${sequence.id}`);
    } catch {
      // Error handled in store
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-6 py-4">
          <Link
            to="/sequences"
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-4 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("sequences.back_to_list")}
          </Link>
          <h1 className="text-2xl font-semibold text-foreground">
            {t("sequences.create_new")}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t("sequences.create_description")}
          </p>
        </div>
      </header>

      {/* Form */}
      <main className="max-w-3xl mx-auto px-6 py-8">
        <form
          onSubmit={handleSubmit}
          className="bg-card rounded-2xl border border-border p-6 space-y-6"
        >
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name" className="text-foreground font-medium">
              {t("sequences.name")} *
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("sequences.name_placeholder")}
              className="h-11"
              required
              data-testid="sequence-name"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label
              htmlFor="description"
              className="text-foreground font-medium"
            >
              {t("sequences.description")}
            </Label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("sequences.description_placeholder")}
              className="w-full h-24 px-3 py-2 rounded-lg border border-input bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary resize-none transition-colors duration-150"
            />
          </div>

          {/* Difficulty */}
          <div className="space-y-2">
            <Label className="text-foreground font-medium">
              {t("sequences.difficulty")}
            </Label>
            <Select
              value={difficulty}
              onValueChange={(v) => setDifficulty(v as DifficultyLevel)}
            >
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="beginner">
                  <div className="flex items-center gap-2">
                    <GraduationCap className="w-4 h-4 text-emerald-600" />
                    {t("sequences.difficulty.beginner")}
                  </div>
                </SelectItem>
                <SelectItem value="intermediate">
                  <div className="flex items-center gap-2">
                    <GraduationCap className="w-4 h-4 text-amber-600" />
                    {t("sequences.difficulty.intermediate")}
                  </div>
                </SelectItem>
                <SelectItem value="advanced">
                  <div className="flex items-center gap-2">
                    <GraduationCap className="w-4 h-4 text-rose-600" />
                    {t("sequences.difficulty.advanced")}
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Error */}
          {error && (
            <div className="p-4 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 rounded-lg text-rose-600 dark:text-rose-400 text-sm">
              {error}
            </div>
          )}

          {/* Submit */}
          <div className="flex items-center justify-end gap-4 pt-4 border-t border-border">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate("/sequences")}
              disabled={isSaving}
            >
              {t("app.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={isSaving || !name.trim()}
              data-testid="sequence-create"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t("app.saving")}
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  {t("sequences.create")}
                </>
              )}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
};
