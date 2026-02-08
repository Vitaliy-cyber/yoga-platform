import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Locale = "en" | "ua";

type TranslationValue = string | ((params?: Record<string, string | number>) => string);

// Pluralization forms for Ukrainian (1, 2-4, 5+)
type PluralForms = {
  one: string;    // 1 поза
  few: string;    // 2-4 пози
  many: string;   // 5+ поз
};

// @ts-expect-error - type kept for documentation purposes
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _TranslationDict = Record<string, TranslationValue>;

/**
 * Detect browser locale and map it to supported locales.
 * Falls back to Ukrainian (ua) as default.
 */
const detectBrowserLocale = (): Locale => {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "ua";
  }

  // Check navigator.languages first, then navigator.language
  const browserLangs = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];

  for (const lang of browserLangs) {
    const normalizedLang = lang.toLowerCase();
    // Check for English variants
    if (normalizedLang.startsWith("en")) {
      return "en";
    }
    // Check for Ukrainian variants
    if (normalizedLang.startsWith("uk") || normalizedLang.startsWith("ua")) {
      return "ua";
    }
  }

  // Default to Ukrainian
  return "ua";
};

/**
 * Get the initial locale from localStorage or browser detection.
 */
const getInitialLocale = (): Locale => {
  if (typeof window === "undefined") {
    return "ua";
  }

  // First, check localStorage for user preference
  const stored = window.localStorage.getItem("yoga_locale");
  if (stored === "en" || stored === "ua") {
    return stored;
  }

  // Fall back to browser locale detection
  return detectBrowserLocale();
};

/**
 * Ukrainian pluralization rules.
 * Returns: "one" for 1, 21, 31...; "few" for 2-4, 22-24...; "many" for 0, 5-20, 25-30...
 */
export const getUkrainianPluralForm = (count: number): keyof PluralForms => {
  const absCount = Math.abs(count);
  const mod10 = absCount % 10;
  const mod100 = absCount % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return "one";
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return "few";
  }
  return "many";
};

/**
 * English pluralization rules.
 * Returns: "one" for 1; "many" for everything else.
 */
export const getEnglishPluralForm = (count: number): keyof PluralForms => {
  return Math.abs(count) === 1 ? "one" : "many";
};

/**
 * Format a number according to locale.
 * Uses Intl.NumberFormat for proper localization (1,000 vs 1 000).
 */
export const formatNumber = (value: number, locale: Locale): string => {
  const intlLocale = locale === "ua" ? "uk-UA" : "en-US";
  return new Intl.NumberFormat(intlLocale).format(value);
};

/**
 * Format a date according to locale.
 * Uses Intl.DateTimeFormat for proper localization.
 */
export const formatDate = (
  date: Date | string | number,
  locale: Locale,
  options?: Intl.DateTimeFormatOptions
): string => {
  const intlLocale = locale === "ua" ? "uk-UA" : "en-US";
  const dateObj = date instanceof Date ? date : new Date(date);

  // Default options for consistent formatting
  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...options,
  };

  return new Intl.DateTimeFormat(intlLocale, defaultOptions).format(dateObj);
};

/**
 * Format a date and time according to locale.
 */
export const formatDateTime = (
  date: Date | string | number,
  locale: Locale,
  options?: Intl.DateTimeFormatOptions
): string => {
  const intlLocale = locale === "ua" ? "uk-UA" : "en-US";
  const dateObj = date instanceof Date ? date : new Date(date);

  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  };

  return new Intl.DateTimeFormat(intlLocale, defaultOptions).format(dateObj);
};

/**
 * Format relative time (e.g., "2 hours ago").
 */
