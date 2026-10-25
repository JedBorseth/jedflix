import type { MouseEvent, ReactNode } from "react";
import { ProgressiveCoverImage } from "@/components/browse/ProgressiveCoverImage";
import { AppLink } from "@/components/layout/AppLink";
import { searchResultRowClassName } from "@/lib/searchResultRowStyles";
import { cn } from "@/lib/utils";

type SearchResultRowBodyProps = {
  imageUrl?: string | null;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  isActive?: boolean;
};

export function SearchResultRowBody({
  imageUrl,
  title,
  subtitle,
  trailing,
  isActive,
}: SearchResultRowBodyProps) {
  return (
    <>
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-zinc-800">
        {imageUrl ? (
          <ProgressiveCoverImage
            src={imageUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-zinc-500">
            {title.trim().charAt(0).toUpperCase() || "?"}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm", isActive ? "text-red-400" : "text-white")}>
          {title}
        </p>
        {subtitle ? (
          <p className="truncate text-xs text-zinc-500">{subtitle}</p>
        ) : null}
      </div>
      {trailing ? (
        <span className="shrink-0 text-xs text-zinc-500">{trailing}</span>
      ) : null}
    </>
  );
}

type SearchResultRowProps = {
  title: string;
  subtitle?: string;
  imageUrl?: string | null;
  trailing?: ReactNode;
  isActive?: boolean;
  compact?: boolean;
  to?: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  onMouseDown?: (event: MouseEvent<HTMLElement>) => void;
  disabled?: boolean;
};

export function SearchResultRow({
  title,
  subtitle,
  imageUrl,
  trailing,
  isActive,
  compact,
  to,
  onClick,
  onMouseDown,
  disabled,
}: SearchResultRowProps) {
  const className = searchResultRowClassName({ compact, isActive, disabled });
  const body = (
    <SearchResultRowBody
      imageUrl={imageUrl}
      title={title}
      subtitle={subtitle}
      trailing={trailing}
      isActive={isActive}
    />
  );

  if (to) {
    return (
      <AppLink
        to={to}
        className={className}
        onClick={onClick}
        onMouseDown={onMouseDown}
        aria-disabled={disabled || undefined}
      >
        {body}
      </AppLink>
    );
  }

  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      onMouseDown={onMouseDown}
      disabled={disabled}
    >
      {body}
    </button>
  );
}
