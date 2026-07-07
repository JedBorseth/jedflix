import { afterEach, describe, expect, test } from "bun:test";
import { POSTER_VIEW_TRANSITION_NAME } from "@/lib/posterTransition";
import { installViewTransitionGuard, resetViewTransitionGuardForTests } from "./viewTransitionGuard";

function createPopStateEvent(hasUAVisualTransition: boolean) {
  const event = new PopStateEvent("popstate");
  Object.defineProperty(event, "hasUAVisualTransition", {
    value: hasUAVisualTransition,
  });
  return event;
}

function createViewTransitionResult(): ViewTransition {
  return {
    ready: Promise.resolve(),
    updateCallbackDone: Promise.resolve(),
    finished: Promise.resolve(),
    skipTransition: () => {},
    types: new Set<string>(),
  };
}

describe("viewTransitionGuard", () => {
  afterEach(() => {
    resetViewTransitionGuardForTests();
    delete (document as unknown as Record<string, unknown>).startViewTransition;
    delete (navigator as unknown as Record<string, unknown>).standalone;
    document.body.replaceChildren();
  });

  test("lets normal view transitions use the browser implementation", () => {
    let originalCalls = 0;
    document.startViewTransition = ((callback: ViewTransitionUpdateCallback) => {
      originalCalls += 1;
      void callback();
      return createViewTransitionResult();
    }) as typeof document.startViewTransition;

    installViewTransitionGuard();

    let callbackRan = false;
    document.startViewTransition?.(() => {
      callbackRan = true;
    });

    expect(originalCalls).toBe(1);
    expect(callbackRan).toBe(true);
  });

  test("skips the next author transition after a UA visual transition", () => {
    let originalCalls = 0;
    document.startViewTransition = ((callback: ViewTransitionUpdateCallback) => {
      originalCalls += 1;
      void callback();
      return createViewTransitionResult();
    }) as typeof document.startViewTransition;
    const poster = document.createElement("img");
    poster.style.viewTransitionName = POSTER_VIEW_TRANSITION_NAME;
    document.body.append(poster);
    Object.defineProperty(navigator, "standalone", {
      configurable: true,
      value: true,
    });

    installViewTransitionGuard();
    window.dispatchEvent(createPopStateEvent(true));

    let callbackRan = false;
    document.startViewTransition?.(() => {
      callbackRan = true;
    });

    expect(originalCalls).toBe(0);
    expect(callbackRan).toBe(true);
    expect(poster.style.viewTransitionName).toBe("");

    document.startViewTransition?.(() => {});
    expect(originalCalls).toBe(1);
  });
});
