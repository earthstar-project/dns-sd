// Probing stuff

import { delay } from "https://deno.land/std@0.177.0/async/delay.ts";
import {
  DnsClass,
  DnsMessage,
  ResourceRecord,
  ResourceType,
} from "../src/decode/types.ts";
import { MulticastInterface } from "../src/mdns/multicast_interface.ts";
import { respond } from "../src/mdns/responder.ts";
import { TestMulticastDriver } from "./test_multicast_driver.ts";
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

Deno.test("Probes for the record it wishes to be unique for", async () => {
  const sentMessages: DnsMessage[] = [];

  const testDriver = new TestMulticastDriver((msg) => {
    sentMessages.push(msg);
  });

  const minterface = new MulticastInterface(testDriver);

  const proposedRecord: ResourceRecord = {
    NAME: ["my", "proposed", "record"],
    CLASS: DnsClass.IN,
    TYPE: ResourceType.A,
    RDATA: [5, 5, 5, 5],
    isUnique: true,
    TTL: 70,
    RDLENGTH: 4,
  };

  const abortController = new AbortController();

  respond({
    minterface,
    proposedRecords: [proposedRecord],
    signal: abortController.signal,
  });

  await delay(250);

  assert(sentMessages[0]);

  assertEquals(sentMessages[0].question[0], {
    QNAME: proposedRecord.NAME,
    QTYPE: ResourceType.ANY,
    QCLASS: DnsClass.IN,
  });
  assertEquals(sentMessages[0].authority[0], proposedRecord);

  abortController.abort();
});

Deno.test("Waits 0 - 250ms to send the first probe", async () => {
  const sentMessages: DnsMessage[] = [];

  const testDriver = new TestMulticastDriver((msg) => {
    sentMessages.push(msg);
  });

  const minterface = new MulticastInterface(testDriver);

  const proposedRecord: ResourceRecord = {
    NAME: ["my", "proposed", "record"],
    CLASS: DnsClass.IN,
    TYPE: ResourceType.A,
    RDATA: [5, 5, 5, 5],
    isUnique: true,
    TTL: 70,
    RDLENGTH: 4,
  };

  const abortController = new AbortController();

  respond({
    minterface,
    proposedRecords: [proposedRecord],
    signal: abortController.signal,
  });

  await delay(1);

  assert(sentMessages.length === 0);

  await delay(250);

  abortController.abort();
});

Deno.test("Sends a probe packet every 250ms, three times only", async () => {
  const sentMessages: DnsMessage[] = [];

  const testDriver = new TestMulticastDriver((msg) => {
    sentMessages.push(msg);
  });

  const minterface = new MulticastInterface(testDriver);

  const proposedRecord: ResourceRecord = {
    NAME: ["my", "proposed", "record"],
    CLASS: DnsClass.IN,
    TYPE: ResourceType.A,
    RDATA: [5, 5, 5, 5],
    isUnique: true,
    TTL: 70,
    RDLENGTH: 4,
  };

  const abortController = new AbortController();

  respond({
    minterface,
    proposedRecords: [proposedRecord],
    signal: abortController.signal,
  }).catch(() => {
    // Just catch it.
  });

  await delay(250);

  assert(sentMessages[0]);

  await delay(250);

  assert(sentMessages[1]);

  await delay(250);

  assert(sentMessages[2]);

  assertEquals(sentMessages[0].question[0], {
    QNAME: proposedRecord.NAME,
    QTYPE: ResourceType.ANY,
    QCLASS: DnsClass.IN,
  });
  assertEquals(sentMessages[0].authority[0], proposedRecord);

  assertEquals(sentMessages[1].question[0], {
    QNAME: proposedRecord.NAME,
    QTYPE: ResourceType.ANY,
    QCLASS: DnsClass.IN,
  });
  assertEquals(sentMessages[1].authority[0], proposedRecord);

  assertEquals(sentMessages[2].question[0], {
    QNAME: proposedRecord.NAME,
    QTYPE: ResourceType.ANY,
    QCLASS: DnsClass.IN,
  });
  assertEquals(sentMessages[2].authority[0], proposedRecord);

  abortController.abort();
});

