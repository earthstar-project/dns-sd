enum Flag {
  Disabled = 0,
  Enabled,
}

enum DnsClass {
  /** The Internet */
  IN = 1,
  /** The CSNET class (obsolete) */
  CS,
  /** The CHAOS class*/
  CH,
  /** Hesiod [Dyer 87] */
  HS,
}

/* HEADER - see RFC 1035 section 4.1.1

																1  1  1  1  1  1
	0  1  2  3  4  5  6  7  8  9  0  1  2  3  4  5
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                      ID                       |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|QR|   Opcode  |AA|TC|RD|RA|   Z    |   RCODE   |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                    QDCOUNT                    |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                    ANCOUNT                    |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                    NSCOUNT                    |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                    ARCOUNT                    |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+

*/

enum OpcodeFlag {
  /** A standard query. */
  Query = 0,
  /** An inverse query. */
  IQuery,
  /** A server status request. */
  Status,
  /** Reserved for future use. */
  Reserved,
}

enum RcodeFlag {
  /** No error condition. */
  NoError = 0,
  /** The name server was unable to interpret the query. */
  FormatError,
  /** The name server was unable to process the query due to a problem with the name server. */
  ServerFailure,
  /** Meaningful only for responses from an authoritative name server, this code signifies that the domain name referenced in the query does not exist. */
  NameError,
  /** The name server does not support the requested kind of query. */
  NotImplemented,
  /** The name server refuses to perform the specified operation for policy reasons. */
  Refused,
  /** Reserved for future use. */
  Reserved,
}

type DnsMessageHeader = {
  /** A 16 bit identifier assigned by the program. Copied to corresponding replies.*/
  ID: number;
  /** Is this message a query or a response? */
  QR: Flag;
  /** The kind of query in this message. */
  OPCODE: OpcodeFlag;
  /** Whether the responding name server is an authority for the domain in question. */
  AA: Flag;
  /** Whether this message was truncated or not. */
  TC: Flag;
  /** Whether query recursion is desired. */
  RD: Flag;
  /** Whether recursion is available or not. */
  RA: Flag;
  /** Reserved for future use. */
  Z: Flag;
  /** Whether the data included has been verified by the server providing it. */
  AD: Flag;
  /** Whether non-verified data is acceptable to the resolver sending the query. */
  CD: Flag;
  /** Response code. */
  RCODE: RcodeFlag;
  /** The number of entries in the question section */
  QDCOUNT: number;
  /** The number of entries in the answer section */
  ANCOUNT: number;
  /** The number of name server resource records in the the authority records section. */
  NSCOUNT: number;
  /** The number of resource records in the additional records section. */
  ARCOUNT: number;
};

export function decodeHeader(message: Uint8Array): DnsMessageHeader {
  const dataView = new DataView(message.buffer);
  const id = dataView.getUint16(0, false);
  const flags = dataView.getUint16(2, false);
  const qdCount = dataView.getUint16(4, false);
  const anCount = dataView.getUint16(6, false);
  const nsCount = dataView.getUint16(8, false);
  const arCount = dataView.getUint16(10, false);

  return {
    ID: id,
    QR: (flags & 0x8000) >> 15,
    OPCODE: (flags & 0x7800) >> 11,
    AA: (flags & 0x400) >> 10,
    TC: (flags & 0x200) >> 9,
    RD: (flags & 0x100) >> 8,
    RA: (flags & 0x80) >> 7,
    Z: (flags & 0x40) >> 6,
    AD: (flags & 0x20) >> 5,
    CD: (flags & 0x10) >> 4,
    RCODE: (flags & 0xF),
    QDCOUNT: qdCount,
    ANCOUNT: anCount,
    NSCOUNT: nsCount,
    ARCOUNT: arCount,
  };
}

/* */

function decodeLabels(
  message: Uint8Array,
  startPosition: number,
): {
  labels: string[];
  nextPosition: number;
} {
  const labels: string[] = [];

  let position = startPosition;

  const view = new DataView(message.buffer);

  while (view.getUint8(position) !== 0) {
    const labelLength = view.getUint8(position);

    if (labelLength >= 0xc0 /** 192 */) {
      // Handle message compression.

      const compressionPointer = (labelLength << 8) +
        view.getUint8(position + 1) - 0xC000;

      const { labels: compressedLabels } = decodeLabels(
        message,
        compressionPointer,
      );

      labels.push(...compressedLabels);

      position += 2;

      return { labels, nextPosition: position };
    }

    if (position + labelLength > message.byteLength) {
      throw new Error(
        `Expected a string of ${labelLength} bytes length, but there are only ${
          message.byteLength - position
        } bytes left.`,
      );
    }

    const label: string[] = [];

    for (let i = position + 1; i <= position + labelLength; i++) {
      label.push(String.fromCharCode(message[i]));
    }

    labels.push(label.join(""));

    position += 1 + labelLength;

    continue;
  }

  return { labels, nextPosition: position + 1 };
}

