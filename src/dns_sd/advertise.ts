/*
just a long running promise, like responder...
can rename something when probing fails.
keeps tracks of all the failures too.

add additional records to proposed records...

just advertise what is configured?

put in host name and port manually, no deno interface stuff.
*/

import { delay } from "https://deno.land/std@0.177.0/async/delay.ts";
import {
  DnsClass,
  ResourceRecordA,
  ResourceRecordAAAA,
  ResourceRecordPTR,
  ResourceRecordSRV,
  ResourceRecordTXT,
  ResourceType,
} from "../decode/types.ts";
import { MulticastInterface } from "../mdns/multicast_interface.ts";
import { respond } from "../mdns/responder.ts";

type AdvertiseOpts = {
  service: {
    name: string;
    type: string;
    subtypes?: string[];
    protocol: "tcp" | "udp";
    host: string;
    port: number;
    txt: Record<string, true | Uint8Array | null>;
  };
  multicastInterface: MulticastInterface;
  signal?: AbortSignal;
};

export async function advertise(opts: AdvertiseOpts) {
  let attemptsInLastTenSeconds = 0;
  const removalTimers: number[] = [];

  let renameAttempts = 0;

  while (attemptsInLastTenSeconds < 15) {
    const name = renameAttempts
      ? `${opts.service.name} (${renameAttempts})`
      : opts.service.name;

    if (renameAttempts > 0) {
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
        ? opts.service.host.split(".").map((strNum) => parseInt(strNum))
        : opts.service.host,
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
      minterface: opts.multicastInterface,
      signal: opts.signal,
    }).catch(async (failure: "name_taken" | "simultaneous_probe") => {
      if (failure === "simultaneous_probe") {
        await delay(1000);
        return;
      } else {
        attemptsInLastTenSeconds += 1;
        const removalTimer = setTimeout(() => {
          attemptsInLastTenSeconds -= 1;
        }, 10000);
        removalTimers.push(removalTimer);
        renameAttempts += 1;
      }
    });
  }

  for (const timer of removalTimers) {
    clearTimeout(timer);
  }

  return Promise.reject(
    new Error(
      "Was not able to claim a name after 15 attempts. There is probably something going wrong.",
    ),
  );
}
