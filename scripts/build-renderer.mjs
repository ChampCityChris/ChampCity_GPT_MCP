import { build } from "esbuild";

await build({
  entryPoints: ["electron/renderer/main.tsx"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: "dist/electron/renderer/main.js",
  define: {
    "process.env.NODE_ENV": "\"production\""
  }
});