Deno.test("Switches to announcing after three unanswered probes sent", async () => {
  const sentMessages: DnsMessage[] = [];

  const testDriver = new TestMulticastDriver((msg) => {
    sentMessages.push(msg);
  });

  const minterface = new MulticastInterface(testDriver);

  const proposedRecord: ResourceRecord = {
    NAME: ["my", "proposed", "record"],
    CLASS: DnsClass.IN,
    TYPE: ResourceType.A,
    RDATA: [5, 5, 5, 5],
    isUnique: true,
    TTL: 70,
    RDLENGTH: 4,
  };

  const abortController = new AbortController();

  respond({
    minterface,
    proposedRecords: [proposedRecord],
    signal: abortController.signal,
  }).catch(() => {});

  await delay(1000);

  assertEquals(sentMessages.length, 4);

  assertEquals(sentMessages[3].answer[0], proposedRecord);

  assert(sentMessages[3].authority.length === 0);

  abortController.abort();
});

Deno.test({
  name: "If another host answers the query during probing, reject",
  fn: async () => {
    const sentMessages: DnsMessage[] = [];

    const testDriver = new TestMulticastDriver((msg) => {
      sentMessages.push(msg);
    });

    const minterface = new MulticastInterface(testDriver);

    const proposedRecord: ResourceRecord = {
      NAME: ["my", "proposed", "record"],
      CLASS: DnsClass.IN,
      TYPE: ResourceType.A,
      RDATA: [5, 5, 5, 5],
      isUnique: true,
      TTL: 70,
      RDLENGTH: 4,
    };

    const abortController = new AbortController();

    let didReject = false;

    respond({
      minterface,
      proposedRecords: [proposedRecord],
      signal: abortController.signal,
    }).catch(() => {
      didReject = true;
    });

    await delay(250);

    const conflictingRecord: ResourceRecord = {
      NAME: ["my", "proposed", "record"],
      CLASS: DnsClass.IN,
      TYPE: ResourceType.A,
      RDATA: [8, 8, 8, 8],
      isUnique: true,
      TTL: 70,
      RDLENGTH: 4,
    };

    testDriver.sendInboundMessage({
      header: {
        ID: 0,
        QR: 1,
        OPCODE: 0,
        AA: 1,
        TC: 0,
        RD: 0,
        RA: 0,
        Z: 0,
        AD: 0,
        CD: 0,
        RCODE: 0,
        QDCOUNT: 0,
        ANCOUNT: 1,
        NSCOUNT: 0,
        ARCOUNT: 0,
      },
      question: [],
      answer: [conflictingRecord],
      authority: [],
      additional: [],
    }, {
      address: "8.8.8.8",
      port: 5353,
    });

    await delay(1);

    assert(didReject);

    abortController.abort();
  },
});

