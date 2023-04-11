import {
  DnsClass,
  DnsMessage,
  ResourceRecordA,
  ResourceRecordPTR,
  ResourceType,
} from "../src/decode/types.ts";
import { MulticastInterface } from "../src/mdns/multicast_interface.ts";
import { Query, QueryCacheEvent } from "../src/mdns/query.ts";
import { TestMulticastDriver } from "./test_multicast_driver.ts";
import { delay } from "https://deno.land/std@0.177.0/async/delay.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

Deno.test("Sends the appropriate questions", async () => {
  const messages: DnsMessage[] = [];

  const minterface = new MulticastInterface(
    new TestMulticastDriver("0.0.0.0", (message) => {
      messages.push(message);
    }),
  );

  const query = new Query([
    {
      name: "my.a.query",
      recordType: ResourceType.A,
    },
    {
      name: "my.ptr.query",
      recordType: ResourceType.PTR,
    },
    {
      name: "my.srv.query",
      recordType: ResourceType.SRV,
    },
  ], minterface);

  await delay(121);

  assert(messages[0]);
  assert(messages[0].question.length === 3);
  assertEquals(messages[0].question[0], {
    QNAME: ["my", "a", "query"],
    QTYPE: ResourceType.A,
    QCLASS: 1,
  });
  assertEquals(messages[0].question[1], {
    QNAME: ["my", "ptr", "query"],
    QTYPE: ResourceType.PTR,
    QCLASS: 1,
  });

  assertEquals(messages[0].question[2], {
    QNAME: ["my", "srv", "query"],
    QTYPE: ResourceType.SRV,
    QCLASS: 1,
  });

  query.end();
});

Deno.test("Delays the first query by 20ms - 120ms", async () => {
  const messages: DnsMessage[] = [];

  const minterface = new MulticastInterface(
    new TestMulticastDriver("0.0.0.0", (message) => {
      messages.push(message);
    }),
  );

  const query = new Query([
    {
      name: "my.test.site",
      recordType: 1,
    },
  ], minterface);

  await delay(19);

  assertEquals(messages.length, 0);

  await delay(121);

  assertEquals(messages.length, 1);

  query.end();
});

Deno.test({
  name:
    "Its second query comes one second after its first, and then by a factor of two each time after that",

  fn: async () => {
    const messages: DnsMessage[] = [];

    const minterface = new MulticastInterface(
      new TestMulticastDriver("0.0.0.0", (message) => {
        messages.push(message);
      }),
    );

    const query = new Query([
      {
        name: "my.test.site",
        recordType: 1,
      },
    ], minterface);

    await delay(121 + 1000);

    assertEquals(messages.length, 2);

    await delay(2000);

    assertEquals(messages.length, 3);

    query.end();
  },
});

Deno.test({
  name:
    "Includes known answers in its queries in the answer section (known answer suppression)",

  fn: async () => {
    const messages: DnsMessage[] = [];

    const testDriver = new TestMulticastDriver("0.0.0.0", (message) => {
      messages.push(message);
    });

    const minterface = new MulticastInterface(testDriver);

    const query = new Query([
      {
        name: "my.ptr.query",
        recordType: ResourceType.PTR,
      },
    ], minterface);

    await delay(121);

    const ptrAnswer: ResourceRecordPTR = {
      CLASS: DnsClass.IN,
      TYPE: ResourceType.PTR,
      NAME: ["my", "ptr", "query"],
      isUnique: false,
      TTL: 2000,
      RDATA: ["ptd", "labels"],
      RDLENGTH: 12,
    };

    testDriver.sendInboundMessage({
      header: {
        ID: 0,
        QR: 1,
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
        ANCOUNT: 1,
        NSCOUNT: 0,
        ARCOUNT: 0,
      },
      question: [],
      answer: [ptrAnswer],
      authority: [],
      additional: [],
    }, { hostname: "5.5.5.5", port: 5353 });

    await delay(1000);

    assertEquals(messages[1].answer.length, 1);
    assertEquals(messages[1].answer[0], ptrAnswer);

    query.end();
  },
});

