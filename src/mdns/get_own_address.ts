import { MulticastInterface } from "./multicast_interface.ts";

/** Get the machines own multicast address. */
export async function getOwnAddress(
  multicastInterface: MulticastInterface,
): Promise<string> {
  const ownAddress = Promise.withResolvers<string>();

  multicastInterface.setLoopback(true);

  // Listen to multicast messages
  (async () => {
    for await (const [_msg, addr] of multicastInterface.messages()) {
      if (multicastInterface.isOwnAddress(addr.hostname)) {
        ownAddress.resolve(addr.hostname);
      }
    }
  })();

  // Send a message
  await multicastInterface.send({
    header: {
      ID: 0,
      QR: 0,
      OPCODE: 0,
      AA: 0,
      TC: 0,
      RD: 0,
      RA: 0,
      Z: 0,
      AD: 0,
      CD: 0,
      RCODE: 0,
      QDCOUNT: 0,
      ANCOUNT: 0,
      NSCOUNT: 0,
      ARCOUNT: 0,
    },
    question: [],
    answer: [],
    authority: [],
    additional: [],
  });

  return ownAddress.promise;
}
