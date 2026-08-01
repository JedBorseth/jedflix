declare module "epubjs" {
  type RelocatedLocation = { start?: { cfi?: string } };

  type Rendition = {
    display: (target?: string) => Promise<void>;
    next: () => Promise<void>;
    prev: () => Promise<void>;
    on: (event: "relocated", callback: (location: RelocatedLocation) => void) => void;
    off: (event: "relocated", callback: (location: RelocatedLocation) => void) => void;
  };

  type Book = {
    renderTo: (
      element: HTMLElement,
      options: { width: string; height: string; flow?: string },
    ) => Rendition;
    destroy: () => void;
  };

  export default function ePub(
    url: string,
    options?: { openAs?: string },
  ): Book;
}