Deno.test({
  name:
    "If another host is probing for the same record simulataneously, the losing side rejects, and the winning side goes on to announcing.",

  fn: async () => {
    // Set up two announcements
    const testDriverWinner = new TestMulticastDriver((msg) => {
      testDriverLoser.sendInboundMessage(msg, {
        address: "7.7.7.7",
        port: 5343,
      });
    });

    const testDriverLoser = new TestMulticastDriver((msg) => {
      testDriverWinner.sendInboundMessage(msg, {
        address: "0.0.0.0",
        port: 5343,
      });
    });

    const minterfaceWinner = new MulticastInterface(testDriverWinner);
    const minterfaceLoser = new MulticastInterface(testDriverLoser);

    // A single A record

    const abortController = new AbortController();

    const losingRecord: ResourceRecord = {
      NAME: ["my", "proposed", "record"],
      CLASS: DnsClass.IN,
      TYPE: ResourceType.A,
      RDATA: [4, 4, 4, 4],
      isUnique: true,
      TTL: 70,
      RDLENGTH: 4,
    };

    const winningRecord: ResourceRecord = {
      NAME: ["my", "proposed", "record"],
      CLASS: DnsClass.IN,
      TYPE: ResourceType.A,
      RDATA: [5, 5, 5, 5],
      isUnique: true,
      TTL: 70,
      RDLENGTH: 4,
    };

    let winnerDidNotReject = true;

    respond({
      minterface: minterfaceWinner,
      proposedRecords: [winningRecord],
      signal: abortController.signal,
    }).catch(() => {
      winnerDidNotReject = false;
    });

    await assertRejects(() => {
      return respond({
        minterface: minterfaceLoser,
        proposedRecords: [losingRecord],
        signal: abortController.signal,
      });
    });

    assert(winnerDidNotReject);

    abortController.abort();

    // Many records

    const losingRecords: ResourceRecord[] = [
      {
        NAME: ["my", "proposed", "record"],
        CLASS: DnsClass.IN,
        TYPE: ResourceType.A,
        RDATA: [4, 4, 4, 4],
        isUnique: true,
        TTL: 70,
        RDLENGTH: 4,
      },
      {
        NAME: ["my", "proposed", "record"],
        CLASS: DnsClass.IN,
        TYPE: ResourceType.PTR,
        RDATA: ["0", "0", "0"],
        isUnique: false,
        TTL: 70,
        RDLENGTH: 4,
      },
    ];

    const winningRecords: ResourceRecord[] = [
      {
        NAME: ["my", "proposed", "record"],
        CLASS: DnsClass.IN,
        TYPE: ResourceType.A,
        RDATA: [4, 4, 4, 4],
        isUnique: true,
        TTL: 70,
        RDLENGTH: 4,
      },
      {
        NAME: ["my", "proposed", "record"],
        CLASS: DnsClass.IN,
        TYPE: ResourceType.PTR,
        RDATA: ["1", "1", "1"],
        isUnique: false,
        TTL: 70,
        RDLENGTH: 4,
      },
    ];

    const abortControllerMany = new AbortController();

    let manyWinnerDidNotReject = true;

    respond({
      minterface: minterfaceWinner,
      proposedRecords: winningRecords,
      signal: abortControllerMany.signal,
    }).catch(() => {
      manyWinnerDidNotReject = false;
    });

    await assertRejects(() => {
      return respond({
        minterface: minterfaceLoser,
        proposedRecords: losingRecords,
        signal: abortControllerMany.signal,
      });
    });

    assert(manyWinnerDidNotReject);

    abortControllerMany.abort();

    // One side with more records than the other

    const losingRecordsLess: ResourceRecord[] = [
      {
        NAME: ["my", "proposed", "record"],
        CLASS: DnsClass.IN,
        TYPE: ResourceType.A,
        RDATA: [4, 4, 4, 4],
        isUnique: true,
        TTL: 70,
        RDLENGTH: 4,
      },
    ];

    const winningRecordsMore: ResourceRecord[] = [
      {
        NAME: ["my", "proposed", "record"],
        CLASS: DnsClass.IN,
        TYPE: ResourceType.A,
        RDATA: [4, 4, 4, 4],
        isUnique: true,
        TTL: 70,
        RDLENGTH: 4,
      },
      {
        NAME: ["my", "proposed", "record"],
        CLASS: DnsClass.IN,
        TYPE: ResourceType.PTR,
        RDATA: ["1", "1", "1"],
        isUnique: false,
        TTL: 70,
        RDLENGTH: 4,
      },
    ];

    const abortControllerOneLonger = new AbortController();

    let moreWinnerDidNotReject = true;

    respond({
      minterface: minterfaceWinner,
      proposedRecords: winningRecordsMore,
      signal: abortControllerOneLonger.signal,
    }).catch(() => {
      moreWinnerDidNotReject = false;
    });

    await assertRejects(() => {
      return respond({
        minterface: minterfaceLoser,
        proposedRecords: losingRecordsLess,
        signal: abortControllerOneLonger.signal,
      });
    });

    assert(moreWinnerDidNotReject);

    abortControllerOneLonger.abort();
  },
});

