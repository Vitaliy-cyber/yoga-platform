import { useCallback, useEffect, useMemo, useState } from "react";
import { getSignedImageUrl } from "../services/api";
import { logger } from "../lib/logger";

const CACHE_TTL_BUFFER_MS = 30_000; // refresh 30s before expiry
const DEFAULT_TTL_MS = 5 * 60_000; // fallback 5 minutes

type CacheEntry = {
  url: string;
  expiresAt: number;
};

const signedUrlCache = new Map<string, CacheEntry>();

const parseExpiresAt = (url: string): number | null => {
  try {
    const parsed = new URL(url, window.location.origin);
    const expires = parsed.searchParams.get("expires");
    if (!expires) return null;
    const value = Number(expires);
    if (!Number.isFinite(value)) return null;
    return value * 1000;
  } catch {
    return null;
  }
};

const isLocalStoragePath = (directPath?: string | null): boolean =>
  Boolean(directPath && directPath.startsWith("/storage/"));

const isHttpUrl = (directPath?: string | null): boolean =>
  Boolean(directPath && (directPath.startsWith("http://") || directPath.startsWith("https://")));

const buildCacheKey = (
  poseId: number,
  imageType: "schema" | "photo" | "muscle_layer" | "skeleton_layer",
  directPath: string | null | undefined,
  version?: number
): string =>
  typeof version === "number"
    ? `${poseId}:${imageType}:v${version}`
    : `${poseId}:${imageType}:${directPath ?? ""}`;

const getCacheEntry = (cacheKey: string): CacheEntry | undefined =>
  signedUrlCache.get(cacheKey);

const isFreshCacheEntry = (entry: CacheEntry): boolean =>
  entry.expiresAt - Date.now() > CACHE_TTL_BUFFER_MS;

export const usePoseImageSrc = (
  directPath: string | null | undefined,
  poseId: number,
  imageType: "schema" | "photo" | "muscle_layer" | "skeleton_layer",
  options: { enabled?: boolean; version?: number } = {}
) => {
  const enabled = options.enabled ?? true;
  const cacheKey = useMemo(
    () => buildCacheKey(poseId, imageType, directPath, options.version),
    [directPath, imageType, options.version, poseId]
  );
  const [src, setSrc] = useState<string>(() => {
    if (!enabled) return "";
    if (isLocalStoragePath(directPath)) return directPath || "";
    const cached = getCacheEntry(cacheKey);
    if (cached?.url) return cached.url;
    if (isHttpUrl(directPath)) return directPath || "";
    return "";
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const refresh = useCallback(
    async (force = false) => {
      if (!enabled) {
        setSrc("");
        setLoading(false);
        setError(false);
        return;
      }
      if (isLocalStoragePath(directPath)) {
        setSrc(directPath || "");
        setLoading(false);
        setError(false);
        return;
      }

      const cached = getCacheEntry(cacheKey);
      if (!force && cached && isFreshCacheEntry(cached)) {
        setSrc(cached.url);
        setLoading(false);
        setError(false);
        return;
      }

      // Keep an already-renderable source visible while refreshing signed URL.
      // This avoids white flashes during cache refresh and remounts.
      if (!force) {
        if (cached?.url) {
          setSrc((prev) => prev || cached.url);
        } else if (isHttpUrl(directPath)) {
          setSrc((prev) => prev || directPath || "");
        }
      }

      setLoading(true);
      setError(false);

      try {
        const signedUrl = await getSignedImageUrl(poseId, imageType, { allowProxyFallback: false });
        const expiresAt = parseExpiresAt(signedUrl) ?? Date.now() + DEFAULT_TTL_MS;
        signedUrlCache.set(cacheKey, { url: signedUrl, expiresAt });
        setSrc(signedUrl);
        setError(false);
      } catch (err) {
        logger.warn(`Failed to fetch signed image URL for pose ${poseId} (${imageType})`, err);
        if (isHttpUrl(directPath)) {
          // If signed-url fetch fails, prefer showing the direct URL instead of an error state.
          // This keeps the UI resilient when the signed-url endpoint is temporarily unavailable.
          setSrc(directPath || "");
          setError(false);
          return;
        }
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [cacheKey, directPath, enabled, imageType, poseId]
  );

  useEffect(() => {
    if (!enabled) return;
    if (isLocalStoragePath(directPath)) return;

    const cached = getCacheEntry(cacheKey);
    if (cached?.url) {
      setSrc(cached.url);
      setLoading(false);
      setError(false);
      return;
    }
    if (isHttpUrl(directPath)) {
      setSrc((prev) => prev || directPath || "");
      return;
    }
    setSrc("");
  }, [cacheKey, directPath, enabled]);

  useEffect(() => {
    if (!enabled) {
      setSrc("");
      setLoading(false);
      setError(false);
      return;
    }
    void refresh(false);
  }, [enabled, refresh]);

  return { src, loading, error, refresh };
};
