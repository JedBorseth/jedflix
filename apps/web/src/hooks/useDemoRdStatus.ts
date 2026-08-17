import { useEffect, useState } from "react";
import { fetchDemoRdStatus, type DemoRdStatus } from "@/lib/streamApi";

export function useDemoRdStatus(realDebridApiKey: string): DemoRdStatus {
  const [status, setStatus] = useState<DemoRdStatus>({ demo: false });

  useEffect(() => {
    const key = realDebridApiKey.trim();
    if (!key) {
      setStatus({ demo: false });
      return;
    }

    let cancelled = false;
    void fetchDemoRdStatus(key).then((next) => {
      if (!cancelled) {
        setStatus(next);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [realDebridApiKey]);

  return status;
}
