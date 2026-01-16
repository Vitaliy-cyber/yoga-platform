import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

export type Locale = "en" | "ua";

type TranslationValue = string | ((params?: Record<string, string | number>) => string);

// @ts-expect-error - type kept for documentation purposes
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _TranslationDict = Record<string, TranslationValue>;

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: keyof typeof translations, params?: Record<string, string | number>) => string;
}

const translations = {
  "app.name": {
    en: "Pose Studio",
    ua: "Студія Поз",
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
  "nav.dashboard": {
    en: "Dashboard",
    ua: "Головна",
  },
  "nav.gallery": {
    en: "Gallery",
    ua: "Галерея",
  },
  "nav.upload": {
    en: "Upload",
    ua: "Завантажити",
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
    en: "Additional notes (optional)",
    ua: "Додаткові примітки (необов'язково)",
  },
  "generate.notes_placeholder": {
    en: "e.g., Male subject, athletic build, specific lighting preferences...",
    ua: "наприклад: чоловік, спортивна статура, освітлення...",
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
    en: "This may take up to a minute. Please don't close this window.",
    ua: "Це може зайняти до хвилини. Не закривайте це вікно.",
  },
  "generate.schema_fetch_failed": {
    en: "Failed to fetch schema",
    ua: "Не вдалося завантажити схему",
  },
  "generate.save_failed": {
    en: "Failed to save generated images",
    ua: "Не вдалося зберегти згенеровані зображення",
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
  "generate.error_failed": {
    en: "Generation failed",
    ua: "Помилка генерації",
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
  "login.footer": {
    en: "Your poses and categories are private to your account",
    ua: "Ваші пози та категорії доступні лише вам",
  },
  "login.header": {
    en: "Pose Studio",
    ua: "Студія Поз",
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

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === "undefined") {
      return defaultLocale;
    }
    const stored = window.localStorage.getItem("yoga_locale");
    if (stored === "en" || stored === "ua") {
      return stored;
    }
    return defaultLocale;
  });

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("yoga_locale", nextLocale);
    }
  }, []);

  const t = useCallback(
    (key: keyof typeof translations, params?: Record<string, string | number>) => {
      const entry = translations[key];
      const value = entry[locale] ?? entry[defaultLocale];
      return formatText(value, params);
    },
    [locale]
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

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
