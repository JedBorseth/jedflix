import { useEffect, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { DemoRdBanner } from "@/components/demo/DemoRdBanner";
import { useDemoRdStatus } from "@/hooks/useDemoRdStatus";
import { useUserSettings } from "@/hooks/useUserSettings";
import { setDemoRdUserId } from "@/lib/demoRealDebrid";

export function DemoRdProvider({ children }: { children: ReactNode }) {
  const { realDebridApiKey } = useUserSettings();
  const viewer = useQuery(api.users.viewer);
  const { demo, remaining, playLimit } = useDemoRdStatus(realDebridApiKey);

  useEffect(() => {
    if (viewer?._id) {
      setDemoRdUserId(viewer._id);
    }
  }, [viewer?._id]);

  useEffect(() => {
    document.documentElement.classList.toggle("demo-rd", demo);
    return () => {
      document.documentElement.classList.remove("demo-rd");
    };
  }, [demo]);

  return (
    <>
      {demo ? (
        <DemoRdBanner remaining={remaining} playLimit={playLimit} />
      ) : null}
      {children}
    </>
  );
}
