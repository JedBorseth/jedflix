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

    const controller = new AbortController();
    void fetchDemoRdStatus(key, { signal: controller.signal })
      .catch((): DemoRdStatus => ({ demo: false }))
      .then((next) => {
        if (!controller.signal.aborted) {
          setStatus(next);
        }
      });

    return () => controller.abort();
  }, [realDebridApiKey]);

  return status;
}
