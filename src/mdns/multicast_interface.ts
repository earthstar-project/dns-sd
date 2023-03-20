import { decodeMessage } from "../decode/message_decode.ts";
import { encodeMessage } from "../decode/message_encode.ts";
import { DnsMessage } from "../decode/types.ts";

/** A driver which supplies the underlying methods a `MulticastInterface` uses to send and receive multicast messages. */
export interface MulticastDriver {
  address: string;

  family: "IPv4" | "IPv6";

  send(message: Uint8Array): Promise<void>;

  setTTL(ttl: number): void;

  receive(): Promise<[Uint8Array, { address: string; port: number }]>;

  setLoopback(loopback: boolean): void;

  close(): void;
}

/** An interface used to send and receive multicast messages, as well as other actions such as toggling multicast loopback.
 * This class is able to work on different runtimes by using a `MulticastDriver` made for that runtime.
 */
export class MulticastInterface {
  private driver: MulticastDriver;

  constructor(driver: MulticastDriver) {
    this.driver = driver;
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

  async *[Symbol.asyncIterator]() {
    while (true) {
      const [received, origin] = await this.driver.receive();

      yield [decodeMessage(received), origin] as [
        DnsMessage,
        { address: string; port: number },
      ];
    }
  }

  get address() {
    return this.driver.address;
  }

  get family() {
    return this.driver.family;
  }
}