export const formatRelativeTime = (
  date: Date | string | number,
  locale: Locale
): string => {
  const intlLocale = locale === "ua" ? "uk-UA" : "en-US";
  const dateObj = date instanceof Date ? date : new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - dateObj.getTime();

  // Handle invalid dates
  if (isNaN(dateObj.getTime())) {
    return locale === "ua" ? "невідомо" : "unknown";
  }

  // Handle future dates
  if (diffMs < 0) {
    return locale === "ua" ? "щойно" : "just now";
  }

  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  // Use Intl.RelativeTimeFormat for proper localization
  const rtf = new Intl.RelativeTimeFormat(intlLocale, { numeric: "auto" });

  if (diffSecs < 60) {
    return locale === "ua" ? "щойно" : "just now";
  }
  if (diffMins < 60) {
    return rtf.format(-diffMins, "minute");
  }
  if (diffHours < 24) {
    return rtf.format(-diffHours, "hour");
  }
  if (diffDays < 7) {
    return rtf.format(-diffDays, "day");
  }

  // For older dates, show the actual date
  return formatDate(dateObj, locale);
};

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: keyof typeof translations, params?: Record<string, string | number>) => string;
  plural: (count: number, forms: { one: string; few?: string; many: string }) => string;
  formatNumber: (value: number) => string;
  formatDate: (date: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatDateTime: (date: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatRelativeTime: (date: Date | string | number) => string;
  dir: "ltr" | "rtl";
}

const translations = {
  "app.name": {
    en: "Pose Studio",
    ua: "Лабораторія Поз",
  },
  "app.tagline": {
    en: "Educational Pose Visualization System",
    ua: "Освітня система візуалізації поз",
  },
  "app.language": {
    en: "Language",
    ua: "Мова",
  },
  "app.language_toggle": {
    en: "EN",
    ua: "UA",
  },
  "app.loading": {
    en: "Loading...",
    ua: "Завантаження...",
  },
  "app.logout": {
    en: "Logout",
    ua: "Вийти",
  },
  "app.not_found": {
    en: "Not found",
    ua: "Нічого не знайдено",
  },
  "app.dismiss": {
    en: "Dismiss",
    ua: "Закрити",
  },
  "common.close": {
    en: "Close",
    ua: "Закрити",
  },
  "common.save": {
    en: "Save",
    ua: "Зберегти",
  },
  "common.cancel": {
    en: "Cancel",
    ua: "Скасувати",
  },
  "common.creating": {
    en: "Creating...",
    ua: "Створення...",
  },
  "common.saving": {
    en: "Saving...",
    ua: "Збереження...",
  },
  "common.deleting": {
    en: "Deleting...",
    ua: "Видалення...",
  },
  "nav.dashboard": {
    en: "Dashboard",
    ua: "Головна",
  },
  "nav.gallery": {
    en: "Gallery",
    ua: "Галерея",
  },
  "nav.upload": {
    en: "Create Pose",
    ua: "Створити позу",
  },
  "nav.generate": {
    en: "AI Generator",
    ua: "AI Генератор",
  },
  "nav.menu": {
    en: "Menu",
    ua: "Меню",
  },
  "nav.categories": {
    en: "Categories",
    ua: "Категорії",
  },
  "nav.premium": {
    en: "Premium Platform",
    ua: "Преміум платформа",
  },
  "nav.user_plan": {
    en: "Pro Plan",
    ua: "План Pro",
  },
  "nav.user_name": {
    en: "Tetra User",
    ua: "Користувач Tetra",
  },
  "header.search_placeholder": {
    en: "Search poses...",
    ua: "Пошук поз...",
  },
  "header.no_results": {
    en: "No results",
    ua: "Нічого не знайдено",
  },
  "dashboard.new_pose": {
    en: "New Pose",
    ua: "Нова поза",
  },
  "dashboard.total": {
    en: "Total Poses",
    ua: "Всього поз",
  },
  "dashboard.complete": {
    en: "Complete",
    ua: "Завершені",
  },
  "dashboard.drafts": {
    en: "Drafts",
    ua: "Чернетки",
  },
  "dashboard.processing": {
    en: "Processing",
    ua: "В обробці",
  },
  "dashboard.showing": {
    en: "Showing {shown} of {total} poses",
    ua: "Показано {shown} з {total} поз",
  },
  "dashboard.no_poses": {
    en: "No poses found",
    ua: "Пози не знайдено",
  },
  "dashboard.no_poses_hint": {
    en: "Get started by creating your first pose",
    ua: "Почніть із створення першої пози",
  },
  "dashboard.adjust_filters": {
    en: "Try adjusting your filters",
    ua: "Спробуйте змінити фільтри",
  },
  "dashboard.create_first": {
    en: "Create First Pose",
    ua: "Створити першу позу",
  },
  "dashboard.fetch_failed": {
    en: "Failed to fetch data",
    ua: "Не вдалося завантажити дані",
  },
  "dashboard.view_mode": {
    en: "View mode",
    ua: "Режим перегляду",
  },
  "dashboard.grid_view": {
    en: "Grid view",
    ua: "Сітка",
  },
  "dashboard.list_view": {
    en: "List view",
    ua: "Список",
  },
  "dashboard.error_title": {
    en: "Error loading dashboard",
    ua: "Помилка завантаження",
  },
  "dashboard.retry": {
    en: "Retry",
    ua: "Спробувати знову",
  },
  "categories.fetch_failed": {
    en: "Failed to fetch categories",
    ua: "Не вдалося завантажити категорії",
  },
  "gallery.title": {
    en: "Pose Library",
    ua: "Бібліотека поз",
  },
  "gallery.summary": {
    en: "{poses} poses • {categories} categories",
    ua: "{poses} поз • {categories} категорій",
  },
  "gallery.showing": {
    en: "Showing {shown} of {total} poses",
    ua: "Показано {shown} з {total} поз",
  },
  "gallery.no_poses": {
    en: "No poses found",
    ua: "Пози не знайдено",
  },
  "gallery.adjust_filters": {
    en: "Try adjusting your filters",
    ua: "Спробуйте змінити фільтри",
  },
  "gallery.new_pose": {
    en: "New Pose",
    ua: "Нова поза",
  },
  "pose.status.draft": {
    en: "Draft",
    ua: "Чернетка",
  },
  "pose.status.complete": {
    en: "Complete",
    ua: "Завершено",
  },
  "pose.status.error": {
    en: "Error",
    ua: "Помилка",
  },
  "poses.error_fetch": {
    en: "Failed to fetch poses",
    ua: "Не вдалося завантажити список поз",
  },
  "poses.error_fetch_single": {
    en: "Failed to fetch pose",
    ua: "Не вдалося завантажити позу",
  },
  "poses.error_search": {
    en: "Search failed",
    ua: "Пошук не вдався",
  },
  "pose.no_image": {
    en: "No image",
    ua: "Немає зображення",
  },
  "pose.hover_generate": {
    en: "Hover to generate",
    ua: "Наведіть для генерації",
  },
  "pose.view": {
    en: "View",
    ua: "Перегляд",
  },
  "pose.generate": {
    en: "Generate",
    ua: "Згенерувати",
  },
  "pose.upload_generate": {
    en: "Upload & Generate",
    ua: "Завантажити й згенерувати",
  },
  "pose.uncategorized": {
    en: "Uncategorized",
    ua: "Без категорії",
  },
  "pose.load_failed": {
    en: "Failed to load pose",
    ua: "Не вдалося завантажити позу",
  },
  "pose.view_details": {
    en: "View pose details",
    ua: "Переглянути деталі пози",
  },
  "pose.viewer.title": {
    en: "Pose Viewer",
    ua: "Перегляд пози",
  },
  "pose.viewer.download": {
    en: "Download",
    ua: "Завантажити",
  },
  "pose.viewer.layer": {
    en: "Visualization Layer",
    ua: "Шар візуалізації",
  },
  "pose.viewer.photo": {
    en: "Photo",
    ua: "Фото",
  },
  "pose.viewer.muscles": {
    en: "Muscles",
    ua: "М'язи",
  },
  "pose.viewer.not_generated": {
    en: "Not generated",
    ua: "Не згенеровано",
  },
  "pose.viewer.opacity": {
    en: "Overlay Opacity: {value}%",
    ua: "Прозорість шару: {value}%",
  },
  "pose.viewer.active_muscles": {
    en: "Active Muscles",
    ua: "Активні м'язи",
  },
  "pose.viewer.active_muscles_toast": {
    en: "Active muscles loaded: {count}",
    ua: "Активні м'язи завантажено: {count}",
  },
  "pose.viewer.activation_level": {
    en: "Activation level",
    ua: "Рівень активації",
  },
  "pose.viewer.high_activation": {
    en: "High",
    ua: "Високий",
  },
  "pose.viewer.medium_activation": {
    en: "Medium",
    ua: "Середній",
  },
  "pose.viewer.low_activation": {
    en: "Low",
    ua: "Низький",
  },
  "pose.muscles.not_analyzed": {
    en: "Muscles have not been analyzed for this pose",
    ua: "М'язи для цієї пози ще не проаналізовані",
  },
  "pose.muscles.analyze": {
    en: "Analyze Muscles",
    ua: "Аналізувати м'язи",
  },
  "pose.muscles.analyzing": {
    en: "Analyzing...",
    ua: "Аналізуємо...",
  },
  "pose.muscles.reanalyze_success": {
    en: "Muscles analyzed successfully",
    ua: "М'язи успішно проаналізовано",
  },
  "pose.muscles.reanalyze_error": {
    en: "Failed to analyze muscles",
    ua: "Не вдалося проаналізувати м'язи",
  },
  "pose.detail.back": {
    en: "Return to Gallery",
    ua: "Повернутись до галереї",
  },
  "pose.detail.not_found": {
    en: "Pose not found",
    ua: "Поза не знайдена",
  },
  "pose.detail.full_view": {
    en: "Full View",
    ua: "Повний перегляд",
  },
  "pose.detail.regenerate": {
    en: "Regenerate",
    ua: "Перегенерувати",
  },
  "pose.detail.no_image": {
    en: "No generated image yet",
    ua: "Згенерованого зображення ще немає",
  },
  "pose.detail.no_image_hint": {
    en: "Generate a photorealistic image from your source",
    ua: "Згенеруйте фотореалістичне зображення з вашого джерела",
  },
  "pose.detail.source_schematic": {
    en: "Source Schematic",
    ua: "Вихідна схема",
  },
  "pose.detail.details": {
    en: "Pose Details",
    ua: "Деталі пози",
  },
  "pose.detail.edit": {
    en: "Edit",
    ua: "Редагувати",
  },
  "pose.detail.cancel": {
    en: "Cancel",
    ua: "Скасувати",
  },
  "pose.detail.save": {
    en: "Save",
    ua: "Зберегти",
  },
  "pose.detail.name": {
    en: "Name",
    ua: "Назва",
  },
  "pose.detail.name_en": {
    en: "Name (EN)",
    ua: "Назва (EN)",
  },
  "pose.detail.category": {
    en: "Category",
    ua: "Категорія",
  },
  "pose.detail.description": {
    en: "Description",
    ua: "Опис",
  },
  "pose.detail.no_description": {
    en: "No description",
    ua: "Немає опису",
  },
  "pose.detail.delete_confirm": {
    en: "Are you sure you want to delete this pose?",
    ua: "Ви впевнені, що хочете видалити цю позу?",
  },
  "pose.detail.delete_error": {
    en: "Failed to delete pose",
    ua: "Не вдалося видалити позу",
  },
  "pose.detail.delete_title": {
    en: "Delete Pose?",
    ua: "Видалити позу?",
  },
  "pose.detail.delete_confirm_message": {
    en: (params?: Record<string, string | number>) => `Are you sure you want to delete "${params?.name}"? This action cannot be undone.`,
    ua: (params?: Record<string, string | number>) => `Ви впевнені, що хочете видалити "${params?.name}"? Цю дію неможливо скасувати.`,
  },
  "pose.detail.delete_success": {
    en: "Pose deleted successfully",
    ua: "Позу успішно видалено",
  },
  "pose.detail.save_success": {
    en: "Pose saved successfully",
    ua: "Позу успішно збережено",
  },
  "pose.detail.save_error": {
    en: "Failed to save pose",
    ua: "Не вдалося зберегти позу",
  },
  "pose.detail.delete": {
    en: "Delete",
    ua: "Видалити",
  },
  "pose.tabs.photo": {
    en: "Photo",
    ua: "Фото",
  },
  "pose.tabs.muscles": {
    en: "Muscles",
    ua: "М'язи",
  },
  "pose.badge.complete": {
    en: "complete",
    ua: "завершено",
  },
  "pose.badge.draft": {
    en: "draft",
    ua: "чернетка",
  },
  "pose.download": {
    en: "Download",
    ua: "Завантажити",
  },
  "pose.delete": {
    en: "Delete",
    ua: "Видалити",
  },
  "pose.regenerate": {
    en: "Regenerate",
    ua: "Перегенерувати",
  },
  "pose.generate_cta": {
    en: "Generate",
    ua: "Згенерувати",
  },
  "pose.file_alt": {
    en: "Source schematic",
    ua: "Вихідна схема",
  },
  "pose.filters.search": {
    en: "Search poses...",
    ua: "Пошук поз...",
  },
  "pose.filters.status": {
    en: "Status",
    ua: "Статус",
  },
  "pose.filters.category": {
    en: "Category",
    ua: "Категорія",
  },
  "pose.filters.all_categories": {
    en: "All Categories",
    ua: "Усі категорії",
  },
  "pose.filters.all_statuses": {
    en: "All Statuses",
    ua: "Усі статуси",
  },
  "pose.filters.draft": {
    en: "Draft",
    ua: "Чернетка",
  },
  "pose.filters.complete": {
    en: "Complete",
    ua: "Завершено",
  },
  "generate.title": {
    en: "Generate Yoga Pose",
    ua: "Генерація пози",
  },
  "generate.subtitle": {
    en: "Upload a schematic or describe a pose to generate photorealistic images",
    ua: "Завантажте схему або опишіть позу для генерації фотореалістичних зображень",
  },
  "generate.source_input": {
    en: "Source Input",
    ua: "Джерело",
  },
  "generate.upload_schematic": {
    en: "Upload Schematic",
    ua: "Завантажити схему",
  },
  "generate.text_description": {
    en: "Text Description",
    ua: "Текстовий опис",
  },
  "generate.text_coming_soon": {
    en: "Coming Soon",
    ua: "Незабаром",
  },
  "generate.text_coming_soon_hint": {
    en: "Text-only generation is not yet available. Please upload a schematic image to generate poses.",
    ua: "Генерація тільки по тексту поки недоступна. Завантажте схематичне зображення для генерації поз.",
  },
  "generate.text_label": {
    en: "Pose Description",
    ua: "Опис пози",
  },
  "generate.text_placeholder": {
    en: "Describe the yoga pose in detail. For example: Standing pose with feet wide apart, arms extended horizontally, right foot turned 90 degrees outward, torso facing forward...",
    ua: "Опишіть позу йоги детально. Наприклад: Стояча поза з широкою стійкою, руки витягнуті горизонтально, права стопа повернута на 90 градусів назовні, торс спрямований вперед...",
  },
  "generate.text_min_chars": {
    en: "Minimum {min} characters required ({current} entered)",
    ua: "Мінімум {min} символів ({current} введено)",
  },
  "generate.text_chars": {
    en: "{count} characters",
    ua: "{count} символів",
  },
  "generate.drop_here": {
    en: "Drop your schematic drawing here",
    ua: "Перетягніть схему сюди",
  },
  "generate.browse": {
    en: "or click to browse files",
    ua: "або натисніть, щоб обрати файл",
  },
  "generate.describe_placeholder": {
    en: "Describe the pose in detail...",
    ua: "Опишіть позу детально...",
  },
  "generate.describe_example": {
    en: "Example: Standing pose with feet wide apart, approximately 4 feet. Right foot turned out 90 degrees, left foot slightly inward. Arms extended horizontally at shoulder height.",
    ua: "Приклад: Стояча поза з широкою стійкою, приблизно 4 фути. Права стопа розвернута на 90 градусів, ліва трохи всередину. Руки витягнуті горизонтально на рівні плечей.",
  },
  "generate.options": {
    en: "What to generate:",
    ua: "Що згенерувати:",
  },
  "generate.photo_title": {
    en: "Photorealistic Image",
    ua: "Фотореалістичне зображення",
  },
  "generate.photo_desc": {
    en: "Studio-quality photograph",
    ua: "Студійна якість фото",
  },
  "generate.required": {
    en: "Required",
    ua: "Обов'язково",
  },
  "generate.muscles_title": {
    en: "Muscle Visualization",
    ua: "Візуалізація м'язів",
  },
  "generate.muscles_desc": {
    en: "Active muscle groups highlighted",
    ua: "Активні м'язи підсвічені",
  },
  "generate.notes": {
    en: "Additional instructions (optional)",
    ua: "Додаткові інструкції (необов'язково)",
  },
  "generate.notes_placeholder": {
    en: "e.g., brighter background, softer lighting, blue outfit color, male subject...",
    ua: "наприклад: світліший фон, м'якше освітлення, синій колір одягу, чоловіча модель...",
  },
  "generate.notes_hint": {
    en: "AI will consider your preferences when generating",
    ua: "AI врахує ваші побажання при генерації",
  },
  "generate.start": {
    en: "Start Generation",
    ua: "Почати генерацію",
  },
  "generate.generating": {
    en: "Generating...",
    ua: "Генерація...",
  },
  "generate.progress": {
    en: "Generation Progress",
    ua: "Прогрес генерації",
  },
  "generate.progress_label": {
    en: "Progress",
    ua: "Прогрес",
  },
  "generate.progress_hint": {
    en: "This may take a few minutes. Please don't close this window.",
    ua: "Це може зайняти кілька хвилин. Не закривайте це вікно.",
  },
  "generate.ready": {
    en: "Ready to Generate",
    ua: "Готово до генерації",
  },
  "generate.ready_hint": {
    en: "Upload a schematic image or describe a pose to get started",
    ua: "Завантажте схему або опишіть позу, щоб почати",
  },
  "generate.reset": {
    en: "Reset & Start Over",
    ua: "Скинути і почати заново",
  },
  "generate.results_photo": {
    en: "Photo",
    ua: "Фото",
  },
  "generate.results_muscles": {
    en: "Muscles",
    ua: "М'язи",
  },
  "generate.viewer": {
    en: "Open Full Viewer",
    ua: "Відкрити повний перегляд",
  },
  // Save to Gallery
  "generate.save_to_gallery": {
    en: "Save to Gallery",
    ua: "Зберегти в галерею",
  },
  "generate.save_modal_title": {
    en: "Save to Gallery",
    ua: "Зберегти в галерею",
  },
  "generate.save_modal_description": {
    en: "Enter pose details to save the generated images to your gallery.",
    ua: "Введіть дані пози, щоб зберегти згенеровані зображення в галерею.",
  },
  "generate.save_name": {
    en: "Pose Name",
    ua: "Назва пози",
  },
  "generate.save_name_placeholder": {
    en: "e.g., Warrior II Pose",
    ua: "наприклад, Поза воїна II",
  },
  "generate.save_code": {
    en: "Pose Code",
    ua: "Код пози",
  },
  "generate.save_code_placeholder": {
    en: "e.g., W2",
    ua: "наприклад, W2",
  },
  "generate.save_code_hint": {
    en: "Unique identifier for this pose (letters, numbers, dashes)",
    ua: "Унікальний ідентифікатор для цієї пози (літери, цифри, дефіси)",
  },
  "generate.save_name_en": {
    en: "English Name (optional)",
    ua: "Англійська назва (необов'язково)",
  },
  "generate.save_name_en_placeholder": {
    en: "e.g., Warrior II",
    ua: "наприклад, Warrior II",
  },
  "generate.save_description": {
    en: "Description (optional)",
    ua: "Опис (необов'язково)",
  },
  "generate.save_description_placeholder": {
    en: "Describe the pose, its benefits, or technique...",
    ua: "Опишіть позу, її користь або техніку виконання...",
  },
  "generate.save_fill_required": {
    en: "Please fill in the required fields (name and code)",
    ua: "Будь ласка, заповніть обов'язкові поля (назва та код)",
  },
  "generate.save_success": {
    en: "Pose saved to gallery successfully!",
    ua: "Позу успішно збережено в галерею!",
  },
  "generate.save_failed": {
    en: "Failed to save pose to gallery",
    ua: "Не вдалося зберегти позу в галерею",
  },
  "generate.saving": {
    en: "Saving...",
    ua: "Збереження...",
  },
  "generate.save_button": {
    en: "Save Pose",
    ua: "Зберегти позу",
  },
  // Active Muscles
  "generate.active_muscles": {
    en: "Active Muscles",
    ua: "Активні м'язи",
  },
  "generate.muscles_legend": {
    en: "Red: primary muscles (70%+) • Orange: secondary (40-69%) • Gray: stabilizing (<40%)",
    ua: "Червоний: основні м'язи (70%+) • Оранжевий: допоміжні (40-69%) • Сірий: стабілізуючі (<40%)",
  },
  // Generation steps
  "generate.step_photo": {
    en: "Generating photo",
    ua: "Генерація фото",
  },
  "generate.step_muscles": {
    en: "Generating muscles",
    ua: "Генерація м'язів",
  },
  "generate.step_analyzing_muscles": {
    en: "Analyzing muscles",
    ua: "Аналіз м'язів",
  },
  // Muscle names translations
  "muscle.erector_spinae": {
    en: "Erector Spinae",
    ua: "Випрямлячі хребта",
  },
  "muscle.latissimus_dorsi": {
    en: "Latissimus Dorsi",
    ua: "Найширший м'яз спини",
  },
  "muscle.trapezius": {
    en: "Trapezius",
    ua: "Трапецієподібний м'яз",
  },
  "muscle.rhomboids": {
    en: "Rhomboids",
    ua: "Ромбоподібні м'язи",
  },
  "muscle.rectus_abdominis": {
    en: "Rectus Abdominis",
    ua: "Прямий м'яз живота",
  },
  "muscle.obliques": {
    en: "Obliques",
    ua: "Косі м'язи живота",
  },
  "muscle.transverse_abdominis": {
    en: "Transverse Abdominis",
    ua: "Поперечний м'яз живота",
  },
  "muscle.quadriceps": {
    en: "Quadriceps",
    ua: "Чотириголовий м'яз",
  },
  "muscle.hamstrings": {
    en: "Hamstrings",
    ua: "Біцепс стегна",
  },
  "muscle.gluteus_maximus": {
    en: "Gluteus Maximus",
    ua: "Великий сідничний м'яз",
  },
  "muscle.gluteus_medius": {
    en: "Gluteus Medius",
    ua: "Середній сідничний м'яз",
  },
  "muscle.calves": {
    en: "Calves",
    ua: "Литкові м'язи",
  },
  "muscle.hip_flexors": {
    en: "Hip Flexors",
    ua: "Згиначі стегна",
  },
  "muscle.deltoids": {
    en: "Deltoids",
    ua: "Дельтоподібний м'яз",
  },
  "muscle.rotator_cuff": {
    en: "Rotator Cuff",
    ua: "Ротаторна манжета",
  },
  "muscle.biceps": {
    en: "Biceps",
    ua: "Біцепс",
  },
  "muscle.triceps": {
    en: "Triceps",
    ua: "Трицепс",
  },
  "muscle.forearms": {
    en: "Forearms",
    ua: "М'язи передпліччя",
  },
  "muscle.pectoralis": {
    en: "Pectoralis",
    ua: "Грудний м'яз",
  },
  "muscle.serratus_anterior": {
    en: "Serratus Anterior",
    ua: "Передній зубчастий м'яз",
  },
  "generate.alt_schematic": {
    en: "Schematic preview",
    ua: "Попередній перегляд схеми",
  },
  "generate.alt_photo": {
    en: "Generated photo",
    ua: "Згенероване фото",
  },
  "generate.alt_muscles": {
    en: "Muscle visualization",
    ua: "Візуалізація м'язів",
  },
  "generate.alt_pose": {
    en: "Pose",
    ua: "Поза",
  },
  "generate.tab_title": {
    en: "Generate Images for \"{pose}\"",
    ua: "Генерація зображень для «{pose}»",
  },
  "generate.tab_description": {
    en: "Generate photorealistic images from the source schematic using AI.",
    ua: "Згенеруйте фотореалістичні зображення зі схеми за допомогою AI.",
  },
  "generate.source_schematic": {
    en: "Source schematic",
    ua: "Вихідна схема",
  },
  "generate.upload_schematic_button": {
    en: "Upload a schematic",
    ua: "Завантажити схему",
  },
  "generate.formats": {
    en: "PNG, JPG or WEBP",
    ua: "PNG, JPG або WEBP",
  },
  "generate.photo_label": {
    en: "Photorealistic Image",
    ua: "Фотореалістичне зображення",
  },
  "generate.photo_hint": {
    en: "Studio-quality photograph",
    ua: "Студійна якість фото",
  },
  "generate.muscles_label": {
    en: "Muscle Visualization",
    ua: "Візуалізація м'язів",
  },
  "generate.muscles_hint": {
    en: "Active muscle groups highlighted",
    ua: "Активні м'язи підсвічені",
  },
  "generate.modal_progress": {
    en: "Processing...",
    ua: "Обробка...",
  },
  "generate.modal_hint": {
    en: "This may take up to a minute. You can close this window; generation will continue in background.",
    ua: "Це може зайняти до хвилини. Можна закрити це вікно - генерація продовжиться у фоні.",
  },
  "generate.bg.processing": {
    en: "Processing...",
    ua: "Обробка...",
  },
  "generate.bg.completed": {
    en: "Generation completed",
    ua: "Генерацію завершено",
  },
  "generate.bg.failed": {
    en: "Generation failed",
    ua: "Генерація завершилась помилкою",
  },
  "generate.bg.applying": {
    en: "Applying result to pose...",
    ua: "Застосовуємо результат до пози...",
  },
  "generate.bg.dismiss": {
    en: "Dismiss",
    ua: "Прибрати",
  },
  "generate.bg.open_pose": {
    en: "Open pose",
    ua: "Відкрити позу",
  },
  "generate.bg.retry_apply": {
    en: "Retry apply",
    ua: "Повторити застосування",
  },
  "generate.bg.mode_generate": {
    en: "Generate",
    ua: "Генерація",
  },
  "generate.bg.mode_regenerate": {
    en: "Regenerate",
    ua: "Перегенерація",
  },
  "generate.schema_fetch_failed": {
    en: "Failed to fetch schema",
    ua: "Не вдалося завантажити схему",
  },
  // Regenerate modal translations
  "regenerate.title": {
    en: "Regenerate Image for \"{pose}\"",
    ua: "Перегенерація зображення для «{pose}»",
  },
  "regenerate.description": {
    en: "Regenerate the muscle visualization with additional instructions.",
    ua: "Перегенеруйте візуалізацію м'язів з додатковими інструкціями.",
  },
  "regenerate.current_image": {
    en: "Current image",
    ua: "Поточне зображення",
  },
  "regenerate.alt_muscle_image": {
    en: "Current muscle visualization",
    ua: "Поточна візуалізація м'язів",
  },
  "regenerate.alt_photo_image": {
    en: "Current photo",
    ua: "Поточне фото",
  },
  "regenerate.no_image": {
    en: "No muscle visualization available",
    ua: "Візуалізація м'язів недоступна",
  },
  "regenerate.feedback_label": {
    en: "What should be changed?",
    ua: "Що потрібно змінити?",
  },
  "regenerate.feedback_placeholder": {
    en: "e.g., make muscles more visible, adjust body position, fix arm placement, highlight different muscle groups...",
    ua: "наприклад: зробити м'язи більш видимими, скоригувати положення тіла, виправити розташування рук, підсвітити інші групи м'язів...",
  },
  "regenerate.feedback_hint": {
    en: "Describe what you'd like to improve. AI will try to address your feedback.",
    ua: "Опишіть, що потрібно покращити. AI спробує врахувати ваші побажання.",
  },
  "regenerate.feedback_prefix": {
    en: "User feedback for regeneration: ",
    ua: "Зворотній зв'язок для перегенерації: ",
  },
  "regenerate.start": {
    en: "Regenerate",
    ua: "Перегенерувати",
  },
  "regenerate.fetch_photo_failed": {
    en: "Failed to fetch existing photo",
    ua: "Не вдалося завантажити існуюче фото",
  },
  "regenerate.no_source_image": {
    en: "No source image available for regeneration",
    ua: "Немає вихідного зображення для перегенерації",
  },
  "upload.title": {
    en: "Create New Pose",
    ua: "Створити нову позу",
  },
  "upload.pose_name": {
    en: "Pose Name *",
    ua: "Назва пози *",
  },
  "upload.pose_name_placeholder": {
    en: "e.g., Warrior II",
    ua: "наприклад: Воїн II",
  },
  "upload.category": {
    en: "Category",
    ua: "Категорія",
  },
  "upload.category_placeholder": {
    en: "Select...",
    ua: "Оберіть...",
  },
  "upload.no_categories": {
    en: "No categories available",
    ua: "Немає категорій",
  },
  "upload.description": {
    en: "Description (optional)",
    ua: "Опис (необов'язково)",
  },
  "upload.description_placeholder": {
    en: "Brief description of the pose and its benefits...",
    ua: "Короткий опис пози та її користі...",
  },
  "upload.create": {
    en: "Create Pose",
    ua: "Створити позу",
  },
  "upload.creating": {
    en: "Creating Pose...",
    ua: "Створення пози...",
  },
  "upload.text_placeholder": {
    en: "Describe the pose in detail...",
    ua: "Опишіть позу детально...",
  },
  "upload.upload_schematic": {
    en: "Upload Schematic",
    ua: "Завантажити схему",
  },
  "upload.text_description": {
    en: "Text Description",
    ua: "Текстовий опис",
  },
  "upload.drop_here": {
    en: "Drop your schematic drawing here",
    ua: "Перетягніть схему сюди",
  },
  "upload.drop_idle": {
    en: "Click or drag file",
    ua: "Натисніть або перетягніть файл",
  },
  "upload.drop_active": {
    en: "Drop file here",
    ua: "Перетягніть файл сюди",
  },
  "upload.supports": {
    en: "Supports SVG, PNG, JPG (max 10MB)",
    ua: "Підтримує SVG, PNG, JPG (до 10MB)",
  },
  "upload.browse": {
    en: "or click to browse files",
    ua: "або натисніть, щоб обрати файл",
  },
  "upload.file_ready": {
    en: "Ready to upload",
    ua: "Готово до завантаження",
  },
  "upload.validated": {
    en: "Validated",
    ua: "Перевірено",
  },
  "upload.preview_alt": {
    en: "Preview",
    ua: "Попередній перегляд",
  },
  "upload.error": {
    en: "Error creating pose",
    ua: "Помилка створення пози",
  },
  "upload.clear_file": {
    en: "Clear file",
    ua: "Очистити файл",
  },
  "login.title": {
    en: "Welcome",
    ua: "Вітаємо",
  },
  "login.subtitle": {
    en: "Enter your access token to continue. New tokens create new accounts automatically.",
    ua: "Введіть токен доступу, щоб продовжити. Нові токени створюють акаунт автоматично.",
  },
  "login.access_token": {
    en: "Access Token",
    ua: "Токен доступу",
  },
  "login.placeholder": {
    en: "Enter your unique token...",
    ua: "Введіть ваш токен...",
  },
  "login.token_hint": {
    en: "Your token is your identity. Keep it secret!",
    ua: "Ваш токен — це ваша ідентичність. Зберігайте його в таємниці!",
  },
  "login.sign_in": {
    en: "Sign In",
    ua: "Увійти",
  },
  "login.signing_in": {
    en: "Signing in...",
    ua: "Вхід...",
  },
  "login.error_empty": {
    en: "Please enter an access token",
    ua: "Будь ласка, введіть токен доступу",
  },
  "login.error_failed": {
    en: "Login failed",
    ua: "Не вдалося увійти",
  },
  "login.error_rate_limited": {
    en: (params?: Record<string, string | number>) => `Too many login attempts. Please wait ${params?.seconds || 60} seconds.`,
    ua: (params?: Record<string, string | number>) => `Забагато спроб входу. Зачекайте ${params?.seconds || 60} секунд.`,
  },
  "error.rate_limited": {
    en: (params?: Record<string, string | number>) => `Too many requests. Please wait ${params?.seconds || 60} seconds.`,
    ua: (params?: Record<string, string | number>) => `Забагато запитів. Зачекайте ${params?.seconds || 60} секунд.`,
  },
  "generate.error_failed": {
    en: "Generation failed",
    ua: "Помилка генерації",
  },
  "generate.error_pose_mismatch": {
    en: "Generated image does not match the source pose closely enough. Please retry.",
    ua: "Згенероване зображення недостатньо точно повторює вихідну позу. Спробуйте ще раз.",
  },
  "generate.status_failed": {
    en: "Status check failed",
    ua: "Не вдалося перевірити статус",
  },
  "generate.toast_start": {
    en: "Generation started...",
    ua: "Генерація розпочата...",
  },
  "generate.toast_complete": {
    en: "Generation complete!",
    ua: "Генерація завершена!",
  },
  "generate.toast_placeholder": {
    en: "Placeholder image shown. API quota exhausted.",
    ua: "Показано placeholder зображення. API квота вичерпана.",
  },
  "generate.download_failed": {
    en: "Download failed",
    ua: "Не вдалося завантажити",
  },
  "generate.rate_limited": {
    en: "Too many requests. Waiting {{seconds}} seconds...",
    ua: "Забагато запитів. Очікування {{seconds}} секунд...",
  },
  "generate.reconnecting": {
    en: "Connection lost. Reconnecting...",
    ua: "З'єднання втрачено. Перепідключення...",
  },
  "generate.connection_lost": {
    en: "Connection lost. Please try again.",
    ua: "З'єднання втрачено. Спробуйте ще раз.",
  },
  "generate.refreshing_session": {
    en: "Refreshing session...",
    ua: "Оновлення сесії...",
  },
  "generate.session_expired": {
    en: "Session expired. Please log in again.",
    ua: "Сесія закінчилась. Увійдіть знову.",
  },
  "login.footer": {
    en: "Your poses and categories are private to your account",
    ua: "Ваші пози та категорії доступні лише вам",
  },
  "login.header": {
    en: "Pose Studio",
    ua: "Лабораторія Поз",
  },
  "filters.status.draft": {
    en: "Draft",
    ua: "Чернетка",
  },
  "filters.status.complete": {
    en: "Complete",
    ua: "Завершено",
  },
  "filters.status.all": {
    en: "All Statuses",
    ua: "Усі статуси",
  },
  "filters.category.all": {
    en: "All Categories",
    ua: "Усі категорії",
  },
  "filters.category.placeholder": {
    en: "Category",
    ua: "Категорія",
  },
  "filters.status.placeholder": {
    en: "Status",
    ua: "Статус",
  },
  "muscle.part.back": {
    en: "Back",
    ua: "Спина",
  },
  "muscle.part.core": {
    en: "Core",
    ua: "Корпус",
  },
  "muscle.part.legs": {
    en: "Legs",
    ua: "Ноги",
  },
  "muscle.part.arms": {
    en: "Arms",
    ua: "Руки",
  },
  "muscle.part.shoulders": {
    en: "Shoulders",
    ua: "Плечі",
  },
  "muscle.part.chest": {
    en: "Chest",
    ua: "Груди",
  },
  "muscle.part.other": {
    en: "Other",
    ua: "Інше",
  },
  "footer.brand": {
    en: "Yoga Pose Platform",
    ua: "Yoga Pose Platform",
  },
  "footer.made_with": {
    en: "Made with",
    ua: "Зроблено з",
  },
  "skeleton.unavailable": {
    en: "Skeleton image unavailable",
    ua: "Скелетне зображення недоступне",
  },
  "preview.error": {
    en: "Generation error",
    ua: "Помилка генерації",
  },
  "preview.loading": {
    en: "Generating image...",
    ua: "Генерація зображення...",
  },
  "preview.generated": {
    en: "Generated result",
    ua: "Результат генерації",
  },
  "preview.placeholder": {
    en: "Result will appear here",
    ua: "Результат з'явиться тут",
  },

  // Compare feature translations
  "compare.add": {
    en: "Compare",
    ua: "Порівняти",
  },
  "compare.added": {
    en: "Added",
    ua: "Додано",
  },
  "compare.remove": {
    en: "Remove",
    ua: "Видалити",
  },
  "compare.selected": {
    en: "{count} selected",
    ua: "{count} вибрано",
  },
  "compare.clear": {
    en: "Clear",
    ua: "Очистити",
  },
  "compare.compare": {
    en: "Compare",
    ua: "Порівняти",
  },
  "compare.title": {
    en: "Pose Comparison",
    ua: "Порівняння поз",
  },
  "compare.comparing_poses": {
    en: "Comparing {count} poses",
    ua: "Порівняння {count} поз",
  },
  "compare.back": {
    en: "Back",
    ua: "Назад",
  },
  "compare.clear_all": {
    en: "Clear All",
    ua: "Очистити все",
  },
  "compare.loading": {
    en: "Loading comparison...",
    ua: "Завантаження порівняння...",
  },
  "compare.error_title": {
    en: "Comparison Error",
    ua: "Помилка порівняння",
  },
  "compare.fetch_error": {
    en: "Failed to load comparison data",
    ua: "Не вдалося завантажити дані для порівняння",
  },
  "compare.min_poses_required": {
    en: "At least 2 poses are required for comparison",
    ua: "Для порівняння потрібно щонайменше 2 пози",
  },
  "compare.go_to_gallery": {
    en: "Go to Gallery",
    ua: "До галереї",
  },
  "compare.try_again": {
    en: "Try Again",
    ua: "Спробувати знову",
  },
  "compare.photo": {
    en: "Photo",
    ua: "Фото",
  },
  "compare.muscles": {
    en: "Muscles",
    ua: "М'язи",
  },
  "compare.no_photo": {
    en: "No photo available",
    ua: "Фото недоступне",
  },
  "compare.active_muscles": {
    en: "Active muscles",
    ua: "Активні м'язи",
  },
  "compare.tab_muscles": {
    en: "Muscle Comparison",
    ua: "Порівняння м'язів",
  },
  "compare.tab_overlap": {
    en: "Overlap Analysis",
    ua: "Аналіз перетину",
  },
  "compare.tab_slider": {
    en: "Visual Slider",
    ua: "Візуальний слайдер",
  },
  "compare.muscle_comparison": {
    en: "Muscle Activation Comparison",
    ua: "Порівняння активації м'язів",
  },
  "compare.muscle_overlap": {
    en: "Muscle Overlap Analysis",
    ua: "Аналіз перетину м'язів",
  },
  "compare.visual_comparison": {
    en: "Visual Comparison",
    ua: "Візуальне порівняння",
  },
  "compare.slider_hint": {
    en: "Drag the slider to compare poses side by side",
    ua: "Перетягуйте слайдер для порівняння поз поруч",
  },
  "compare.common_muscles": {
    en: "Common Muscles",
    ua: "Спільні м'язи",
  },
  "compare.no_common_muscles": {
    en: "No muscles in common",
    ua: "Немає спільних м'язів",
  },
  "compare.unique_label": {
    en: "unique",
    ua: "унікальні",
  },
  "compare.no_unique_muscles": {
    en: "No unique muscles",
    ua: "Немає унікальних м'язів",
  },
  "compare.no_muscle_data": {
    en: "No muscle data available for comparison",
    ua: "Немає даних про м'язи для порівняння",
  },
  "compare.stat_poses": {
    en: "Poses",
    ua: "Поз",
  },
  "compare.stat_total_muscles": {
    en: "Total Muscles",
    ua: "Всього м'язів",
  },
  "compare.stat_common": {
    en: "Common",
    ua: "Спільних",
  },
  "compare.stat_unique": {
    en: "Unique",
    ua: "Унікальних",
  },
  "compare.not_tracked": {
    en: "Not tracked",
    ua: "Не відстежується",
  },
  "compare.slider_aria_label": {
    en: "Comparison slider",
    ua: "Слайдер порівняння",
  },
  "compare.no_muscle_data_title": {
    en: "No Muscle Data",
    ua: "Немає даних про м'язи",
  },
  "compare.no_muscle_data_description": {
    en: "No muscle activation data is available for these poses. Generate muscle data to enable comparison.",
    ua: "Для цих поз немає даних про активацію м'язів. Згенеруйте дані про м'язи для порівняння.",
  },
  "compare.render_error": {
    en: "Error rendering comparison",
    ua: "Помилка відображення порівняння",
  },

  // Analytics translations
  "nav.analytics": {
    en: "Analytics",
    ua: "Аналітика",
  },
  "analytics.title": {
    en: "Analytics",
    ua: "Аналітика",
  },
  "analytics.subtitle": {
    en: "Statistics and visualization of your poses",
    ua: "Статистика та візуалізація ваших поз",
  },
  "analytics.refresh": {
    en: "Refresh",
    ua: "Оновити",
  },
  "analytics.overview": {
    en: "Overview",
    ua: "Загальний огляд",
  },
  "analytics.total_poses": {
    en: "Total Poses",
    ua: "Всього поз",
  },
  "analytics.categories": {
    en: "Categories",
    ua: "Категорій",
  },
  "analytics.with_photos": {
    en: "With Photos",
    ua: "З фото",
  },
  "analytics.with_muscles": {
    en: "With Muscles",
    ua: "З м'язами",
  },
  "analytics.completion_rate": {
    en: "{value}% complete",
    ua: "{value}% завершено",
  },
  "analytics.category_distribution": {
    en: "Category Distribution",
    ua: "Розподіл по категоріях",
  },
  "analytics.muscle_balance": {
    en: "Muscle Training Balance",
    ua: "Баланс тренування м'язів",
  },
  "analytics.most_trained": {
    en: "Most Trained",
    ua: "Найчастіше тренуються",
  },
  "analytics.least_trained": {
    en: "Need Attention",
    ua: "Потребують уваги",
  },
  "analytics.body_part_balance": {
    en: "Body Part Balance",
    ua: "Баланс частин тіла",
  },
  "analytics.recent_activity": {
    en: "Recent Activity",
    ua: "Остання активність",
  },
  "analytics.muscle_heatmap": {
    en: "Muscle Heatmap",
    ua: "Теплова карта м'язів",
  },
  "analytics.heatmap_hint": {
    en: "Visualization of muscle activity based on your poses. Hover over an area to see details.",
    ua: "Візуалізація активності м'язів на основі ваших поз. Наведіть на область, щоб побачити деталі.",
  },
  "analytics.no_data": {
    en: "No data available",
    ua: "Немає даних",
  },
  "analytics.no_categories": {
    en: "No categories",
    ua: "Немає категорій",
  },
  "analytics.no_activity": {
    en: "No recent activity",
    ua: "Немає активності",
  },
  "analytics.no_activity_hint": {
    en: "Create or update a pose to see activity",
    ua: "Створіть або оновіть позу, щоб бачити активність",
  },
  "analytics.view_all_poses": {
    en: "View all poses",
    ua: "Переглянути всі пози",
  },
  "analytics.total_activations": {
    en: "Total Activations",
    ua: "Всього активацій",
  },
  "analytics.avg_activation": {
    en: "Avg Activation",
    ua: "Сер. активація",
  },
  "analytics.poses_count": {
    en: "Poses",
    ua: "Поз",
  },
  "analytics.share": {
    en: "Share",
    ua: "Частка",
  },
  "analytics.total": {
    en: "total poses",
    ua: "всього поз",
  },
  "analytics.balance_score": {
    en: "Training balance score",
    ua: "Оцінка балансу тренувань",
  },
  "analytics.well_balanced": {
    en: "Well Balanced",
    ua: "Добре збалансовано",
  },
  "analytics.moderate_balance": {
    en: "Moderate Balance",
    ua: "Середній баланс",
  },
  "analytics.needs_attention": {
    en: "Needs Attention",
    ua: "Потребує уваги",
  },
  "analytics.activity.created": {
    en: "Created",
    ua: "Створено",
  },
  "analytics.activity.updated": {
    en: "Updated",
    ua: "Оновлено",
  },
  "analytics.activity.photo_generated": {
    en: "Photo generated",
    ua: "Фото згенеровано",
  },
  "analytics.has_photo": {
    en: "Has photo",
    ua: "Є фото",
  },
  "analytics.heatmap.front": {
    en: "Front",
    ua: "Спереду",
  },
  "analytics.heatmap.back": {
    en: "Back",
    ua: "Ззаду",
  },
  "analytics.heatmap.high": {
    en: "High",
    ua: "Високо",
  },
  "analytics.heatmap.medium": {
    en: "Medium",
    ua: "Середньо",
  },
  "analytics.heatmap.low": {
    en: "Low",
    ua: "Низько",
  },
  "analytics.heatmap.none": {
    en: "None",
    ua: "Немає",
  },
  "analytics.error": {
    en: "Failed to load analytics data",
    ua: "Не вдалося завантажити дані аналітики",
  },
  "analytics.try_again": {
    en: "Try again",
    ua: "Спробувати знову",
  },

  // Sequences translations
  "nav.sequences": {
    en: "Sequences",
    ua: "Послідовності",
  },
  "sequences.title": {
    en: "Pose Sequences",
    ua: "Послідовності поз",
  },
  "sequences.subtitle": {
    en: "{count} sequences",
    ua: "{count} послідовностей",
  },
  "sequences.new": {
    en: "New Sequence",
    ua: "Нова послідовність",
  },
  "sequences.empty": {
    en: "No sequences yet",
    ua: "Послідовностей ще немає",
  },
  "sequences.empty_hint": {
    en: "Create your first pose sequence to get started",
    ua: "Створіть свою першу послідовність поз, щоб почати",
  },
  "sequences.create_first": {
    en: "Create First Sequence",
    ua: "Створити першу послідовність",
  },
  "sequences.error_fetch": {
    en: "Failed to load sequences",
    ua: "Не вдалося завантажити послідовності",
  },
  "sequences.poses": {
    en: "poses",
    ua: "поз",
  },
  "sequences.difficulty.beginner": {
    en: "Beginner",
    ua: "Початківець",
  },
  "sequences.difficulty.intermediate": {
    en: "Intermediate",
    ua: "Середній",
  },
  "sequences.difficulty.advanced": {
    en: "Advanced",
    ua: "Просунутий",
  },
  "sequences.create_new": {
    en: "Create New Sequence",
    ua: "Створити нову послідовність",
  },
  "sequences.create_description": {
    en: "Define a sequence of poses with timing for guided practice",
    ua: "Визначте послідовність поз з таймінгом для керованої практики",
  },
  "sequences.name": {
    en: "Sequence Name",
    ua: "Назва послідовності",
  },
  "sequences.name_placeholder": {
    en: "e.g., Morning Flow, Relaxation Routine",
    ua: "напр., Ранковий потік, Розслаблюючий комплекс",
  },
  "sequences.description": {
    en: "Description (optional)",
    ua: "Опис (необов'язково)",
  },
  "sequences.description_placeholder": {
    en: "Brief description of the sequence...",
    ua: "Короткий опис послідовності...",
  },
  "sequences.difficulty": {
    en: "Difficulty Level",
    ua: "Рівень складності",
  },
  "sequences.create": {
    en: "Create Sequence",
    ua: "Створити послідовність",
  },
  "sequences.back_to_list": {
    en: "Back to Sequences",
    ua: "Назад до послідовностей",
  },
  "sequences.not_found": {
    en: "Sequence not found",
    ua: "Послідовність не знайдено",
  },
  "sequences.play": {
    en: "Play",
    ua: "Відтворити",
  },
  "sequences.builder": {
    en: "Builder",
    ua: "Редактор",
  },
  "sequences.player": {
    en: "Player",
    ua: "Програвач",
  },
  "sequences.poses_in_sequence": {
    en: "Poses in Sequence",
    ua: "Пози в послідовності",
  },
  "sequences.total": {
    en: "total",
    ua: "всього",
  },
  "sequences.add_pose": {
    en: "Add Pose",
    ua: "Додати позу",
  },
  "sequences.save_changes": {
    en: "Save Changes",
    ua: "Зберегти зміни",
  },
  "sequences.no_poses_yet": {
    en: "No poses in this sequence yet",
    ua: "У цій послідовності ще немає поз",
  },
  "sequences.add_first_pose": {
    en: "Add First Pose",
    ua: "Додати першу позу",
  },
  "sequences.search_poses": {
    en: "Search poses...",
    ua: "Пошук поз...",
  },
  "sequences.no_poses_available": {
    en: "No more poses available to add",
    ua: "Більше немає поз для додавання",
  },
  "sequences.seconds": {
    en: "sec",
    ua: "сек",
  },
  "sequences.delete_confirm_title": {
    en: "Delete Sequence?",
    ua: "Видалити послідовність?",
  },
  "sequences.delete_confirm_message": {
    en: "Are you sure you want to delete \"{name}\"? This action cannot be undone.",
    ua: "Ви впевнені, що хочете видалити \"{name}\"? Цю дію неможливо скасувати.",
  },
  "sequences.no_poses_to_play": {
    en: "Add poses to the sequence to start playback",
    ua: "Додайте пози до послідовності, щоб почати відтворення",
  },
  "sequences.no_pose": {
    en: "No pose",
    ua: "Немає пози",
  },
  "sequences.drag_to_reorder": {
    en: "Drag to reorder",
    ua: "Перетягніть для перестановки",
  },
  "sequences.remove_pose": {
    en: "Remove pose",
    ua: "Видалити позу",
  },
  "sequences.error_loading_poses": {
    en: "Error loading poses",
    ua: "Помилка завантаження поз",
  },
  "app.retry": {
    en: "Retry",
    ua: "Повторити",
  },
  "app.previous": {
    en: "Previous",
    ua: "Попередня",
  },
  "app.next": {
    en: "Next",
    ua: "Наступна",
  },
  "app.page_of": {
    en: "Page {current} of {total}",
    ua: "Сторінка {current} з {total}",
  },
  "app.cancel": {
    en: "Cancel",
    ua: "Скасувати",
  },
  "app.saving": {
    en: "Saving...",
    ua: "Збереження...",
  },
  "app.save": {
    en: "Save",
    ua: "Зберегти",
  },
  "app.edit": {
    en: "Edit",
    ua: "Редагувати",
  },
  "app.delete": {
    en: "Delete",
    ua: "Видалити",
  },

  // Version History translations
  "versions.title": {
    en: "Version History",
    ua: "Історія версій",
  },
  "versions.error_loading": {
    en: "Failed to load version history",
    ua: "Не вдалося завантажити історію версій",
  },
  "versions.retry": {
    en: "Retry",
    ua: "Повторити",
  },
  "versions.compare_selected": {
    en: "{count} selected for comparison",
    ua: "{count} вибрано для порівняння",
  },
  "versions.clear_selection": {
    en: "Clear",
    ua: "Очистити",
  },
  "versions.compare": {
    en: "Compare",
    ua: "Порівняти",
  },
  "versions.no_history": {
    en: "No version history yet",
    ua: "Історії версій ще немає",
  },
  "versions.no_history_hint": {
    en: "Version history will appear after you make changes to this pose",
    ua: "Історія версій з'явиться після внесення змін до цієї пози",
  },
  "versions.current": {
    en: "current",
    ua: "поточна",
  },
  "versions.by": {
    en: "by",
    ua: "автор:",
  },
  "versions.select_for_compare": {
    en: "Select for comparison",
    ua: "Вибрати для порівняння",
  },
  "versions.view": {
    en: "View details",
    ua: "Переглянути деталі",
  },
  "versions.restore": {
    en: "Restore",
    ua: "Відновити",
  },
  "versions.compare_title": {
    en: "Version Comparison",
    ua: "Порівняння версій",
  },
  "versions.diff_error": {
    en: "Failed to compare versions",
    ua: "Не вдалося порівняти версії",
  },
  "versions.older": {
    en: "older",
    ua: "старіша",
  },
  "versions.newer": {
    en: "newer",
    ua: "новіша",
  },
  "versions.no_differences": {
    en: "No differences found between these versions",
    ua: "Не знайдено відмінностей між цими версіями",
  },
  "versions.changes_count": {
    en: "{count} changes",
    ua: "{count} змін",
  },
  "versions.before": {
    en: "Before",
    ua: "До",
  },
  "versions.after": {
    en: "After",
    ua: "Після",
  },
  "versions.image_present": {
    en: "Image present",
    ua: "Зображення є",
  },
  "versions.value.empty": {
    en: "(empty)",
    ua: "(порожньо)",
  },
  "versions.value.items": {
    en: "items",
    ua: "елементів",
  },
  "versions.field.name": {
    en: "Name",
    ua: "Назва",
  },
  "versions.field.name_en": {
    en: "Name (EN)",
    ua: "Назва (EN)",
  },
  "versions.field.code": {
    en: "Code",
    ua: "Код",
  },
  "versions.field.category": {
    en: "Category",
    ua: "Категорія",
  },
  "versions.field.description": {
    en: "Description",
    ua: "Опис",
  },
  "versions.field.effect": {
    en: "Effect",
    ua: "Ефект",
  },
  "versions.field.breathing": {
    en: "Breathing",
    ua: "Дихання",
  },
  "versions.field.schema": {
    en: "Schema",
    ua: "Схема",
  },
  "versions.field.photo": {
    en: "Photo",
    ua: "Фото",
  },
  "versions.field.muscle_layer": {
    en: "Muscle Layer",
    ua: "Шар м'язів",
  },
  "versions.field.skeleton_layer": {
    en: "Skeleton Layer",
    ua: "Шар скелету",
  },
  "versions.field.muscles": {
    en: "Muscles",
    ua: "М'язи",
  },
  "versions.restore_title": {
    en: "Restore Version",
    ua: "Відновити версію",
  },
  "versions.restore_description": {
    en: "Restore pose to version {version}",
    ua: "Відновити позу до версії {version}",
  },
  "versions.restore_warning_title": {
    en: "This action will change the pose",
    ua: "Ця дія змінить позу",
  },
  "versions.restore_warning_text": {
    en: "The current state will be saved as a new version before restoring. You can always restore back if needed.",
    ua: "Поточний стан буде збережено як нову версію перед відновленням. Ви завжди можете відновити назад за потреби.",
  },
  "versions.restore_note_label": {
    en: "Reason for restoring (optional)",
    ua: "Причина відновлення (необов'язково)",
  },
  "versions.restore_note_placeholder": {
    en: "e.g., Reverting incorrect changes",
    ua: "напр., Повернення некоректних змін",
  },
  "versions.restore_note_hint": {
    en: "This note will be recorded in the version history",
    ua: "Ця примітка буде записана в історію версій",
  },
  "versions.cancel": {
    en: "Cancel",
    ua: "Скасувати",
  },
  "versions.restoring": {
    en: "Restoring...",
    ua: "Відновлення...",
  },
  "versions.restore_confirm": {
    en: "Restore Version",
    ua: "Відновити версію",
  },
  "versions.restore_error": {
    en: "Failed to restore version",
    ua: "Не вдалося відновити версію",
  },
  "versions.detail_title": {
    en: "Version Details",
    ua: "Деталі версії",
  },
  "versions.snapshot_data": {
    en: "Snapshot Data",
    ua: "Дані знімку",
  },
  "versions.images": {
    en: "Images",
    ua: "Зображення",
  },
  "versions.no_images": {
    en: "No images in this version",
    ua: "Немає зображень у цій версії",
  },
  "versions.change_note_label": {
    en: "Change Note",
    ua: "Примітка до змін",
  },
  "versions.change_note_placeholder": {
    en: "Describe what was changed (optional)",
    ua: "Опишіть що було змінено (необов'язково)",
  },
  "versions.change_note_hint": {
    en: "This note will be saved in the version history",
    ua: "Ця примітка буде збережена в історії версій",
  },

  // Export translations
  "export.title": {
    en: "Export",
    ua: "Експорт",
  },
  "export.choose_format": {
    en: "Choose format",
    ua: "Оберіть формат",
  },
  "export.json": {
    en: "JSON Format",
    ua: "Формат JSON",
  },
  "export.json_desc": {
    en: "Full data including all fields",
    ua: "Повні дані з усіма полями",
  },
  "export.csv": {
    en: "CSV Format",
    ua: "Формат CSV",
  },
  "export.csv_desc": {
    en: "Spreadsheet-compatible, no images",
    ua: "Для таблиць, без зображень",
  },
  "export.pdf": {
    en: "PDF",
    ua: "PDF",
  },
  "export.pdf_single_desc": {
    en: "Beautiful document with images",
    ua: "Гарний документ із зображеннями",
  },
  "export.pdf_all": {
    en: "PDF Collection",
    ua: "PDF Колекція",
  },
  "export.pdf_all_desc": {
    en: "All poses in one document",
    ua: "Всі пози в одному документі",
  },
  "export.backup": {
    en: "Full Backup",
    ua: "Повний бекап",
  },
  "export.backup_desc": {
    en: "Categories + poses for restore",
    ua: "Категорії + пози для відновлення",
  },
  "export.progress_title": {
    en: "Exporting Data",
    ua: "Експорт даних",
  },
  "export.status_preparing": {
    en: "Preparing export...",
    ua: "Підготовка експорту...",
  },
  "export.status_generating": {
    en: "Generating file...",
    ua: "Генерація файлу...",
  },
  "export.status_downloading": {
    en: "Downloading...",
    ua: "Завантаження...",
  },
  "export.status_complete": {
    en: "Export complete!",
    ua: "Експорт завершено!",
  },
  "export.status_error": {
    en: "Export failed",
    ua: "Помилка експорту",
  },
  "export.retry": {
    en: "Retry",
    ua: "Повторити",
  },
  "export.done": {
    en: "Done",
    ua: "Готово",
  },
  "export.close": {
    en: "Close",
    ua: "Закрити",
  },

  // Import translations
  "import.title": {
    en: "Import",
    ua: "Імпорт",
  },
  "import.description": {
    en: "Upload a file to import poses and categories",
    ua: "Завантажте файл для імпорту поз та категорій",
  },
  "import.file_type": {
    en: "File Type",
    ua: "Тип файлу",
  },
  "import.backup": {
    en: "Backup",
    ua: "Бекап",
  },
  "import.drag_drop": {
    en: "Drag & drop your file here or click to browse",
    ua: "Перетягніть файл сюди або натисніть для вибору",
  },
  "import.drop_here": {
    en: "Drop file here...",
    ua: "Відпустіть файл тут...",
  },
  "import.max_size": {
    en: "Maximum file size: 10MB",
    ua: "Максимальний розмір: 10MB",
  },
  "import.choose_different": {
    en: "Choose different file",
    ua: "Обрати інший файл",
  },
  "import.duplicate_handling": {
    en: "Duplicate Handling",
    ua: "Обробка дублікатів",
  },
  "import.duplicate_skip": {
    en: "Skip duplicates (keep existing)",
    ua: "Пропустити дублікати (залишити існуючі)",
  },
  "import.duplicate_overwrite": {
    en: "Overwrite duplicates",
    ua: "Перезаписати дублікати",
  },
  "import.duplicate_rename": {
    en: "Rename duplicates (add suffix)",
    ua: "Перейменувати дублікати (додати суфікс)",
  },
  "import.preview": {
    en: "Preview",
    ua: "Попередній перегляд",
  },
  "import.previewing": {
    en: "Loading preview...",
    ua: "Завантаження перегляду...",
  },
  "import.import_btn": {
    en: "Import",
    ua: "Імпортувати",
  },
  "import.importing": {
    en: "Importing...",
    ua: "Імпортування...",
  },
  "import.cancel": {
    en: "Cancel",
    ua: "Скасувати",
  },
  "import.close": {
    en: "Close",
    ua: "Закрити",
  },
  "import.success": {
    en: "Import Successful!",
    ua: "Імпорт успішний!",
  },
  "import.partial_success": {
    en: "Import Completed with Errors",
    ua: "Імпорт завершено з помилками",
  },
  "import.total": {
    en: "Total",
    ua: "Всього",
  },
  "import.created": {
    en: "Created",
    ua: "Створено",
  },
  "import.updated": {
    en: "Updated",
    ua: "Оновлено",
  },
  "import.skipped": {
    en: "Skipped",
    ua: "Пропущено",
  },
  "import.errors": {
    en: "errors",
    ua: "помилок",
  },
  "import.preview_title": {
    en: "Import Preview",
    ua: "Попередній перегляд імпорту",
  },
  "import.poses": {
    en: "poses",
    ua: "поз",
  },
  "import.categories": {
    en: "categories",
    ua: "категорій",
  },
  "import.will_create": {
    en: "Will create",
    ua: "Буде створено",
  },
  "import.will_update": {
    en: "Will update",
    ua: "Буде оновлено",
  },
  "import.will_skip": {
    en: "Will skip",
    ua: "Буде пропущено",
  },
  "import.item": {
    en: "Item",
    ua: "Елемент",
  },
  "import.type": {
    en: "Type",
    ua: "Тип",
  },
  "import.action": {
    en: "Action",
    ua: "Дія",
  },
  "import.pose": {
    en: "Pose",
    ua: "Поза",
  },
  "import.category": {
    en: "Category",
    ua: "Категорія",
  },
  "import.validation_errors": {
    en: "Validation Errors",
    ua: "Помилки валідації",
  },
  "import.more_errors": {
    en: "more errors",
    ua: "ще помилок",
  },

  // Common translations
  "common.loading": {
    en: "Loading...",
    ua: "Завантаження...",
  },

  // Navigation accessibility
  "nav.open_menu": {
    en: "Open navigation menu",
    ua: "Відкрити навігаційне меню",
  },
  "nav.close_menu": {
    en: "Close navigation menu",
    ua: "Закрити навігаційне меню",
  },
  "nav.menu_description": {
    en: "Navigation menu with links to different sections of the application",
    ua: "Навігаційне меню з посиланнями на різні розділи додатку",
  },
  "nav.user_settings": {
    en: "Open user settings",
    ua: "Відкрити налаштування користувача",
  },
  "nav.settings": {
    en: "Settings",
    ua: "Налаштування",
  },
  "nav.dark_mode": {
    en: "Dark mode",
    ua: "Темна тема",
  },
  "nav.light_mode": {
    en: "Light mode",
    ua: "Світла тема",
  },
  "nav.no_categories": {
    en: "No categories yet",
    ua: "Категорій ще немає",
  },
  "nav.add_category": {
    en: "Add category",
    ua: "Додати категорію",
  },

  // Category management
  "category.create_title": {
    en: "Create Category",
    ua: "Створити категорію",
  },
  "category.create_description": {
    en: "Add a new category to organize your poses",
    ua: "Додайте нову категорію для організації ваших поз",
  },
  "category.name": {
    en: "Name",
    ua: "Назва",
  },
  "category.name_placeholder": {
    en: "e.g., Standing poses",
    ua: "напр., Стоячі пози",
  },
  "category.description": {
    en: "Description",
    ua: "Опис",
  },
  "category.description_placeholder": {
    en: "Optional description for this category",
    ua: "Необов'язковий опис для цієї категорії",
  },
  "category.create_button": {
    en: "Create Category",
    ua: "Створити категорію",
  },
  "category.created_success": {
    en: "Category created successfully",
    ua: "Категорію успішно створено",
  },
  "category.error_create": {
    en: "Failed to create category",
    ua: "Не вдалося створити категорію",
  },
  "category.error_name_required": {
    en: "Category name is required",
    ua: "Назва категорії обов'язкова",
  },
  "category.edit_title": {
    en: "Edit Category",
    ua: "Редагувати категорію",
  },
  "category.edit_description": {
    en: "Update the category name and description",
    ua: "Оновіть назву та опис категорії",
  },
  "category.updated_success": {
    en: "Category updated successfully",
    ua: "Категорію успішно оновлено",
  },
  "category.error_update": {
    en: "Failed to update category",
    ua: "Не вдалося оновити категорію",
  },
  "category.delete_title": {
    en: "Delete Category",
    ua: "Видалити категорію",
  },
  "category.delete_description": {
    en: "Are you sure you want to delete \"{name}\"? This action cannot be undone.",
    ua: "Ви впевнені, що хочете видалити \"{name}\"? Цю дію неможливо скасувати.",
  },
  "category.delete_warning_poses": {
    en: "This category contains {count} poses. They will become uncategorized.",
    ua: "Ця категорія містить {count} поз. Вони стануть без категорії.",
  },
  "category.delete_button": {
    en: "Delete",
    ua: "Видалити",
  },
  "category.deleted_success": {
    en: "Category deleted successfully",
    ua: "Категорію успішно видалено",
  },
  "category.error_delete": {
    en: "Failed to delete category",
    ua: "Не вдалося видалити категорію",
  },
  "category.edit": {
    en: "Edit",
    ua: "Редагувати",
  },
  "category.delete": {
    en: "Delete",
    ua: "Видалити",
  },

  "nav.skip_to_content": {
    en: "Skip to main content",
    ua: "Перейти до основного вмісту",
  },

  // Settings page
  "settings.title": {
    en: "Settings",
    ua: "Налаштування",
  },
  "settings.account": {
    en: "Account",
    ua: "Обліковий запис",
  },
  "settings.member_since": {
    en: "Member since",
    ua: "Учасник з",
  },
  "settings.language": {
    en: "Language",
    ua: "Мова",
  },
  "settings.language_description": {
    en: "Choose your preferred language for the interface",
    ua: "Виберіть бажану мову інтерфейсу",
  },
  "settings.about": {
    en: "About",
    ua: "Про додаток",
  },
  "settings.app_description": {
    en: "Yoga pose management platform",
    ua: "Платформа керування позами йоги",
  },
  "settings.version": {
    en: "Version",
    ua: "Версія",
  },

  // Header search accessibility
  "header.search_results": {
    en: "Search results",
    ua: "Результати пошуку",
  },

  // Compare accessibility
  "compare.remove_pose": {
    en: "Remove {name} from comparison",
    ua: "Видалити {name} з порівняння",
  },

  // Error handling translations
  "error.network_error": {
    en: "Network error. Please check your connection and try again.",
    ua: "Помилка мережі. Перевірте підключення та спробуйте знову.",
  },
  "error.session_expired": {
    en: "Your session has expired. Please log in again.",
    ua: "Ваша сесія закінчилася. Будь ласка, увійдіть знову.",
  },
  "error.token_refresh_failed": {
    en: "Failed to refresh authentication. Please log in again.",
    ua: "Не вдалося оновити автентифікацію. Будь ласка, увійдіть знову.",
  },
  "error.file_too_large": {
    en: "File is too large. Maximum size is {maxSize}.",
    ua: "Файл занадто великий. Максимальний розмір {maxSize}.",
  },

  // Accessibility - aria labels
  "aria.dismiss_notification": {
    en: "Dismiss notification",
    ua: "Закрити сповіщення",
  },
  "aria.notifications": {
    en: "Notifications",
    ua: "Сповіщення",
  },
  "aria.toggle_language": {
    en: "Toggle language",
    ua: "Змінити мову",
  },
  "aria.open_in_new_tab": {
    en: "Opens in new tab",
    ua: "Відкривається в новій вкладці",
  },
  "aria.required_field": {
    en: "Required field",
    ua: "Обов'язкове поле",
  },
  "aria.loading": {
    en: "Loading content",
    ua: "Завантаження вмісту",
  },
  "aria.image_preview": {
    en: "Image preview",
    ua: "Попередній перегляд зображення",
  },
  "aria.close_dialog": {
    en: "Close dialog",
    ua: "Закрити діалог",
  },
  "aria.expand_menu": {
    en: "Expand menu",
    ua: "Розгорнути меню",
  },
  "aria.collapse_menu": {
    en: "Collapse menu",
    ua: "Згорнути меню",
  },

  // Pluralization templates - these work with the plural() function
  // Format: { one: "1 item", few: "X items (2-4)", many: "X items (5+)" }
  "plural.pose": {
    en: { one: "pose", few: "poses", many: "poses" },
    ua: { one: "поза", few: "пози", many: "поз" },
  },
  "plural.category": {
    en: { one: "category", few: "categories", many: "categories" },
    ua: { one: "категорія", few: "категорії", many: "категорій" },
  },
  "plural.sequence": {
    en: { one: "sequence", few: "sequences", many: "sequences" },
    ua: { one: "послідовність", few: "послідовності", many: "послідовностей" },
  },
  "plural.muscle": {
    en: { one: "muscle", few: "muscles", many: "muscles" },
    ua: { one: "м'яз", few: "м'язи", many: "м'язів" },
  },
  "plural.version": {
    en: { one: "version", few: "versions", many: "versions" },
    ua: { one: "версія", few: "версії", many: "версій" },
  },
  "plural.item": {
    en: { one: "item", few: "items", many: "items" },
    ua: { one: "елемент", few: "елементи", many: "елементів" },
  },
  "plural.second": {
    en: { one: "second", few: "seconds", many: "seconds" },
    ua: { one: "секунда", few: "секунди", many: "секунд" },
  },
  "plural.minute": {
    en: { one: "minute", few: "minutes", many: "minutes" },
    ua: { one: "хвилина", few: "хвилини", many: "хвилин" },
  },
  "plural.hour": {
    en: { one: "hour", few: "hours", many: "hours" },
    ua: { one: "година", few: "години", many: "годин" },
  },
  "plural.day": {
    en: { one: "day", few: "days", many: "days" },
    ua: { one: "день", few: "дні", many: "днів" },
  },
  "plural.change": {
    en: { one: "change", few: "changes", many: "changes" },
    ua: { one: "зміна", few: "зміни", many: "змін" },
  },
  "plural.file": {
    en: { one: "file", few: "files", many: "files" },
    ua: { one: "файл", few: "файли", many: "файлів" },
  },
  "plural.error": {
    en: { one: "error", few: "errors", many: "errors" },
    ua: { one: "помилка", few: "помилки", many: "помилок" },
  },
  "plural.selected": {
    en: { one: "selected", few: "selected", many: "selected" },
    ua: { one: "вибрано", few: "вибрано", many: "вибрано" },
  },
  "plural.activation": {
    en: { one: "activation", few: "activations", many: "activations" },
    ua: { one: "активація", few: "активації", many: "активацій" },
  },

} as const;

const defaultLocale: Locale = "ua";

const formatText = (value: TranslationValue, params?: Record<string, string | number>) => {
  if (typeof value === "string") {
    if (!params) {
      return value;
    }
    return Object.entries(params).reduce((result, [key, paramValue]) => {
      return result.split(`{${key}}`).join(String(paramValue));
    }, value);
  }
  return value(params);
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

/**
 * Determine text direction based on locale.
 * Currently all supported locales are LTR, but this provides RTL support infrastructure.
 */
const getTextDirection = (_locale: Locale): "ltr" | "rtl" => {
  // Future RTL support: add RTL locale codes here
  // const rtlLocales = ["ar", "he", "fa", "ur"];
  // return rtlLocales.includes(_locale) ? "rtl" : "ltr";
  return "ltr";
};

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);

  // Update document direction and lang attributes when locale changes
  useEffect(() => {
    if (typeof document !== "undefined") {
      const dir = getTextDirection(locale);
      document.documentElement.setAttribute("dir", dir);
      document.documentElement.setAttribute("lang", locale === "ua" ? "uk" : locale);
    }
  }, [locale]);

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState((prevLocale) => {
      if (prevLocale === nextLocale) {
        return prevLocale;
      }
      if (typeof window !== "undefined") {
        window.localStorage.setItem("yoga_locale", nextLocale);
      }
      return nextLocale;
    });
  }, []);

  const t = useCallback(
    (key: keyof typeof translations, params?: Record<string, string | number>) => {
      const entry = translations[key];
      const value = entry[locale] ?? entry[defaultLocale];
      // Skip pluralization entries (they have {one, few, many} structure)
      if (typeof value === "object" && !("call" in value)) {
        return String(value);
      }
      return formatText(value as TranslationValue, params);
    },
    [locale]
  );

  /**
   * Get pluralized form based on count and locale.
   * Ukrainian has 3 forms: one (1, 21...), few (2-4, 22-24...), many (0, 5-20...)
   * English has 2 forms: one (1), many (everything else)
   */
  const plural = useCallback(
    (count: number, forms: { one: string; few?: string; many: string }): string => {
      if (locale === "ua") {
        const form = getUkrainianPluralForm(count);
        // For Ukrainian, use the appropriate form
        if (form === "few" && forms.few) {
          return forms.few;
        }
        if (form === "one") {
          return forms.one;
        }
        return forms.many;
      } else {
        // English: simple singular/plural
        const form = getEnglishPluralForm(count);
        return form === "one" ? forms.one : forms.many;
      }
    },
    [locale]
  );

  // Wrapped formatting functions that use current locale
  const formatNumberFn = useCallback(
    (value: number) => formatNumber(value, locale),
    [locale]
  );

  const formatDateFn = useCallback(
    (date: Date | string | number, options?: Intl.DateTimeFormatOptions) =>
      formatDate(date, locale, options),
    [locale]
  );

  const formatDateTimeFn = useCallback(
    (date: Date | string | number, options?: Intl.DateTimeFormatOptions) =>
      formatDateTime(date, locale, options),
    [locale]
  );

  const formatRelativeTimeFn = useCallback(
    (date: Date | string | number) => formatRelativeTime(date, locale),
    [locale]
  );

  const dir = useMemo(() => getTextDirection(locale), [locale]);

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t,
      plural,
      formatNumber: formatNumberFn,
      formatDate: formatDateFn,
      formatDateTime: formatDateTimeFn,
      formatRelativeTime: formatRelativeTimeFn,
      dir,
    }),
    [locale, setLocale, t, plural, formatNumberFn, formatDateFn, formatDateTimeFn, formatRelativeTimeFn, dir]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

// Hook exported separately to help with Fast Refresh
export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return context;
}

// Export pluralization keys type for type safety
export type PluralKey =
  | "plural.pose"
  | "plural.category"
  | "plural.sequence"
  | "plural.muscle"
  | "plural.version"
  | "plural.item"
  | "plural.second"
  | "plural.minute"
  | "plural.hour"
  | "plural.day"
  | "plural.change"
  | "plural.file"
  | "plural.error"
  | "plural.selected"
  | "plural.activation";

/**
 * Helper to get plural forms from translations by key.
 * Usage: const forms = getPluralForms("plural.pose", locale);
 *        const text = `${count} ${plural(count, forms)}`;
 */
export const getPluralForms = (
  key: PluralKey,
  locale: Locale
): { one: string; few?: string; many: string } => {
  const entry = translations[key];
  return (entry[locale] ?? entry[defaultLocale]) as { one: string; few?: string; many: string };
};
