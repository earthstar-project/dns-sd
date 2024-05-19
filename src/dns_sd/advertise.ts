import {
  DnsClass,
  ResourceRecordA,
  ResourceRecordAAAA,
  ResourceRecordPTR,
  ResourceRecordSRV,
  ResourceRecordTXT,
  ResourceType,
} from "../decode/types.ts";
import { getOwnAddress } from "../mdns/get_own_address.ts";
import { MulticastInterface } from "../mdns/multicast_interface.ts";
import { respond } from "../mdns/responder.ts";

export type AdvertiseOpts = {
  service: {
    /** Unique name, e.g. "My Computer" */
    name: string;
    /** The type of the service, e.g. http. */
    type: string;
    /** A list of identifiers further identifying the kind of service provided, e.g. ["printer"]. */
    subtypes?: string[];
    protocol: "tcp" | "udp";
    /** The address to advertise on. Automatically determined if omitted. */
    host?: string;
    port: number;
    txt: Record<string, true | Uint8Array | null>;
  };
  multicastInterface: MulticastInterface;
  /** A signal used to stop advertising. */
  signal?: AbortSignal;
};

/** Advertise a service over multicast DNS.
 *
 * Returns a promise which will reject if fifteen failed attempts to claim a name are made within a ten second interval.
 *
 * If the service has to be renamed due to a conflict, a warning with the new name will be sent to the console.
 */
export async function advertise(opts: AdvertiseOpts): Promise<void> {
  let attemptsInLastTenSeconds = 0;
  const removalTimers: number[] = [];

  const hostToUse = opts.service.host ||
    await getOwnAddress(opts.multicastInterface);

  let renameAttempts = 1;

  if (opts.signal) {
    opts.signal.addEventListener("abort", () => {
      attemptsInLastTenSeconds = 16;

      for (const timer of removalTimers) {
        clearTimeout(timer);
      }
    });
  }

  while (attemptsInLastTenSeconds <= 15) {
    const name = renameAttempts > 1
      ? `${opts.service.name} (${renameAttempts})`
      : opts.service.name;

    if (renameAttempts > 1) {
      console.warn(`Renamed to "${name}"`);
    }

    const subtypeLabels =
      opts.service.subtypes && opts.service.subtypes.length > 0
        ? [...opts.service.subtypes.map((s) => `_${s}`), `_sub`]
        : [];

    const serviceTypeLabels = [
      ...subtypeLabels,
      `_${opts.service.type}`,
      `_${opts.service.protocol}`,
      "local",
    ];

    const fullNameLabels = [name, ...serviceTypeLabels];

    const ptrRecord: ResourceRecordPTR = {
      NAME: serviceTypeLabels,
      TYPE: ResourceType.PTR,
      CLASS: DnsClass.IN,
      TTL: 120,
      isUnique: false,
      RDATA: fullNameLabels,
      RDLENGTH: 1, // Faking this, it will be encoded properly.
    };

    const srvRecord: ResourceRecordSRV = {
      NAME: fullNameLabels,
      TYPE: ResourceType.SRV,
      CLASS: DnsClass.IN,
      TTL: 120,
      isUnique: true,
      RDATA: {
        weight: 0,
        priority: 0,
        port: opts.service.port,
        target: fullNameLabels,
      },
      RDLENGTH: 1,
    };

    const txtRecord: ResourceRecordTXT = {
      NAME: fullNameLabels,
      TYPE: ResourceType.TXT,
      CLASS: DnsClass.IN,
      TTL: 120,
      isUnique: true,
      RDATA: opts.service.txt,
      RDLENGTH: 1,
    };

    const hostNameRecord = {
      NAME: fullNameLabels,
      TYPE: opts.multicastInterface.family === "IPv4"
        ? ResourceType.A
        : ResourceType.AAAA,
      CLASS: DnsClass.IN,
      TTL: 120,
      isUnique: true,
      RDATA: opts.multicastInterface.family === "IPv4"
        ? hostToUse.split(".").map((strNum) => parseInt(strNum))
        : hostToUse,
      RDLENGTH: 1,
    } as (ResourceRecordA | ResourceRecordAAAA);

    await respond({
      proposedRecords: [
        {
          ...ptrRecord,
          additional: [
            srvRecord,
            txtRecord,
            hostNameRecord,
          ],
        },
        {
          ...srvRecord,
          additional: [
            hostNameRecord,
          ],
        },
        txtRecord,
        hostNameRecord,
      ],
      multicastInterface: opts.multicastInterface,
      signal: opts.signal,
    }).catch(async (failure: "name_taken" | "simultaneous_probe") => {
      if (failure === "simultaneous_probe") {
        await new Promise((res) => {
          setTimeout(res, 1000);
        });
        return;
      } else if (failure === "name_taken") {
        attemptsInLastTenSeconds += 1;
        const removalTimer = setTimeout(() => {
          attemptsInLastTenSeconds -= 1;
        }, 10000);
        removalTimers.push(removalTimer);
        renameAttempts += 1;
      } else if (failure === "aborted") {
        return Promise.reject("Advertisement was aborted.");
      }
    });
  }

  for (const timer of removalTimers) {
    clearTimeout(timer);
  }

  return Promise.reject(
    new Error(
      "Was not able to claim a name after 15 attempts, which indicates shenanigans.",
    ),
  );
}