Deno.test({
  name:
    "If another host is probing for the same record simulataneously, and no conflict is found, neither rejects as this is fine.",
  fn: async () => {
    // Set up two announcements
    const testDriverA = new TestMulticastDriver((msg) => {
      testDriverB.sendInboundMessage(msg, {
        address: "7.7.7.7",
        port: 5343,
      });
    });

    const testDriverB = new TestMulticastDriver((msg) => {
      testDriverA.sendInboundMessage(msg, {
        address: "0.0.0.0",
        port: 5343,
      });
    });

    const minterfaceA = new MulticastInterface(testDriverA);
    const minterfaceB = new MulticastInterface(testDriverB);
    const abortController = new AbortController();

    const losingRecord: ResourceRecord = {
      NAME: ["my", "proposed", "record"],
      CLASS: DnsClass.IN,
      TYPE: ResourceType.A,
      RDATA: [5, 5, 5, 5],
      isUnique: true,
      TTL: 70,
      RDLENGTH: 4,
    };

    const winningRecord: ResourceRecord = {
      NAME: ["my", "proposed", "record"],
      CLASS: DnsClass.IN,
      TYPE: ResourceType.A,
      RDATA: [5, 5, 5, 5],
      isUnique: true,
      TTL: 70,
      RDLENGTH: 4,
    };

    let aRejected = false;
    let bRejected = false;

    respond({
      minterface: minterfaceA,
      proposedRecords: [winningRecord],
      signal: abortController.signal,
    }).catch(() => {
      aRejected = true;
    });

    respond({
      minterface: minterfaceB,
      proposedRecords: [losingRecord],
      signal: abortController.signal,
    }).catch(() => {
      bRejected = true;
    });

    await delay(500);

    assert(!aRejected && !bRejected);

    abortController.abort();
  },
});

// Announcing

Deno.test({
  name: "Sets the cache-flush bit on records verified unique",

  fn: async () => {
    const sentMessages: DnsMessage[] = [];

    const testDriver = new TestMulticastDriver((msg) => {
      sentMessages.push(msg);
    });

    const minterface = new MulticastInterface(testDriver);

    const proposedRecord: ResourceRecord = {
      NAME: ["my", "proposed", "record"],
      CLASS: DnsClass.IN,
      TYPE: ResourceType.A,
      RDATA: [5, 5, 5, 5],
      // We set it false here deliberately
      isUnique: false,
      TTL: 70,
      RDLENGTH: 4,
    };

    const abortController = new AbortController();

    respond({
      minterface,
      proposedRecords: [proposedRecord],
      signal: abortController.signal,
    }).catch(() => {
    });

    await delay(1000);

    assert(sentMessages[3].answer[0].isUnique);

    abortController.abort();
  },
});

// Conflict resolution
Deno.test({
  name:
    "Rejects if another response is seen with a conflicting record during responding phase",

  fn: async () => {
    const sentMessages: DnsMessage[] = [];

    const testDriver = new TestMulticastDriver((msg) => {
      sentMessages.push(msg);
    });

    const minterface = new MulticastInterface(testDriver);

    const proposedRecord: ResourceRecord = {
      NAME: ["my", "proposed", "record"],
      CLASS: DnsClass.IN,
      TYPE: ResourceType.A,
      RDATA: [5, 5, 5, 5],
      // We set it false here deliberately
      isUnique: false,
      TTL: 70,
      RDLENGTH: 4,
    };

    const abortController = new AbortController();

    let didReject = false;

    respond({
      minterface,
      proposedRecords: [proposedRecord],
      signal: abortController.signal,
    }).catch(() => {
      didReject = true;
    });

    await delay(1000);

    assert(sentMessages[3].answer[0].isUnique);

    const conflictingRecord: ResourceRecord = {
      NAME: ["my", "proposed", "record"],
      CLASS: DnsClass.IN,
      TYPE: ResourceType.A,
      RDATA: [8, 8, 8, 8],
      isUnique: true,
      TTL: 70,
      RDLENGTH: 4,
    };

    testDriver.sendInboundMessage({
      header: {
        ID: 0,
        QR: 1,
        OPCODE: 0,
        AA: 1,
        TC: 0,
        RD: 0,
        RA: 0,
        Z: 0,
        AD: 0,
        CD: 0,
        RCODE: 0,
        QDCOUNT: 0,
        ANCOUNT: 1,
        NSCOUNT: 0,
        ARCOUNT: 0,
      },
      question: [],
      answer: [conflictingRecord],
      authority: [],
      additional: [],
    }, {
      address: "8.8.8.8",
      port: 5353,
    });

    await delay(10);

    assert(didReject);

    abortController.abort();
  },
});

