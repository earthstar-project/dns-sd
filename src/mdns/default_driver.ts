import { MDNS_IPV4, MDNS_IPV6, MDNS_PORT } from "./constants.ts";
import { MulticastDriver } from "./multicast_interface.ts";

export class DefaultDriver implements MulticastDriver {
  private conn: Deno.DatagramConn;
  private membership:
    | ReturnType<Deno.DatagramConn["joinMulticastV4"]>
    | ReturnType<Deno.DatagramConn["joinMulticastV6"]>;

  family: "IPv4" | "IPv6";
  address: string;
  hostname = Deno.hostname();

  constructor(family: "IPv4" | "IPv6") {
    this.address = family === "IPv4" ? "0.0.0.0" : "::";

    this.conn = Deno.listenDatagram({
      hostname: this.address,
      port: 5353,
      reuseAddress: true,
      transport: "udp",
      loopback: true,
    });

    this.family = family;

    if (family === "IPv4") {
      this.membership = this.conn.joinMulticastV4(
        MDNS_IPV4,
        "0.0.0.0",
      );
    } else {
      this.membership = this.conn.joinMulticastV6(
        MDNS_IPV6,
        0,
      );
    }
  }

  send(message: Uint8Array): Promise<void> {
    this.conn.send(
      message,
      {
        hostname: this.family === "IPv4" ? MDNS_IPV4 : MDNS_IPV6,
        transport: "udp",
        port: MDNS_PORT,
      },
    );

    return Promise.resolve();
  }

  async setTTL(ttl: number): Promise<void> {
    if (this.family === "IPv4") {
      const membership = await this.membership;

      (membership as Awaited<
        ReturnType<Deno.DatagramConn["joinMulticastV4"]>
      >).setTTL(ttl);
    }
  }

  async setLoopback(loopback: boolean): Promise<void> {
    const membership = await this.membership;
    membership.setLoopback(loopback);
  }

  async receive(): Promise<[Uint8Array, { hostname: string; port: number }]> {
    const [msg, addr] = await this.conn.receive();

    return [msg, addr as Deno.NetAddr];
  }

  isOwnAddress(address: string): boolean {
    for (const networkInterface of Deno.networkInterfaces()) {
      if (address === networkInterface.address) {
        return true;
      }
    }

    return false;
  }

  close(): void {
    this.conn.close();
  }
}
