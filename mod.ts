/**
 * Browsing and advertising of DNS-SD services over multicast DNS, with utilities for:
 *
 * - DNS-SD service browsing and advertising, compliant with [RFC 6763](https://www.rfc-editor.org/rfc/rfc6763)
 * - Multicast DNS continuous querying and respond, compliant with [RFC 6762](https://www.rfc-editor.org/rfc/rfc6762)
 * - Encoding and decoding of DNS messages as per [RFC 1035](https://www.rfc-editor.org/rfc/rfc1035)
 *
 * Supports different JS runtimes (e.g. Deno, Node) via multicast interface drivers.
 *
 * ```ts
 * for await (
 *  const service of browse({
 *    multicastInterface: new MulticastInterface(new DriverDeno("IPv4")),
 *    service: {
 *      protocol: "tcp",
 *      type: "http",
 *      subtypes: [],
 *    },
 *  })
 * ) {
 *  if (service.isActive) {
 *    console.log(`📡 ${service.name} - ${service.host}:${service.port}`);
 *  }
 * }
 *
 * @author Sam Gwilym sam@gwil.garden
 * @module
 */

// Encoding and decoding

export { decodeMessage } from "./src/decode/message_decode.ts";
export { encodeMessage } from "./src/decode/message_encode.ts";
export { DnsClass, ResourceType } from "./src/decode/types.ts";

// Multicast DNS

export {
  type MulticastDriver,
  MulticastInterface,
} from "./src/mdns/multicast_interface.ts";

export {
  type MdnsQuestion,
  Query,
  type QueryCacheEvent,
} from "./src/mdns/query.ts";

export {
  respond,
  type RespondingRecord,
  type RespondOpts,
} from "./src/mdns/responder.ts";

// DNS-SD

export { advertise, type AdvertiseOpts } from "./src/dns_sd/advertise.ts";
export { browse, type BrowseOpts, type Service } from "./src/dns_sd/browse.ts";
