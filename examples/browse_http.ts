import { browse } from "../src/dns_sd/browse.ts";

import { MulticastDriverDeno } from "../src/mdns/multicast_driver.deno.ts";
import { MulticastInterface } from "../src/mdns/multicast_interface.ts";

const denoDriver = new MulticastDriverDeno("IPv4");
const minterface = new MulticastInterface(denoDriver);

console.log("Browsing for local HTTP services...");

for await (
  const service of browse({
    multicastInterface: minterface,
    service: {
      protocol: "tcp",
      type: "http",
      subtypes: [],
    },
  })
) {
  if (service.isActive) {
    console.log(`📡 ${service.name} - ${service.host}:${service.port}`);
  }
}
