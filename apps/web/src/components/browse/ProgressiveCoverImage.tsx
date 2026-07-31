import { useEffect, useState, type ImgHTMLAttributes } from "react";

type ProgressiveCoverImageProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "srcSet"
> & {
  /** Cached low-res (or placeholder) URL shown immediately. */
  src: string;
  /** Full-resolution Open Library URL; swapped in once decoded. */
  fullSrc?: string | null;
};

/**
 * Shows the cached low-quality cover first, then replaces it with the
 * Open Library full-resolution image when that has finished loading.
 */
export function ProgressiveCoverImage({
  src,
  fullSrc,
  alt,
  className,
  onLoad,
  ...rest
}: ProgressiveCoverImageProps) {
  const upgradeSrc =
    fullSrc && fullSrc !== src && !src.includes("placehold.co") ? fullSrc : null;
  const [displaySrc, setDisplaySrc] = useState(src);
  const [upgraded, setUpgraded] = useState(false);

  useEffect(() => {
    setDisplaySrc(src);
    setUpgraded(false);

    if (!upgradeSrc) {
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (cancelled) {
        return;
      }
      setDisplaySrc(upgradeSrc);
      setUpgraded(true);
    };
    img.onerror = () => {
      // Keep the cached low-res image if the full Open Library fetch fails.
    };
    img.src = upgradeSrc;

    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
    };
  }, [src, upgradeSrc]);

  return (
    <img
      {...rest}
      src={displaySrc}
      alt={alt}
      className={className}
      data-cover-upgraded={upgraded ? "true" : "false"}
      onLoad={onLoad}
    />
  );
}