/* QUESTION SECTION see RFC 1035 section 4.1.2

																 1  1  1  1  1  1
	0  1  2  3  4  5  6  7  8  9  0  1  2  3  4  5
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                                               |
/                     QNAME                     /
/                                               /
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                     QTYPE                     |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                     QCLASS                    |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+

*/

/** A DNS Resource Record type. Only record types relevant to multicast DNS are described here. */
enum ResourceType {
  /** a host address */
  A = 1,
  /** a domain name pointer */
  PTR = 12,
  /** text strings */
  TXT = 16,
  /** A IPv6 host address*/
  AAAA = 28,
  /** A service */
  SRV = 33,
  /** What is this. */
  NSEC = 47,
  /** A request for all records */
  ALL = 255,
}

type DnsQuestionSection = {
  /** A domain name represented as a sequence of labels */
  QNAME: string;
  /** The type of the query. */
  QTYPE: ResourceType;
  /** The class of the query */
  QCLASS: DnsClass;
};

export function decodeQuestion(
  message: Uint8Array,
  startPosition: number,
): { result: DnsQuestionSection; nextPosition: number } {
  const dataView = new DataView(message.buffer);

  const { labels, nextPosition } = decodeLabels(message, startPosition);

  const qType = dataView.getUint16(nextPosition);
  const qClass = dataView.getUint16(nextPosition + 2);

  return {
    result: {
      QNAME: labels.join("."),
      QTYPE: qType,
      QCLASS: qClass,
    },
    nextPosition: nextPosition + 4,
  };
}

/* Resource record format - see RFC 1035 section 4.1.3

                                1  1  1  1  1  1
  0  1  2  3  4  5  6  7  8  9  0  1  2  3  4  5
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                                               |
/                                               /
/                      NAME                     /
|                                               |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                      TYPE                     |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                     CLASS                     |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                      TTL                      |
|                                               |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                   RDLENGTH                    |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--|
/                     RDATA                     /
/                                               /
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
*/

interface ResourceRecordUnknown {
  NAME: string;
  TYPE: ResourceType;
  CLASS: DnsClass;
  TTL: number;
  RDLENGTH: number;
  RDATA: unknown;
}

interface ResourceRecordA extends ResourceRecordUnknown {
  TYPE: 1;
  RDATA: string;
}

interface ResourceRecordPTR extends ResourceRecordUnknown {
  TYPE: 12;
  RDATA: string;
}

interface ResourceRecordTXT extends ResourceRecordUnknown {
  type: 16;
  RDATA: string;
}

interface ResourceRecordAAAA extends ResourceRecordUnknown {
  type: 28;
  RDATA: string;
}

interface ResourceRecordSRV extends ResourceRecordUnknown {
  type: 33;
  RDATA: {
    priority: number;
    weight: number;
    port: number;
    target: string;
  };
}

interface ResourceRecordNSEC extends ResourceRecordUnknown {
  TYPE: 47;
  RDATA: {
    nextDomainName: string;
    types: number[];
  };
}

interface ResourceRecordAny extends ResourceRecordUnknown {
  RDATA: Uint8Array;
}

type ResourceRecord =
  | ResourceRecordA
  | ResourceRecordPTR
  | ResourceRecordTXT
  | ResourceRecordAAAA
  | ResourceRecordSRV
  | ResourceRecordNSEC
  | ResourceRecordAny;

