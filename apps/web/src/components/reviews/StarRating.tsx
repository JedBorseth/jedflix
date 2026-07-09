import { StarFilledIcon, StarIcon } from "@radix-ui/react-icons";

type StarRatingProps = {
  value: number;
  onChange?: (value: number) => void;
  size?: "sm" | "md";
};

export function StarRating({ value, onChange, size = "md" }: StarRatingProps) {
  const iconClass = size === "sm" ? "h-4 w-4" : "h-5 w-5";

  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }).map((_, index) => {
        const starValue = index + 1;
        const filled = starValue <= value;
        const StarComponent = filled ? StarFilledIcon : StarIcon;

        if (onChange) {
          return (
            <button
              key={starValue}
              type="button"
              aria-label={`Rate ${starValue} stars`}
              className="text-yellow-400 transition hover:scale-110"
              onClick={() => onChange(starValue)}
            >
              <StarComponent className={iconClass} />
            </button>
          );
        }

        return (
          <StarComponent
            key={starValue}
            className={`${iconClass} ${filled ? "text-yellow-400" : "text-zinc-600"}`}
            aria-hidden="true"
          />
        );
      })}
    </div>
  );
}
