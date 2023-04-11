import { advertise } from "../src/dns_sd/advertise.ts";
import { MulticastDriverDeno } from "../src/mdns/multicast_driver.deno.ts";
import { MulticastInterface } from "../src/mdns/multicast_interface.ts";

const denoDriver = new MulticastDriverDeno("IPv4");
const minterface = new MulticastInterface(denoDriver);

const host = Deno.networkInterfaces().find((netInterface) => {
  return netInterface.family === "IPv4" &&
    netInterface.netmask === "255.255.255.0";
})?.address || "127.0.0.1";

console.log(`Advertising "My Web Server" on ${host}:8080`);

await advertise({
  service: {
    host: host,
    name: "My Web Server",
    port: 8080,
    protocol: "tcp",
    type: "http",
    txt: {},
  },
  multicastInterface: minterface,
});