export function decodeRdata(
  type: ResourceType,
  message: Uint8Array,
  rdataPosition: number,
  rdataLength: number,
): ResourceRecord["RDATA"] {
  switch (type) {
    case ResourceType.A: {
      return `${message[rdataPosition]}.${message[rdataPosition + 1]}.${
        message[rdataPosition] + 2
      }.${message[rdataPosition] + 3}`;
    }

    case ResourceType.PTR: {
      return decodeLabels(message, rdataPosition).labels.join(".");
    }

    case ResourceType.TXT: {
      return decodeLabels(message, rdataPosition).labels[0];
    }

    case ResourceType.AAAA: {
      const rawView = new DataView(message.buffer);

      const parts: string[] = [];

      for (let i = rdataPosition; i < rdataPosition + rdataLength; i += 2) {
        const part = rawView.getUint16(i, false);

        parts.push(part.toString(16));
      }

      return parts.join(":").replace(/(^|:)0(:0)*:0(:|$)/, "$1::$3").replace(
        /:{3,4}/,
        "::",
      );
    }

    case ResourceType.SRV: {
      const view = new DataView(message.buffer);

      return {
        priority: view.getUint16(rdataPosition, false),
        weight: view.getUint16(rdataPosition + 2, false),
        port: view.getUint16(rdataPosition + 4, false),
        target: decodeLabels(message, rdataPosition + 6).labels.join("."),
      };
    }

    case ResourceType.NSEC: {
      const view = new DataView(message.buffer);

      const { labels, nextPosition } = decodeLabels(message, rdataPosition);

      const windowBlock = view.getUint8(nextPosition); //
      const windowBlockLength = view.getUint8(nextPosition + 1);

      // Ignore rrtypes over 255 (only implementing the restricted form)
      // Bitfield length must always be < 32, otherwise skip parsing
      if (windowBlock !== 0 || windowBlockLength > 32) {
        return message.subarray(rdataPosition, rdataPosition + rdataLength);
      }

      const typesList = [];

      for (let i = 0; i < windowBlockLength; i++) {
        const mask = view.getUint8(nextPosition + 2 + i);

        if (mask === 0) {
          continue;
        }

        for (let bit = 0; bit < 8; bit++) {
          if (mask & 1 << bit) {
            const rrtype = 8 * i + (7 - bit);
            typesList.push(rrtype);
          }
        }
      }

      return {
        nextDomainName: labels.join("."),
        types: typesList,
      };
    }

    default:
      return message.subarray(rdataPosition, rdataPosition + rdataLength);
  }
}

export function decodeResourceRecord(
  message: Uint8Array,
  startPosition: number,
): {
  result: ResourceRecord;
  nextPosition: number;
} {
  const dataView = new DataView(message.buffer);

  const { labels, nextPosition } = decodeLabels(message, startPosition);

  const resourceType = dataView.getUint16(nextPosition);
  const resourceClass = dataView.getUint16(nextPosition + 2);
  const resourceTTL = dataView.getUint32(nextPosition + 4);
  const rdataLength = dataView.getUint16(nextPosition + 8);

  const decodedData = decodeRdata(
    resourceType,
    message,
    nextPosition + 10,
    rdataLength,
  );

  return {
    result: {
      NAME: labels.join("."),
      TYPE: resourceType,
      CLASS: resourceClass,
      TTL: resourceTTL,
      RDLENGTH: rdataLength,
      RDATA: decodedData,
    } as ResourceRecord,
    nextPosition: nextPosition + 10 + rdataLength,
  };
}

/*

+---------------------+
|        Header       |
+---------------------+
|       Question      | the question for the name server
+---------------------+
|        Answer       | RRs answering the question
+---------------------+
|      Authority      | RRs pointing toward an authority
+---------------------+
|      Additional     | RRs holding additional information
+---------------------+

*/

type DnsMessage = {
  header: DnsMessageHeader;
  question: DnsQuestionSection[];
  answer: ResourceRecord[];
  authority: ResourceRecord[];
  additional: ResourceRecord[];
};

export function decodeMessage(message: Uint8Array): DnsMessage {
  const header = decodeHeader(message);

  let position = 12;

  const question: DnsQuestionSection[] = [];
  const answer: ResourceRecord[] = [];
  const authority: ResourceRecord[] = [];
  const additional: ResourceRecord[] = [];

  if (header.QDCOUNT > 0) {
    let questionPosition = position;

    for (
      let currentQuestion = 0;
      currentQuestion < header.QDCOUNT;
      currentQuestion++
    ) {
      const { result, nextPosition } = decodeQuestion(
        message,
        questionPosition,
      );

      question.push(result);

      questionPosition = nextPosition;
    }

    position = questionPosition;
  }

  if (header.ANCOUNT > 0) {
    let answerPosition = position;

    for (
      let currentAnswer = 0;
      currentAnswer < header.ANCOUNT;
      currentAnswer++
    ) {
      const { result, nextPosition } = decodeResourceRecord(
        message,
        answerPosition,
      );

      answer.push(result);

      answerPosition = nextPosition;
    }

    position = answerPosition;
  }

  if (header.NSCOUNT > 0) {
    let authorityPosition = position;

    for (
      let currentAuthority = 0;
      currentAuthority < header.NSCOUNT;
      currentAuthority++
    ) {
      const { result, nextPosition } = decodeResourceRecord(
        message,
        authorityPosition,
      );

      authority.push(result);

      authorityPosition = nextPosition;
    }

    position = authorityPosition;
  }

  if (header.ARCOUNT > 0) {
    let additionalPosition = position;

    for (
      let currentAdditional = 0;
      currentAdditional < header.ARCOUNT;
      currentAdditional++
    ) {
      const { result, nextPosition } = decodeResourceRecord(
        message,
        additionalPosition,
      );

      additional.push(result);

      additionalPosition = nextPosition;
    }

    position = additionalPosition;
  }

  return {
    header,
    question,
    answer,
    authority,
    additional,
  };
}
