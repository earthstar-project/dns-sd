import { browse, MulticastInterface } from "../npm/esm/mod.js";

console.log("Browsing for local HTTP services...");

for await (
  const service of browse({
    multicastInterface: new MulticastInterface(),
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
