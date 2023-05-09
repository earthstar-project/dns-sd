import { advertise } from "../src/dns_sd/advertise.ts";

import { MulticastInterface } from "../src/mdns/multicast_interface.ts";

const multicastInterface = new MulticastInterface();

console.log(
  `Advertising "My Web Server" on ${multicastInterface.hostname}:8080`,
);

await advertise({
  service: {
    name: "My Web Server",
    port: 8080,
    protocol: "tcp",
    type: "http",
    txt: {},
  },
  multicastInterface,
});
