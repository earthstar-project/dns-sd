import {
  isResourceRecordA,
  isResourceRecordAAAA,
  isResourceRecordPTR,
  isResourceRecordSRV,
  isResourceRecordTXT,
  ResourceRecordA,
  ResourceRecordAAAA,
  ResourceRecordPTR,
  ResourceRecordSRV,
  ResourceRecordTXT,
  ResourceType,
} from "../decode/types.ts";
import { FastFIFO } from "../fast_fifo.ts";
import { MulticastInterface } from "../mdns/multicast_interface.ts";
import { MdnsQuestion, Query } from "../mdns/query.ts";

type BrowseOpts = {
  service: {
    /** Something like 'http' */
    type: string;
    protocol: "tcp" | "udp";
    subtypes: [];
  };
  multicastInterface: MulticastInterface;
};

type Service = {
  name: string;
  type: string;
  subtypes: string[];
  protocol: "tcp" | "udp";
  host: string;
  port: number;
  txt: Record<string, true | Uint8Array | null>;
  isActive: boolean;
};

export function browse(opts: BrowseOpts) {
  const subName = `${
    opts.service.subtypes.length > 0
      ? `.${opts.service.subtypes.map((sub) => `_${sub}`).join(".")}._sub.`
      : ""
  }`;

  const serviceName =
    `${subName}_${opts.service.type}._${opts.service.protocol}.local`;

  const questions: MdnsQuestion[] = [
    {
      name: serviceName,
      recordType: ResourceType.PTR,
    },
  ];

  const ptrQuery = new Query(questions, opts.multicastInterface);

  const fifo = new FastFIFO<Service>(16);

  (async () => {
    for await (const event of ptrQuery) {
      switch (event.kind) {
        case "ADDED":
          if (isResourceRecordPTR(event.record)) {
            // iterate over a service thing and relay its events.

            const service = new ServiceThingImBadWithNames(
              event.record,
              opts.multicastInterface,
            );

            (async () => {
              for await (const event of service) {
                fifo.push(event);
              }
            })();
          }
      }
    }
  })();

  return fifo;
}

class ServiceThingImBadWithNames {
  private srvRecord: ResourceRecordSRV | null = null;
  private txtRecord: ResourceRecordTXT | null = null;
  private multicastInterface: MulticastInterface;
  private hostnameQuery: Query | null = null;
  private hostnameRecord: ResourceRecordA | ResourceRecordAAAA | null = null;
  private fifo = new FastFIFO<Service>(16);
  private serviceName: string;

  constructor(
    ptrRecord: ResourceRecordPTR,
    multicastInterface: MulticastInterface,
  ) {
    this.multicastInterface = multicastInterface;

    // Get SRV and text records.

    this.serviceName = ptrRecord.RDATA.join(".");

    const query = new Query(
      [
        {
          name: this.serviceName,
          recordType: ResourceType.SRV,
        },
        {
          name: this.serviceName,
          recordType: ResourceType.TXT,
        },
      ],
      multicastInterface,
    );

    (async () => {
      for await (const event of query) {
        switch (event.kind) {
          case "ADDED": {
            if (isResourceRecordTXT(event.record)) {
              this.setTxt(event.record);
            } else if (isResourceRecordSRV(event.record)) {
              await this.setSrv(event.record);
            }
            break;
          }
        }
        // TODO: flushed, expired.
      }
    })();
  }

  setTxt(record: ResourceRecordTXT) {
    this.txtRecord = record;

    // see if we can resolve a pending promise to be yielded.
  }

  async setSrv(record: ResourceRecordSRV) {
    // make a new query for A / AAAA record for this (use multicast interface family to determine which to ask for)
    const recordTypeToRequest = this.multicastInterface.family === "IPv4"
      ? ResourceType.A
      : ResourceType.AAAA;

    this.srvRecord = record;

    const existingQuery = this.hostnameQuery;

    if (existingQuery) {
      existingQuery.end();
    }

    const hostnameQuery = new Query([{
      name: record.RDATA.target.join("."),
      recordType: recordTypeToRequest,
    }], this.multicastInterface);

    this.hostnameQuery = hostnameQuery;

    for await (const event of hostnameQuery) {
      switch (event.kind) {
        case "ADDED": {
          if (
            isResourceRecordA(event.record) ||
            isResourceRecordAAAA(event.record)
          ) {
            this.hostnameRecord = event.record;

            this.update();
          }
          break;
        }
        case "EXPIRED":
        case "FLUSHED":
          if (
            isResourceRecordA(event.record) ||
            isResourceRecordAAAA(event.record)
          ) {
            this.hostnameRecord = event.record;
            this.update(true);
          }
          break;
      }
    }
  }

  update(wentInactive?: boolean) {
    if (!this.hostnameRecord) {
      return;
    }

    if (!this.srvRecord) {
      return;
    }

    if (!this.txtRecord) {
      return;
    }

    const hostName = isResourceRecordA(this.hostnameRecord)
      ? this.hostnameRecord.RDATA.join(".")
      : this.hostnameRecord.RDATA;

    const { instanceName, type, subTypes, protocol } = parseServiceName(
      this.serviceName,
    );

    this.fifo.push({
      name: instanceName,
      type: type,
      subtypes: subTypes,
      protocol: protocol,
      host: hostName,
      port: this.srvRecord.RDATA.port,
      txt: this.txtRecord.RDATA,
      isActive: !wentInactive,
    });
  }

  // Return an async iterator with events of being resolved, updated, going down.
  async *[Symbol.asyncIterator]() {
    for await (const res of this.fifo) {
      yield res;
    }
  }
}

function parseServiceName(name: string): {
  instanceName: string;
  subTypes: string[];
  type: string;
  protocol: "udp" | "tcp";
  domain: string;
} {
  const parts = name.split(".");

  const domain = parts[parts.length - 1];
  const protocol = parts[parts.length - 2].replace("_", "");
  const type = parts[parts.length - 3].replace("_", "");
  const instanceName = parts[0];

  const subTypes = [];

  if (parts.length > 4) {
    // Then there are sub types.
    const subTypesLength = parts.length - 4 - 1;

    for (let i = 1; i < subTypesLength; i++) {
      subTypes.push(parts[i].replace("_", ""));
    }
  }

  return {
    instanceName,
    subTypes,
    type,
    protocol: protocol as "udp" | "tcp",
    domain,
  };
}
