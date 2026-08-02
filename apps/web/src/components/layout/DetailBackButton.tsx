import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

type DetailBackButtonProps = {
  fallbackTo: string;
  label?: string;
  className?: string;
};

/**
 * Prefer browser history when the user arrived from in-app navigation;
 * otherwise fall back to a sensible browse route.
 */
export function DetailBackButton({
  fallbackTo,
  label = "Back",
  className = "border-zinc-600",
}: DetailBackButtonProps) {
  const navigate = useNavigate();

  return (
    <Button
      type="button"
      size="lg"
      variant="outline"
      className={className}
      onClick={() => {
        if (window.history.length > 1) {
          navigate(-1);
          return;
        }
        navigate(fallbackTo);
      }}
    >
      ← {label}
    </Button>
  );
}