// Responding

Deno.test({
  name:
    "Responds with own records immediately when a qualifying query (prompting a response with only unique records) is received",
  fn: async () => {
    const sentMessages: DnsMessage[] = [];

    const testDriver = new TestMulticastDriver((msg) => {
      sentMessages.push(msg);
    });

    const minterface = new MulticastInterface(testDriver);

    const proposedRecord: ResourceRecord = {
      NAME: ["my", "proposed", "record"],
      CLASS: DnsClass.IN,
      TYPE: ResourceType.A,
      RDATA: [5, 5, 5, 5],
      isUnique: true,
      TTL: 70,
      RDLENGTH: 4,
    };

    const abortController = new AbortController();

    respond({
      minterface,
      proposedRecords: [proposedRecord],
      signal: abortController.signal,
    }).catch(() => {
      // We aborted
    });

    await delay(2000);

    // Three probes, two announces
    assertEquals(sentMessages.length, 5);

    testDriver.sendInboundMessage({
      header: {
        ID: 0,
        QR: 0,
        OPCODE: 0,
        AA: 1,
        TC: 0,
        RD: 0,
        RA: 0,
        Z: 0,
        AD: 0,
        CD: 0,
        RCODE: 0,
        QDCOUNT: 1,
        ANCOUNT: 0,
        NSCOUNT: 0,
        ARCOUNT: 0,
      },
      question: [
        {
          QCLASS: DnsClass.IN,
          QNAME: ["my", "proposed", "record"],
          QTYPE: ResourceType.A,
        },
      ],
      answer: [],
      authority: [],
      additional: [],
    }, {
      address: "9.9.9.9",
      port: 5353,
    });

    await delay(1);

    assertEquals(sentMessages[5].answer[0].NAME, proposedRecord.NAME);
    assertEquals(sentMessages[5].answer[0].RDATA, proposedRecord.RDATA);

    abortController.abort();
  },
});

Deno.test({
  name: "Defends claimed name from probes immediately",
  fn: async () => {
    const sentMessages: DnsMessage[] = [];

    const testDriver = new TestMulticastDriver((msg) => {
      sentMessages.push(msg);
    });

    const minterface = new MulticastInterface(testDriver);

    const proposedARecord: ResourceRecord = {
      NAME: ["my", "proposed", "record"],
      CLASS: DnsClass.IN,
      TYPE: ResourceType.A,
      RDATA: [5, 5, 5, 5],
      isUnique: true,
      TTL: 70,
      RDLENGTH: 4,
    };

    const proposedPtrRecord: ResourceRecord = {
      NAME: ["my", "proposed", "record"],
      CLASS: DnsClass.IN,
      TYPE: ResourceType.PTR,
      RDATA: ["my", "ptr"],
      isUnique: false,
      TTL: 70,
      RDLENGTH: 4,
    };

    const abortController = new AbortController();

    respond({
      minterface,
      proposedRecords: [proposedARecord, proposedPtrRecord],
      signal: abortController.signal,
    }).catch(() => {
      // We aborted
    });

    await delay(2000);

    // Three probes, two announces
    assertEquals(sentMessages.length, 5);

    testDriver.sendInboundMessage({
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
        QDCOUNT: 1,
        ANCOUNT: 0,
        NSCOUNT: 1,
        ARCOUNT: 0,
      },
      question: [
        {
          QCLASS: DnsClass.IN,
          QNAME: ["my", "proposed", "record"],
          QTYPE: ResourceType.ANY,
        },
      ],
      answer: [],
      authority: [proposedARecord],
      additional: [],
    }, {
      address: "9.9.9.9",
      port: 5353,
    });

    await delay(1);

    assertEquals(sentMessages[5].answer[0].NAME, proposedARecord.NAME);
    assertEquals(sentMessages[5].answer[0].RDATA, proposedARecord.RDATA);

    abortController.abort();
  },
});

