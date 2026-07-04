import type { Plugin } from "vite";

const VTT_GLOBAL = 'typeof globalThis !== "undefined" ? globalThis : {}';

/**
 * vtt.js attaches VTTCue/VTTRegion/WebVTT via IIFEs that end with }(this).
 * Vite/Rollup bundles those modules as ESM where top-level `this` is undefined,
 * and CJS interop assigns module.exports (empty) over the globals — causing
 * "Cannot set properties of undefined (setting 'create')".
 */
export function vttJsPlugin(): Plugin {
  return {
    name: "vtt-js-vite-fix",
    transform(code, id) {
      if (!id.includes("node_modules/vtt.js/lib/")) {
        return null;
      }

      let patched = code.replace(/\}\(this\)\);?\s*$/gm, `}(${VTT_GLOBAL}));`);

      if (id.endsWith("vttregion-extended.js")) {
        patched = patched.replace(
          /if \(typeof module !== "undefined" && module\.exports\) \{\s*\n\s*this\.VTTRegion = require\("\.\/vttregion"\)\.VTTRegion;\s*\n\s*\}/,
          "require('./vttregion');",
        );
      }

      if (id.endsWith("vttcue-extended.js")) {
        patched = patched.replace(
          /if \(typeof module !== "undefined" && module\.exports\) \{\s*\n\s*this\.VTTCue = this\.VTTCue \|\| require\("\.\/vttcue"\)\.VTTCue;\s*\n\s*\}/,
          "require('./vttcue');",
        );
      }

      if (id.endsWith("vtt.js/lib/index.js")) {
        patched = `var __vttGlobal = ${VTT_GLOBAL};
require("./vttcue-extended.js");
require("./vttregion-extended.js");
module.exports = {
  WebVTT: require("./vtt.js").WebVTT || __vttGlobal.WebVTT,
  VTTCue: __vttGlobal.VTTCue,
  VTTRegion: __vttGlobal.VTTRegion,
};
`;
      }

      return { code: patched, map: null };
    },
  };
}
