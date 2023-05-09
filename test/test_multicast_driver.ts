import { FastFIFO } from "../src/fast_fifo.ts";
import { MulticastDriver } from "../src/mdns/multicast_interface.ts";
import { deferred } from "https://deno.land/std@0.177.0/async/deferred.ts";
import { DnsMessage } from "../src/decode/types.ts";
import { encodeMessage } from "../src/decode/message_encode.ts";
import { decodeMessage } from "../src/decode/message_decode.ts";

/** A special driver for testing where we can manually add received messages and inspect what was sent to this driver. */
export class TestMulticastDriver implements MulticastDriver {
  private driverSent: (
    msg: DnsMessage,
  ) => void;

  constructor(
    address: string,
    onDriverSent: (
      msg: DnsMessage,
    ) => void,
  ) {
    this.hostname = address;
    this.driverSent = onDriverSent;
  }

  private isLooping = true;
  private messages = new FastFIFO<
    [Uint8Array, { hostname: string; port: number }]
  >(16);

  hostname: string;
  family = "IPv4" as const;

  // Driver methods

  setTTL(_ttl: number): Promise<void> {
    return Promise.resolve();
  }
  setLoopback(loopback: boolean): Promise<void> {
    this.isLooping = loopback;

    return Promise.resolve();
  }

  send(message: Uint8Array): Promise<void> {
    if (this.isLooping) {
      this.messages.push([message, {
        hostname: this.hostname,
        port: 5353,
      }]);
    }

    this.driverSent(decodeMessage(message));

    return Promise.resolve();
  }

  receive(): Promise<[Uint8Array, { hostname: string; port: number }]> {
    const h = deferred<[Uint8Array, { hostname: string; port: number }]>();

    (async () => {
      for await (const msg of this.messages) {
        h.resolve(msg);
        break;
      }
    })();

    return h;
  }

  close() {
    this.messages.close();
  }

  isOwnAddress(address: string): boolean {
    return address === this.hostname;
  }

  // Special test methods

  sendInboundMessage(
    msg: DnsMessage,
    hostname: string,
  ) {
    const encoded = encodeMessage(msg);
    this.messages.push([encoded, {
      hostname: hostname,
      port: 5353,
    }]);
  }
}