Deno.test({
  name: "Delays response by 20 - 120ms if some answers are shared resources",
  fn: async () => {
    const sentMessages: DnsMessage[] = [];

    const testDriver = new TestMulticastDriver((msg) => {
      sentMessages.push(msg);
    });

    const minterface = new MulticastInterface(testDriver);

    const proposedARecord: ResourceRecord = {
      NAME: ["my", "proposed", "record"],
      CLASS: DnsClass.IN,
      TYPE: ResourceType.A,
      RDATA: [5, 5, 5, 5],
      isUnique: true,
      TTL: 70,
      RDLENGTH: 4,
    };

    const proposedPtrRecord: ResourceRecord = {
      NAME: ["my", "proposed", "record"],
      CLASS: DnsClass.IN,
      TYPE: ResourceType.PTR,
      RDATA: ["my", "ptr"],
      isUnique: false,
      TTL: 70,
      RDLENGTH: 4,
    };

    const abortController = new AbortController();

    respond({
      minterface,
      proposedRecords: [proposedARecord, proposedPtrRecord],
      signal: abortController.signal,
    }).catch(() => {
      // We aborted
    });

    await delay(2000);

    // Three probes, two announces
    assertEquals(sentMessages.length, 5);

    testDriver.sendInboundMessage({
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
        QDCOUNT: 1,
        ANCOUNT: 0,
        NSCOUNT: 0,
        ARCOUNT: 0,
      },
      question: [
        {
          QCLASS: DnsClass.IN,
          QNAME: ["my", "proposed", "record"],
          QTYPE: ResourceType.ANY,
        },
      ],
      answer: [],
      authority: [],
      additional: [],
    }, {
      address: "9.9.9.9",
      port: 5353,
    });

    await delay(1);

    assertEquals(sentMessages.length, 5);

    await delay(120);

    assertEquals(sentMessages[5].answer[0].NAME, proposedARecord.NAME);
    assertEquals(sentMessages[5].answer[0].RDATA, proposedARecord.RDATA);

    abortController.abort();
  },
});

Deno.test({
  name: "Sets a TTL of 120 for A, AAAA, SRV, or reverse-mapping PTR records",
  fn: async () => {
    const sentMessages: DnsMessage[] = [];

    const testDriver = new TestMulticastDriver((msg) => {
      sentMessages.push(msg);
    });

    const minterface = new MulticastInterface(testDriver);

    const proposedRecord: ResourceRecord = {
      NAME: ["my", "proposed", "record"],
      CLASS: DnsClass.IN,
      TYPE: ResourceType.A,
      RDATA: [5, 5, 5, 5],
      isUnique: true,
      TTL: 70,
      RDLENGTH: 4,
    };

    const abortController = new AbortController();

    respond({
      minterface,
      proposedRecords: [proposedRecord],
      signal: abortController.signal,
    }).catch(() => {
      // We aborted
    });

    await delay(2000);

    // Three probes, two announces
    assertEquals(sentMessages.length, 5);

    testDriver.sendInboundMessage({
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
        QDCOUNT: 1,
        ANCOUNT: 0,
        NSCOUNT: 0,
        ARCOUNT: 0,
      },
      question: [
        {
          QCLASS: DnsClass.IN,
          QNAME: ["my", "proposed", "record"],
          QTYPE: ResourceType.ANY,
        },
      ],
      answer: [],
      authority: [],
      additional: [],
    }, {
      address: "9.9.9.9",
      port: 5353,
    });

    await delay(1);

    assertEquals(sentMessages[5].answer[0].TTL, 120);

    abortController.abort();
  },
});