Deno.test({
  name:
    "Valid answers are added to the cache upon reception, and are removed when they expire.",
  fn: async () => {
    const testDriver = new TestMulticastDriver("0.0.0.0", () => {});

    const minterface = new MulticastInterface(testDriver);

    const query = new Query([
      {
        name: "my.ptr.query",
        recordType: ResourceType.PTR,
      },
    ], minterface);

    const events: QueryCacheEvent[] = [];

    (async () => {
      for await (const event of query) {
        events.push(event);
      }
    })();

    await delay(121);

    const ptrAnswer: ResourceRecordPTR = {
      CLASS: DnsClass.IN,
      TYPE: ResourceType.PTR,
      NAME: ["my", "ptr", "query"],
      isUnique: false,
      TTL: 1,
      RDATA: ["ptd", "labels"],
      RDLENGTH: 12,
    };

    testDriver.sendInboundMessage({
      header: {
        ID: 0,
        QR: 1,
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
        ANCOUNT: 1,
        NSCOUNT: 0,
        ARCOUNT: 0,
      },
      question: [],
      answer: [ptrAnswer],
      authority: [],
      additional: [],
    }, { hostname: "5.5.5.5", port: 5353 });

    await delay(1);

    assertEquals(events.length, 1);

    assertEquals(events[0], {
      kind: "ADDED",
      record: ptrAnswer,
    });

    await delay(1000);

    assertEquals(events.length, 2);

    assertEquals(events[1], {
      kind: "EXPIRED",
      record: ptrAnswer,
    });

    query.end();
  },
});

Deno.test({
  name: "As an answer approaches expiry it is requeried",
  fn: async () => {
    const messages: DnsMessage[] = [];
    const testDriver = new TestMulticastDriver("0.0.0.0", (message) => {
      messages.push(message);
    });

    const minterface = new MulticastInterface(testDriver);

    const query = new Query([
      {
        name: "my.ptr.query",
        recordType: ResourceType.PTR,
      },
    ], minterface);

    await delay(121);

    const ptrAnswer: ResourceRecordPTR = {
      CLASS: DnsClass.IN,
      TYPE: ResourceType.PTR,
      NAME: ["my", "ptr", "query"],
      isUnique: false,
      TTL: 1,
      RDATA: ["ptd", "labels"],
      RDLENGTH: 12,
    };

    testDriver.sendInboundMessage({
      header: {
        ID: 0,
        QR: 1,
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
        ANCOUNT: 1,
        NSCOUNT: 0,
        ARCOUNT: 0,
      },
      question: [],
      answer: [ptrAnswer],
      authority: [],
      additional: [],
    }, { hostname: "5.5.5.5", port: 5353 });

    await delay(1);

    assertEquals(messages.length, 1);

    await delay(1000);

    assertEquals(messages.length, 7);

    assertEquals(messages[3].question[0], {
      QNAME: ["my", "ptr", "query"],
      QTYPE: ResourceType.PTR,
      QCLASS: DnsClass.IN,
    });

    query.end();
  },
});

Deno.test({
  name: "Adds non-unique records without replacing them",
  fn: async () => {
    const messages: DnsMessage[] = [];
    const testDriver = new TestMulticastDriver("0.0.0.0", (message) => {
      messages.push(message);
    });

    const minterface = new MulticastInterface(testDriver);

    const query = new Query([
      {
        name: "my.ptr.query",
        recordType: ResourceType.PTR,
      },
    ], minterface);

    await delay(121);

    const ptrAnswer1: ResourceRecordPTR = {
      CLASS: DnsClass.IN,
      TYPE: ResourceType.PTR,
      NAME: ["my", "ptr", "query"],
      isUnique: false,
      TTL: 100,
      RDATA: ["ptd", "labels"],
      RDLENGTH: 12,
    };

    testDriver.sendInboundMessage({
      header: {
        ID: 0,
        QR: 1,
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
        ANCOUNT: 1,
        NSCOUNT: 0,
        ARCOUNT: 0,
      },
      question: [],
      answer: [ptrAnswer1],
      authority: [],
      additional: [],
    }, { hostname: "5.5.5.5", port: 5353 });

    const ptrAnswer1Updated: ResourceRecordPTR = {
      CLASS: DnsClass.IN,
      TYPE: ResourceType.PTR,
      NAME: ["my", "ptr", "query"],
      isUnique: false,
      TTL: 200,
      RDATA: ["ptd", "labels"],
      RDLENGTH: 12,
    };

    const ptrAnswer2: ResourceRecordPTR = {
      CLASS: DnsClass.IN,
      TYPE: ResourceType.PTR,
      NAME: ["my", "ptr", "query"],
      isUnique: false,
      TTL: 300,
      RDATA: ["ptd", "labels2"],
      RDLENGTH: 13,
    };

    testDriver.sendInboundMessage({
      header: {
        ID: 0,
        QR: 1,
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
        ANCOUNT: 2,
        NSCOUNT: 0,
        ARCOUNT: 0,
      },
      question: [],
      answer: [ptrAnswer1Updated, ptrAnswer2],
      authority: [],
      additional: [],
    }, { hostname: "5.5.5.5", port: 5353 });

    await delay(1);

    query.end();
  },
});

