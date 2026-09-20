import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

// `next lint` was removed in Next 16; this is the recipe from
// node_modules/next/dist/docs/01-app/03-api-reference/05-config/03-eslint.md. typescript-eslint
// needs the TS 6 API, so `typescript` is aliased to @typescript/typescript6 and TS 7 lives under
// @typescript/native (the TS 7.0 release notes' side-by-side setup); `tsc` still resolves to 7.
export default defineConfig([
  ...nextVitals,
  {
    rules: {
      // The pages mirror state into refs during render (`xRef.current = x`) so long-lived callbacks
      // and scripted demos read the latest value without re-subscribing; the React Compiler rules
      // forbid that idiom and effects that seed state. Kept as warnings until the hooks are reworked.
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "recordings/**", "screenshots/**", "scripts/cache/**"]),
]);
