import { useEffect, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { DemoRdBanner } from "@/components/demo/DemoRdBanner";
import { useUserSettings } from "@/hooks/useUserSettings";
import { isDemoRealDebridKey, setDemoRdUserId } from "@/lib/demoRealDebrid";

export function DemoRdProvider({ children }: { children: ReactNode }) {
  const { realDebridApiKey } = useUserSettings();
  const viewer = useQuery(api.users.viewer);
  const isDemo = isDemoRealDebridKey(realDebridApiKey);

  useEffect(() => {
    if (viewer?._id) {
      setDemoRdUserId(viewer._id);
    }
  }, [viewer?._id]);

  useEffect(() => {
    document.documentElement.classList.toggle("demo-rd", isDemo);
    return () => {
      document.documentElement.classList.remove("demo-rd");
    };
  }, [isDemo]);

  return (
    <>
      {isDemo ? <DemoRdBanner /> : null}
      {children}
    </>
  );
}