Deno.test({
  name:
    "Aggregates as many responses as possible into a single multicast DNS message",
  fn: async () => {
    const sentMessages: DnsMessage[] = [];

    const testDriver = new TestMulticastDriver((msg) => {
      sentMessages.push(msg);
    });

    const minterface = new MulticastInterface(testDriver);

    const proposedARecord: ResourceRecord = {
      NAME: ["my", "proposed", "record"],
      CLASS: DnsClass.IN,
      TYPE: ResourceType.A,
      RDATA: [5, 5, 5, 5],
      isUnique: true,
      TTL: 70,
      RDLENGTH: 4,
    };

    const proposedPtrRecord: ResourceRecord = {
      NAME: ["my", "proposed", "record"],
      CLASS: DnsClass.IN,
      TYPE: ResourceType.PTR,
      RDATA: ["my", "ptr"],
      isUnique: false,
      TTL: 70,
      RDLENGTH: 4,
    };

    const abortController = new AbortController();

    respond({
      minterface,
      proposedRecords: [proposedARecord, proposedPtrRecord],
      signal: abortController.signal,
    }).catch(() => {
      // We aborted
    });

    await delay(2000);

    // Three probes, two announces
    assertEquals(sentMessages.length, 5);

    testDriver.sendInboundMessage({
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
        QDCOUNT: 1,
        ANCOUNT: 0,
        NSCOUNT: 0,
        ARCOUNT: 0,
      },
      question: [
        {
          QCLASS: DnsClass.IN,
          QNAME: ["my", "proposed", "record"],
          QTYPE: ResourceType.ANY,
        },
      ],
      answer: [],
      authority: [],
      additional: [],
    }, {
      address: "9.9.9.9",
      port: 5353,
    });

    await delay(1);

    assertEquals(sentMessages.length, 5);

    await delay(120);

    assertEquals(sentMessages[5].answer[0].NAME, proposedARecord.NAME);
    assertEquals(sentMessages[5].answer[0].RDATA, proposedARecord.RDATA);

    abortController.abort();
  },
});

Deno.test({
  name: "Responds to ANY type queries with ALL matching records.",
  fn: async () => {
    const sentMessages: DnsMessage[] = [];

    const testDriver = new TestMulticastDriver((msg) => {
      sentMessages.push(msg);
    });

    const minterface = new MulticastInterface(testDriver);

    const proposedRecord: ResourceRecord = {
      NAME: ["my", "proposed", "record"],
      CLASS: DnsClass.IN,
      TYPE: ResourceType.A,
      RDATA: [5, 5, 5, 5],
      isUnique: true,
      TTL: 70,
      RDLENGTH: 4,
    };

    const abortController = new AbortController();

    respond({
      minterface,
      proposedRecords: [proposedRecord],
      signal: abortController.signal,
    }).catch(() => {
      // We aborted
    });

    await delay(2000);

    // Three probes, two announces
    assertEquals(sentMessages.length, 5);

    testDriver.sendInboundMessage({
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
        QDCOUNT: 1,
        ANCOUNT: 0,
        NSCOUNT: 0,
        ARCOUNT: 0,
      },
      question: [
        {
          QCLASS: DnsClass.IN,
          QNAME: ["my", "proposed", "record"],
          QTYPE: ResourceType.ANY,
        },
      ],
      answer: [],
      authority: [],
      additional: [],
    }, {
      address: "9.9.9.9",
      port: 5353,
    });

    await delay(1);

    assertEquals(sentMessages[5].answer[0].NAME, proposedRecord.NAME);
    assertEquals(sentMessages[5].answer[0].RDATA, proposedRecord.RDATA);

    abortController.abort();
  },
});

// Known answer suppression.

Deno.test({
  name:
    "Does not answers a query if the answer it would give is already in the answer section AND the answer has a TTL at least half the value of the TTL we know",
  fn: async () => {
    const sentMessages: DnsMessage[] = [];

    const testDriver = new TestMulticastDriver((msg) => {
      sentMessages.push(msg);
    });

    const minterface = new MulticastInterface(testDriver);

    const proposedRecord: ResourceRecord = {
      NAME: ["my", "proposed", "record"],
      CLASS: DnsClass.IN,
      TYPE: ResourceType.A,
      RDATA: [5, 5, 5, 5],
      isUnique: true,
      TTL: 120,
      RDLENGTH: 4,
    };

    const abortController = new AbortController();

    respond({
      minterface,
      proposedRecords: [proposedRecord],
      signal: abortController.signal,
    }).catch(() => {
      // We aborted
    });

    await delay(2000);

    // Three probes, two announces
    assertEquals(sentMessages.length, 5);

    testDriver.sendInboundMessage({
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
        QDCOUNT: 1,
        ANCOUNT: 1,
        NSCOUNT: 0,
        ARCOUNT: 0,
      },
      question: [{
        QCLASS: DnsClass.IN,
        QNAME: ["my", "proposed", "record"],
        QTYPE: ResourceType.ANY,
      }],
      answer: [proposedRecord],
      authority: [],
      additional: [],
    }, {
      address: "9.9.9.9",
      port: 5353,
    });

    await delay(1);

    // Should have suppressed any response
    assertEquals(sentMessages.length, 5);

    abortController.abort();
  },
});

