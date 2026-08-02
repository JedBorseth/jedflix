import { useEffect } from "react";
import { isRouteErrorResponse, Link, useNavigate, useRouteError } from "react-router-dom";
import { Button } from "@/components/ui/button";

function friendlyMessage(error: unknown): { title: string; detail: string } {
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      return { title: "Page not found", detail: "That page doesn’t exist." };
    }
    return {
      title: "Something went wrong",
      detail: error.statusText || `Request failed (${error.status}).`,
    };
  }
  if (error instanceof Error) {
    const isMaxDepth =
      /maximum update depth/i.test(error.message) || /Minified React error #185/i.test(error.message);
    if (isMaxDepth) {
      return {
        title: "Something went wrong",
        detail: "This screen got stuck updating. Try going back or reloading.",
      };
    }
    return {
      title: "Something went wrong",
      detail: error.message || "An unexpected error occurred.",
    };
  }
  return {
    title: "Something went wrong",
    detail: "An unexpected error occurred.",
  };
}

/**
 * Router errorElement — cleaner than React Router’s default “Unexpected Application Error”.
 */
export function RouteErrorPage() {
  const error = useRouteError();
  const navigate = useNavigate();
  const { title, detail } = friendlyMessage(error);

  useEffect(() => {
    console.error("Route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 px-4 text-center text-white">
      <p className="text-sm font-medium uppercase tracking-widest text-red-500">Error</p>
      <h1 className="text-2xl font-semibold md:text-3xl">{title}</h1>
      <p className="max-w-md text-sm text-zinc-400 md:text-base">{detail}</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <Button type="button" variant="outline" onClick={() => navigate(-1)}>
          Go back
        </Button>
        <Button asChild>
          <Link to="/">Home</Link>
        </Button>
        <Button type="button" variant="ghost" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    </div>
  );
}
