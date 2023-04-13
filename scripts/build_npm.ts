import { build, emptyDir } from "https://deno.land/x/dnt@0.33.0/mod.ts";

await emptyDir("npm");

build({
  entryPoints: ["mod.ts"],
  outDir: "npm",
  package: {
    name: "dns-sd",
    version: Deno.args[0],
  },
  shims: {
    deno: {
      test: "dev",
    },
    timers: true,
  },
  test: false,
  mappings: {
    "src/mdns/default_driver.ts": "src/mdns/default_driver.node.ts",
    "https://deno.land/std@0.170.0/node/dgram.ts": "node:dgram",
    "https://deno.land/std@0.170.0/node/buffer.ts": "node:buffer",
    "https://deno.land/std@0.170.0/node/os.ts": "node:os",
  },
});