// Says goodbye

Deno.test({
  name: "Sends a goodbye packet when it is being shut down",
  fn: async () => {
    const sentMessages: DnsMessage[] = [];

    const testDriver = new TestMulticastDriver((msg) => {
      sentMessages.push(msg);
    });

    const minterface = new MulticastInterface(testDriver);

    const proposedRecord: ResourceRecord = {
      NAME: ["my", "proposed", "record"],
      CLASS: DnsClass.IN,
      TYPE: ResourceType.A,
      RDATA: [5, 5, 5, 5],
      isUnique: true,
      TTL: 120,
      RDLENGTH: 4,
    };

    const abortController = new AbortController();

    respond({
      minterface,
      proposedRecords: [proposedRecord],
      signal: abortController.signal,
    }).catch(() => {
      // We aborted
    });

    await delay(2000);

    // Three probes, two announces
    assertEquals(sentMessages.length, 5);

    abortController.abort();

    assertEquals(sentMessages.length, 6);

    assert(sentMessages[5].answer.every((answer) => answer.TTL === 0));
  },
});

Deno.test({
  name: "Responds when it authoritatively knows a record does not exist",
  fn: async () => {
    // IPv6 interface cannot refute existence of A address.
    const sentMessages: DnsMessage[] = [];

    const testDriver = new TestMulticastDriver((msg) => {
      sentMessages.push(msg);
    });

    const minterface = new MulticastInterface(testDriver);

    const abortController = new AbortController();

    respond({
      minterface,
      proposedRecords: [{
        NAME: ["my", "proposed", "record"],
        CLASS: DnsClass.IN,
        TYPE: ResourceType.TXT,
        RDATA: { "test": true },
        isUnique: true,
        TTL: 120,
        RDLENGTH: 4,
      }, {
        NAME: ["my", "proposed", "record"],
        CLASS: DnsClass.IN,
        TYPE: ResourceType.PTR,
        RDATA: ["ptr", "label"],
        isUnique: false,
        TTL: 120,
        RDLENGTH: 4,
      }],
      signal: abortController.signal,
    }).catch(() => {
      // We aborted
    });

    await delay(2000);

    // Three probes, two announces
    assertEquals(sentMessages.length, 5);

    testDriver.sendInboundMessage({
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
        QDCOUNT: 1,
        ANCOUNT: 0,
        NSCOUNT: 0,
        ARCOUNT: 0,
      },
      question: [{
        QCLASS: DnsClass.IN,
        QNAME: ["my", "proposed", "record"],
        QTYPE: ResourceType.A,
      }],
      answer: [],
      authority: [],
      additional: [],
    }, {
      address: "9.9.9.9",
      port: 5353,
    });

    await delay(10);

    await delay(120);

    assertEquals(sentMessages[5].answer[0].TYPE, ResourceType.NSEC);

    testDriver.sendInboundMessage({
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
        QDCOUNT: 1,
        ANCOUNT: 0,
        NSCOUNT: 0,
        ARCOUNT: 0,
      },
      question: [{
        QCLASS: DnsClass.IN,
        QNAME: ["my", "proposed", "record"],
        QTYPE: ResourceType.AAAA,
      }],
      answer: [],
      authority: [],
      additional: [],
    }, {
      address: "9.9.9.9",
      port: 5353,
    });

    await delay(120);

    assertEquals(sentMessages.length, 6);

    abortController.abort();
  },
});

// These are now the responsibility of the DNS-SD layer

/*

Deno.test("If a conflicting response is received after querying, choose new resource record names", () => {});
Deno.test("If there are fifteen conflicts within ten seconds, wait five seconds before each successive probe attempt", () => {});

Deno.test("Switches to probing after being resumed", () => {});
Deno.test("Announces unique records with cache-flush bit set after resuming and successful probe", () => {});

*/
