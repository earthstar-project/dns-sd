import { build, emptyDir } from "https://deno.land/x/dnt@0.33.0/mod.ts";

await emptyDir("npm");

build({
  entryPoints: ["mod.ts"],
  outDir: "npm",
  package: {
    name: "ya-dns-sd",
    version: Deno.args[0],
    description:
      "DNS-SD (aka Zeroconf, Bonjour, Avahi) discovery and advertisement in TypeScript. Again.",
    license: "LGPL-3.0-only",
    homepage: "https://earthstar-project.org",
    funding: {
      type: "opencollective",
      url: "https://opencollective.com/earthstar",
    },
    keywords: [
      "dns-sd",
      "zeroconf",
      "bonjour",
      "avahi",
      "multicast",
      "mdns",
      "service",
      "discovery",
      "spec-compliant",
    ],
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
