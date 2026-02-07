import React, { useCallback, useEffect, useRef, useState } from "react";
import { usePoseImageSrc } from "../../hooks/usePoseImageSrc";
import { cn } from "../../lib/utils";

type PoseImageProps = {
  poseId: number;
  imageType: "schema" | "photo" | "muscle_layer" | "skeleton_layer";
  directPath?: string | null;
  alt: string;
  className?: string;
  fallbackSrc?: string;
  onClick?: () => void;
  enabled?: boolean;
};

const loadedImageSrcCache = new Set<string>();

export const PoseImage: React.FC<PoseImageProps> = ({
  poseId,
  imageType,
  directPath,
  alt,
  className,
  fallbackSrc,
  onClick,
  enabled = true,
}) => {
  const { src, error, refresh } = usePoseImageSrc(directPath, poseId, imageType, { enabled });
  const [retrying, setRetrying] = useState(false);
  const [loaded, setLoaded] = useState<boolean>(() => Boolean(src && loadedImageSrcCache.has(src)));
  const retryingRef = useRef(false);

  useEffect(() => {
    setLoaded(Boolean(src && loadedImageSrcCache.has(src)));
  }, [src]);

  const handleError = useCallback(() => {
    if (retryingRef.current || retrying) return;
    retryingRef.current = true;
    setRetrying(true);
    void refresh(true).finally(() => {
      retryingRef.current = false;
      setRetrying(false);
    });
  }, [refresh, retrying]);

  const handleLoad = useCallback(() => {
    if (src) {
      loadedImageSrcCache.add(src);
    }
    setLoaded(true);
  }, [src]);

  if (error && fallbackSrc) {
    return <img src={fallbackSrc} alt={alt} className={className} onClick={onClick} />;
  }

  if (!src && fallbackSrc) {
    return <img src={fallbackSrc} alt={alt} className={className} onClick={onClick} />;
  }

  if (!src) {
    return (
      <div
        className={cn("animate-shimmer", className)}
        role="status"
        aria-busy="true"
      >
        <span className="sr-only">Loading image...</span>
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden", className)} onClick={onClick}>
      {!loaded && (
        <div
          className="absolute inset-0 animate-shimmer"
          role="status"
          aria-busy="true"
        >
          <span className="sr-only">Loading image...</span>
        </div>
      )}
      <img
        src={src}
        alt={alt}
        className={cn(
          "w-full h-full object-cover transition-opacity duration-300",
          loaded ? "opacity-100" : "opacity-0"
        )}
        onError={handleError}
        onLoad={handleLoad}
      />
    </div>
  );
};
