import { decodeMessage } from "../decode/message_decode.ts";
import { encodeMessage } from "../decode/message_encode.ts";
import { DnsMessage } from "../decode/types.ts";
import { FastFIFO } from "../fast_fifo.ts";
import { DefaultDriver } from "./default_driver.ts";

/** A driver which supplies the underlying methods a `MulticastInterface` uses to send and receive multicast messages. */
export interface MulticastDriver {
  address: string;

  family: "IPv4" | "IPv6";

  send(message: Uint8Array): Promise<void>;

  setTTL(ttl: number): Promise<void>;

  receive(): Promise<[Uint8Array, { hostname: string; port: number }]>;

  setLoopback(loopback: boolean): Promise<void>;

  /** Check if a given address belongs to this interface. */
  isOwnAddress(address: string): boolean;

  close(): void;
}

/** An interface used to send and receive multicast messages, as well as other actions such as toggling multicast loopback.
 *
 * If no driver is specified, selects a `MulticastDriver` appropriate to the current runtime.
 */
export class MulticastInterface {
  private driver: MulticastDriver;
  private subscribers: FastFIFO<
    [DnsMessage, { hostname: string; port: number }]
  >[] = [];

  constructor(driver?: MulticastDriver) {
    const driverToUse = driver || new DefaultDriver("IPv4");

    this.driver = driverToUse;
    const subscribers = this.subscribers;

    const readable = new ReadableStream<
      [DnsMessage, { hostname: string; port: number }]
    >({
      async start(controller) {
        while (true) {
          const [received, origin] = await driverToUse.receive();

          try {
            controller.enqueue([decodeMessage(received), origin]);
          } catch (err) {
            console.warn(
              `Could not decode a DNS message from ${origin.hostname}:${origin.port}`,
            );
            console.log(err);
          }
        }
      },
    });

    readable.pipeTo(
      new WritableStream({
        write(event) {
          for (const subscriber of subscribers) {
            subscriber.push(event);
          }
        },
      }),
    );
  }

  send(message: DnsMessage): Promise<void> {
    const encoded = encodeMessage(message);

    return this.driver.send(encoded);
  }

  setTTL(ttl: number): void {
    if (this.driver.family === "IPv4") {
      this.driver.setTTL(ttl);
    }
  }

  setLoopback(loopback: boolean): void {
    this.driver.setLoopback(loopback);
  }

  messages() {
    const subscriber = new FastFIFO<
      [DnsMessage, { hostname: string; port: number }]
    >(16);

    this.subscribers.push(subscriber);

    return subscriber;
  }

  isOwnAddress(address: string): boolean {
    return this.driver.isOwnAddress(address);
  }

  get address() {
    return this.driver.address;
  }

  get family() {
    return this.driver.family;
  }
}
