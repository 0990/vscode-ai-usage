// @ts-check
const esbuild = require("esbuild");

const isProduction = process.argv.includes("--production");
const isWatch = process.argv.includes("--watch");

async function main() {
  /** @type {import('esbuild').BuildOptions} */
  const buildOptions = {
    entryPoints: ["src/extension.ts"],
    bundle: true,
    outfile: "out/extension.js",
    external: ["vscode"],
    format: "cjs",
    platform: "node",
    target: "node18",
    sourcemap: !isProduction,
    minify: isProduction,
    treeShaking: true,
  };

  if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log("[esbuild] Watching for changes...");
  } else {
    await esbuild.build(buildOptions);
    console.log("[esbuild] Build complete.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
