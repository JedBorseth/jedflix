import { clearPosterTransitionNames } from "@/lib/posterTransition";
import { isStandalonePwa } from "@/lib/mobile";

type ViewTransitionCallback = () => void | Promise<void>;
type StartViewTransition = (callback: ViewTransitionCallback) => ViewTransition;

type UAVisualTransitionEvent = Event & {
  hasUAVisualTransition?: boolean;
};

type NavigationLike = EventTarget & {
  addEventListener(
    type: "navigate",
    listener: (event: UAVisualTransitionEvent) => void,
    options?: AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: "navigate",
    listener: (event: UAVisualTransitionEvent) => void,
    options?: EventListenerOptions,
  ): void;
};

let installed = false;
let skipNextViewTransition = false;
let originalStartViewTransition: StartViewTransition | undefined;

function getNavigation() {
  return (globalThis as typeof globalThis & { navigation?: NavigationLike }).navigation;
}

function shouldSkipForUAVisualTransition(event: UAVisualTransitionEvent) {
  return isStandalonePwa() && event.hasUAVisualTransition === true;
}

function skipAuthorTransition() {
  skipNextViewTransition = true;
  clearPosterTransitionNames();
}

function runWithoutViewTransition(callback: ViewTransitionCallback): ViewTransition {
  let callbackResult: void | Promise<void>;
  try {
    callbackResult = callback();
  } catch (error) {
    const rejected = Promise.reject(error);
    return {
      ready: Promise.resolve(),
      updateCallbackDone: rejected,
      finished: rejected,
      skipTransition: () => {},
      types: new Set<string>(),
    };
  }

  const updateCallbackDone = Promise.resolve(callbackResult).then(() => undefined);
  return {
    ready: Promise.resolve(),
    updateCallbackDone,
    finished: updateCallbackDone,
    skipTransition: () => {},
    types: new Set<string>(),
  };
}

function handleUAVisualTransition(event: UAVisualTransitionEvent) {
  if (shouldSkipForUAVisualTransition(event)) {
    skipAuthorTransition();
  }
}

export function installViewTransitionGuard() {
  if (installed || typeof window === "undefined") {
    return;
  }

  installed = true;
  const nativeStartViewTransition = document.startViewTransition?.bind(document) as
    | StartViewTransition
    | undefined;
  originalStartViewTransition = nativeStartViewTransition;

  window.addEventListener("popstate", handleUAVisualTransition, { capture: true });
  getNavigation()?.addEventListener("navigate", handleUAVisualTransition, { capture: true });

  if (!nativeStartViewTransition) {
    return;
  }

  document.startViewTransition = ((callback: ViewTransitionCallback) => {
    if (!skipNextViewTransition) {
      return nativeStartViewTransition(callback);
    }

    skipNextViewTransition = false;
    return runWithoutViewTransition(callback);
  }) as typeof document.startViewTransition;
}

export function resetViewTransitionGuardForTests() {
  if (!installed) {
    return;
  }

  window.removeEventListener("popstate", handleUAVisualTransition, { capture: true });
  getNavigation()?.removeEventListener("navigate", handleUAVisualTransition, { capture: true });
  if (originalStartViewTransition) {
    document.startViewTransition =
      originalStartViewTransition as typeof document.startViewTransition;
  } else {
    delete (document as unknown as Record<string, unknown>).startViewTransition;
  }
  originalStartViewTransition = undefined;
  skipNextViewTransition = false;
  installed = false;
}
