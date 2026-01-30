import React, { useCallback, useRef, useState } from "react";
import { usePoseImageSrc } from "../../hooks/usePoseImageSrc";

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
  const retryingRef = useRef(false);

  const handleError = useCallback(() => {
    if (retryingRef.current || retrying) return;
    retryingRef.current = true;
    setRetrying(true);
    void refresh(true).finally(() => {
      retryingRef.current = false;
      setRetrying(false);
    });
  }, [refresh, retrying]);

  if (error && fallbackSrc) {
    return <img src={fallbackSrc} alt={alt} className={className} onClick={onClick} />;
  }

  if (!src && fallbackSrc) {
    return <img src={fallbackSrc} alt={alt} className={className} onClick={onClick} />;
  }

  if (!src) {
    return null;
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onClick={onClick}
      onError={handleError}
    />
  );
};