Deno.test({
  name: "Flushes outdated cache entries for unique records",

  fn: async () => {
    const messages: DnsMessage[] = [];
    const testDriver = new TestMulticastDriver("0.0.0.0", (message) => {
      messages.push(message);
    });

    const minterface = new MulticastInterface(testDriver);

    const query = new Query([
      {
        name: "my.a.query",
        recordType: ResourceType.A,
      },
    ], minterface);

    const events: QueryCacheEvent[] = [];

    (async () => {
      for await (const event of query) {
        events.push(event);
      }
    })();

    await delay(121);

    const aAnswer1: ResourceRecordA = {
      CLASS: DnsClass.IN,
      TYPE: ResourceType.A,
      NAME: ["my", "a", "query"],
      isUnique: true,
      TTL: 1000,
      RDATA: [5, 5, 5, 5],
      RDLENGTH: 4,
    };

    testDriver.sendInboundMessage({
      header: {
        ID: 0,
        QR: 1,
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
        ANCOUNT: 1,
        NSCOUNT: 0,
        ARCOUNT: 0,
      },
      question: [],
      answer: [aAnswer1],
      authority: [],
      additional: [],
    }, { hostname: "5.5.5.5", port: 5353 });

    const aAnswer2: ResourceRecordA = {
      CLASS: DnsClass.IN,
      TYPE: ResourceType.A,
      NAME: ["my", "a", "query"],
      isUnique: true,
      TTL: 1000,
      RDATA: [6, 6, 6, 6],
      RDLENGTH: 4,
    };

    testDriver.sendInboundMessage({
      header: {
        ID: 0,
        QR: 1,
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
        ANCOUNT: 1,
        NSCOUNT: 0,
        ARCOUNT: 0,
      },
      question: [],
      answer: [aAnswer2],
      authority: [],
      additional: [],
    }, { hostname: "5.5.5.5", port: 5353 });

    await delay(1);

    assertEquals(events, [
      { kind: "ADDED", record: aAnswer1 },
      { kind: "FLUSHED", record: aAnswer1 },
      { kind: "ADDED", record: aAnswer2 },
    ]);

    query.end();
  },
});

Deno.test({
  name: "Suppresses questions for unique records if it already has it.",
  // Situation: a query is made for both PTR and A records. An A record is received. When the next scheduled query comes, then we should only ask for the PTR records.
  fn: async () => {
    const messages: DnsMessage[] = [];

    const testDriver = new TestMulticastDriver("0.0.0.0", (message) => {
      messages.push(message);
    });

    const minterface = new MulticastInterface(testDriver);

    const query = new Query([
      {
        name: "my.a.question",
        recordType: ResourceType.A,
      },
      {
        name: "my.ptr.question",
        recordType: ResourceType.PTR,
      },
    ], minterface);

    await delay(121);

    testDriver.sendInboundMessage({
      header: {
        ID: 0,
        QR: 1,
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
        ANCOUNT: 1,
        NSCOUNT: 0,
        ARCOUNT: 0,
      },
      question: [],
      answer: [{
        NAME: ["my", "a", "question"],
        CLASS: DnsClass.IN,
        TYPE: ResourceType.A,
        isUnique: true,
        TTL: 60,
        RDATA: [5, 5, 5, 5],
        RDLENGTH: 10,
      }],
      authority: [],
      additional: [],
    }, { hostname: "5.5.5.5", port: 5353 });

    assertEquals(messages[0].question.length, 2);

    await delay(1000);

    assertEquals(messages[1].question.length, 1);

    query.end();
  },
});

