import { useCallback, useEffect, useRef, useState } from "react";
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

export const usePoseImageSrc = (
  directPath: string | null | undefined,
  poseId: number,
  imageType: "schema" | "photo" | "muscle_layer" | "skeleton_layer",
  options: { enabled?: boolean } = {}
) => {
  const [src, setSrc] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const usedDirectFallback = useRef(false);
  const enabled = options.enabled ?? true;

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

      const cacheKey = `${poseId}:${imageType}`;
      const cached = signedUrlCache.get(cacheKey);
      if (!force && cached && cached.expiresAt - Date.now() > CACHE_TTL_BUFFER_MS) {
        setSrc(cached.url);
        setLoading(false);
        setError(false);
        return;
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
        if (isHttpUrl(directPath) && !usedDirectFallback.current) {
          usedDirectFallback.current = true;
          setSrc(directPath || "");
          setError(false);
        } else {
          setError(true);
        }
      } finally {
        setLoading(false);
      }
    },
    [directPath, enabled, imageType, poseId]
  );

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
