import { advertise } from "../src/dns_sd/advertise.ts";
import { DriverDeno } from "../src/mdns/driver_deno.ts";
import { MulticastInterface } from "../src/mdns/multicast_interface.ts";

const multicastInterface = new MulticastInterface(new DriverDeno("IPv4"));

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