Deno.test({
  name: "Suppresses questions it has just seen on the network.",
  fn: async () => {
    const messages: DnsMessage[] = [];

    const testDriver = new TestMulticastDriver("0.0.0.0", (message) => {
      messages.push(message);
    });

    const minterface = new MulticastInterface(testDriver);

    const query = new Query([
      {
        name: "my.ptr.question",
        recordType: ResourceType.PTR,
      },
    ], minterface);

    await delay(121);

    assertEquals(messages[0].question.length, 1);

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
        QNAME: ["my", "ptr", "question"],
        QTYPE: ResourceType.PTR,
      }],
      answer: [],
      authority: [],
      additional: [],
    }, { hostname: "5.5.5.5", port: 5353 });

    await delay(1000);

    // It'll be suppressed for the next scheduled message, so no message will be sent.

    assertEquals(messages.length, 1);

    await delay(2000);

    // But on the next query it'll send again.

    assertEquals(messages.length, 2);

    query.end();
  },
});

Deno.test({
  name: "Doesn't run scheduled queries when it knows a definitive answer.",
  fn: async () => {
    const messages: DnsMessage[] = [];

    const testDriver = new TestMulticastDriver("0.0.0.0", (message) => {
      messages.push(message);
    });

    const minterface = new MulticastInterface(testDriver);

    const query = new Query([
      {
        name: "my.a.question",
        recordType: ResourceType.A,
      },
    ], minterface);

    await delay(121);

    testDriver.sendInboundMessage({
      header: {
        ID: 0,
        QR: 1,
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
        ANCOUNT: 1,
        NSCOUNT: 0,
        ARCOUNT: 0,
      },
      question: [],
      answer: [{
        NAME: ["my", "a", "question"],
        CLASS: DnsClass.IN,
        TYPE: ResourceType.A,
        isUnique: true,
        TTL: 60,
        RDATA: [5, 5, 5, 5],
        RDLENGTH: 10,
      }],
      authority: [],
      additional: [],
    }, { hostname: "5.5.5.5", port: 5353 });

    assertEquals(messages[0].question.length, 1);

    await delay(1000);

    assertEquals(messages.length, 1);

    await delay(2000);

    assertEquals(messages.length, 1);

    query.end();
  },
});

Deno.test({
  name:
    "When receiving a record with a TTL of 0 (goodbye packet), record with a TTL of 1 and delete one second later.",
  fn: async () => {
    const messages: DnsMessage[] = [];

    const testDriver = new TestMulticastDriver("0.0.0.0", (message) => {
      messages.push(message);
    });

    const minterface = new MulticastInterface(testDriver);

    const query = new Query([
      {
        name: "my.a.question",
        recordType: ResourceType.A,
      },
    ], minterface);

    const events: QueryCacheEvent[] = [];

    (async () => {
      for await (const event of query) {
        events.push(event);
      }
    })();

    testDriver.sendInboundMessage(
      {
        header: {
          ID: 0,
          QR: 1,
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
          ANCOUNT: 1,
          NSCOUNT: 0,
          ARCOUNT: 0,
        },
        question: [],
        answer: [{
          NAME: ["my", "a", "question"],
          CLASS: DnsClass.IN,
          TYPE: ResourceType.A,
          isUnique: true,
          TTL: 60,
          RDATA: [5, 5, 5, 5],
          RDLENGTH: 10,
        }],
        authority: [],
        additional: [],
      },
      { hostname: "5.5.5.5", port: 5353 },
    );

    await delay(1);

    assertEquals(events[0].kind, "ADDED");

    testDriver.sendInboundMessage(
      {
        header: {
          ID: 0,
          QR: 1,
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
          ANCOUNT: 1,
          NSCOUNT: 0,
          ARCOUNT: 0,
        },
        question: [],
        answer: [{
          NAME: ["my", "a", "question"],
          CLASS: DnsClass.IN,
          TYPE: ResourceType.A,
          isUnique: true,
          TTL: 0,
          RDATA: [5, 5, 5, 5],
          RDLENGTH: 10,
        }],
        authority: [],
        additional: [],
      },
      { hostname: "5.5.5.5", port: 5353 },
    );

    await delay(1);
    // Updated.

    assertEquals(events[1].kind, "ADDED");

    // Wait a second

    await delay(1000);

    // Expired.
    assertEquals(events[2].kind, "EXPIRED");

    query.end();
  },
});

Deno.test({
  name:
    "Expires a record for which it has seen 3 queries issued but no response seen",
  fn: () => {},
});
