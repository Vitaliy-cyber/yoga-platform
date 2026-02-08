import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { getSignedImageUrl } from "../services/api";
import { logger } from "../lib/logger";

const CACHE_TTL_BUFFER_MS = 30_000; // refresh 30s before expiry
const DEFAULT_TTL_MS = 5 * 60_000; // fallback 5 minutes

type CacheEntry = {
  url: string;
  expiresAt: number;
};

const signedUrlCache = new Map<string, CacheEntry>();

const getQueryParamInsensitive = (params: URLSearchParams, key: string): string | null => {
  const expected = key.toLowerCase();
  for (const [k, v] of params.entries()) {
    if (k.toLowerCase() === expected) return v;
  }
  return null;
};

const parseAwsAmzDate = (raw: string): number | null => {
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return null;
  const [, y, m, d, hh, mm, ss] = match;
  const time = Date.UTC(
    Number(y),
    Number(m) - 1,
    Number(d),
    Number(hh),
    Number(mm),
    Number(ss)
  );
  return Number.isFinite(time) ? time : null;
};

const parseExpiresAt = (url: string): number | null => {
  try {
    const parsed = new URL(url, window.location.origin);
    const expires = getQueryParamInsensitive(parsed.searchParams, "expires");
    if (expires) {
      const value = Number(expires);
      if (Number.isFinite(value)) {
        return value * 1000;
      }
    }

    // AWS-style presigned URL format:
    // - X-Amz-Date=YYYYMMDDTHHMMSSZ
    // - X-Amz-Expires=<seconds>
    const amzDateRaw = getQueryParamInsensitive(parsed.searchParams, "X-Amz-Date");
    const amzExpiresRaw = getQueryParamInsensitive(parsed.searchParams, "X-Amz-Expires");
    if (amzDateRaw && amzExpiresRaw) {
      const issuedAt = parseAwsAmzDate(amzDateRaw);
      const expiresSeconds = Number(amzExpiresRaw);
      if (issuedAt !== null && Number.isFinite(expiresSeconds)) {
        return issuedAt + expiresSeconds * 1000;
      }
    }

    return null;
  } catch {
    return null;
  }
};

const isLocalStoragePath = (directPath?: string | null): boolean =>
  Boolean(directPath && directPath.startsWith("/storage/"));

const upgradeToHttpsIfNeeded = (url: string): string => {
  if (typeof window !== "undefined" && window.location.protocol === "https:" && url.startsWith("http://")) {
    return url.replace(/^http:\/\//, "https://");
  }
  return url;
};

const canNormalizeLegacyHostPath = (raw: string): boolean => {
  const firstSegment = raw.split("/", 1)[0];
  if (!firstSegment.includes(".") || firstSegment.includes(" ")) {
    return false;
  }
  if (!raw.includes("/")) {
    return false;
  }

  // Keys like "abc123.photo.png" are storage object names, not valid hosts.
  const fileLikeTlds = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg"]);
  const tld = firstSegment.split(".").pop()?.toLowerCase() || "";
  if (fileLikeTlds.has(tld)) {
    return false;
  }

  return true;
};

const normalizeExternalImageUrl = (
  directPath?: string | null
): string | null => {
  if (!directPath) return null;
  const trimmed = directPath.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const normalized = upgradeToHttpsIfNeeded(trimmed);
    const expiresAt = parseExpiresAt(normalized);
    if (expiresAt !== null && expiresAt - Date.now() <= CACHE_TTL_BUFFER_MS) {
      return null;
    }
    return normalized;
  }
  if (trimmed.startsWith("//")) {
    const protocol =
      typeof window !== "undefined" ? window.location.protocol : "https:";
    const normalized = upgradeToHttpsIfNeeded(`${protocol}${trimmed}`);
    const expiresAt = parseExpiresAt(normalized);
    if (expiresAt !== null && expiresAt - Date.now() <= CACHE_TTL_BUFFER_MS) {
      return null;
    }
    return normalized;
  }
  if (trimmed.startsWith("/")) return null;

  // Handle legacy host/path values missing scheme, e.g.
  // "bucket.example.com/generated/pose.png"
  if (canNormalizeLegacyHostPath(trimmed)) {
    const normalized = upgradeToHttpsIfNeeded(`https://${trimmed}`);
    const expiresAt = parseExpiresAt(normalized);
    if (expiresAt !== null && expiresAt - Date.now() <= CACHE_TTL_BUFFER_MS) {
      return null;
    }
    return normalized;
  }

  return null;
};

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

const isApiLikeImageUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.pathname.startsWith("/api/");
  } catch {
    return false;
  }
};

export const usePoseImageSrc = (
  directPath: string | null | undefined,
  poseId: number,
  imageType: "schema" | "photo" | "muscle_layer" | "skeleton_layer",
  options: { enabled?: boolean; version?: number } = {}
) => {
  const enabled = options.enabled ?? true;
  const normalizedDirectUrl = useMemo(
    () => normalizeExternalImageUrl(directPath),
    [directPath]
  );
  const cacheKey = useMemo(
    () => buildCacheKey(poseId, imageType, normalizedDirectUrl ?? directPath, options.version),
    [directPath, imageType, normalizedDirectUrl, options.version, poseId]
  );
  const [src, setSrc] = useState<string>(() => {
    if (!enabled) return "";
    if (isLocalStoragePath(directPath)) return directPath || "";
    const cached = getCacheEntry(cacheKey);
    if (cached?.url) return cached.url;
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
        const status = axios.isAxiosError(err) ? err.response?.status : undefined;
        const isAuthError = status === 401 || status === 403;
        if (normalizedDirectUrl && !isAuthError && !isApiLikeImageUrl(normalizedDirectUrl)) {
          // If signed-url fetch fails, prefer showing the direct URL instead of an error state.
          // This keeps the UI resilient when the signed-url endpoint is temporarily unavailable.
          setSrc(normalizedDirectUrl);
          setError(false);
          return;
        }
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [cacheKey, directPath, enabled, imageType, normalizedDirectUrl, poseId]
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
    setSrc("");
  }, [cacheKey, directPath, enabled, normalizedDirectUrl]);

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
