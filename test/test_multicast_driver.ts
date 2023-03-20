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
    onDriverSent: (
      msg: DnsMessage,
    ) => void,
  ) {
    this.driverSent = onDriverSent;
  }

  private isLooping = true;
  private messages = new FastFIFO<
    [Uint8Array, { address: string; port: number }]
  >(16);

  address = "0.0.0.0";
  family = "IPv4" as const;

  // Driver methods

  setTTL(_ttl: number): void {
    return;
  }
  setLoopback(loopback: boolean): void {
    this.isLooping = loopback;
  }

  send(message: Uint8Array): Promise<void> {
    if (this.isLooping) {
      this.messages.push([message, {
        address: "0.0.0.0",
        port: 5353,
      }]);
    }

    this.driverSent(decodeMessage(message));

    return Promise.resolve();
  }

  receive(): Promise<[Uint8Array, { address: string; port: number }]> {
    const h = deferred<[Uint8Array, { address: string; port: number }]>();

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

  // Special test methods

  sendInboundMessage(msg: DnsMessage, host: { address: string; port: number }) {
    const encoded = encodeMessage(msg);
    this.messages.push([encoded, host]);
  }
}
