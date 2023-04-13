import { deferred } from "https://deno.land/std@0.177.0/async/deferred.ts";
import { concat } from "https://deno.land/std@0.177.0/bytes/concat.ts";
import {
  encodeRdataA,
  encodeRdataAAAA,
  encodeRdataTXT,
} from "../decode/message_encode.ts";
import {
  DnsClass,
  DnsMessage,
  DnsQuestionSection,
  isResourceRecordA,
  isResourceRecordAAAA,
  isResourceRecordNSEC,
  isResourceRecordPTR,
  isResourceRecordSRV,
  isResourceRecordTXT,
  ResourceRecord,
  ResourceRecordNSEC,
  ResourceRecordSRV,
  ResourceType,
} from "../decode/types.ts";
import { MulticastInterface } from "./multicast_interface.ts";

export type RespondingRecord = ResourceRecord & {
  /** Records which should be included in the additional section of the DNS message when this record is used in a response. */
  additional?: ResourceRecord[];
};

export type RespondOpts = {
  /** The DNS records a responder wants to be authoritative for */
  proposedRecords: RespondingRecord[];
  multicastInterface: MulticastInterface;
  signal?: AbortSignal;
};

/** Runs a multicast DNS responder for the given resource records.
 *
 * Returns a promise that will reject when:
 * - Probing for proposed records fails
 * - Another responder starts responding with records our responder previously lay claim to.
 */
export async function respond(opts: RespondOpts) {
  let aborted = false;

  if (opts.proposedRecords.length === 0) {
    return Promise.reject("No proposed records were given for responding with");
  }

  const probeResponse = await probe(opts);

  if (probeResponse !== "success") {
    return Promise.reject(probeResponse);
  }

  const sender = new AggregatingScheduledSend(opts.multicastInterface);

  const respondPromise = deferred();

  if (opts.signal) {
    opts.signal.addEventListener("abort", () => {
      // Send goodbye packets for all our records.
      opts.multicastInterface.send({
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
          ANCOUNT: opts.proposedRecords.length,
          NSCOUNT: 0,
          ARCOUNT: 0,
        },
        question: [],
        answer: opts.proposedRecords.map((record) => {
          return {
            ...record,
            isUnique: record.TYPE !== ResourceType.PTR,
            TTL: 0,
          };
        }),
        authority: [],
        additional: [],
      });

      sender.stop();
      respondPromise.reject("aborted");
      aborted = true;
    });
  }

  // Announce.
  announce(opts);

  // Respond.
  (async () => {
    for await (const [message, host] of opts.multicastInterface.messages()) {
      if (aborted) {
        break;
      }

      // Ignore messages from ourselves
      if (opts.multicastInterface.isOwnAddress(host.hostname)) {
        continue;
      }

      if (message.header.QR === 0) {
        // This is a query
        const answers = answersFor(
          message.question,
          opts.proposedRecords,
          message.answer,
          opts.multicastInterface.family,
        );

        // Make sure TTL is good for all records.
        // 120 for A, AAAA, SRV and PTR.
        const answersWithTTL = alterTTLs(answers);

        if (answers.length > 0 && message.authority.length === 0) {
          // This is a standard query

          // If we can answer all questions.
          // and all answers are unique...
          if (
            canAnswerAllQuestions(
              message.question,
              opts.proposedRecords,
            ) &&
            allAnswersAreUnique(answersWithTTL)
          ) {
            // Send immediately
            sender.dispatchImmediately(answersWithTTL);
          } else {
            // Otherwise, schedule response within 20 - 120ms and aggregate.
            sender.addAnswers(answersWithTTL);
          }
        } else if (answers.length > 0 && message.authority.length > 0) {
          // This is a probe.
          // Defend our authority!

          sender.dispatchImmediately(answersWithTTL);
        }
      } else {
        // This a response
        for (const answer of message.answer) {
          // Check if this response contains records which are the same as our own
          for (const ourRecord of opts.proposedRecords) {
            const rdataIsSame = recordSort(answer, ourRecord) === 0;
            const nameIsSame = answer.NAME.join(".").toUpperCase() ===
              ourRecord.NAME.join(".").toUpperCase();

            const isSame = nameIsSame && rdataIsSame;

            if (isSame && answer.TTL === 0) {
              // Rescue the records and send them out.
              sender.addAnswers([ourRecord]);
            } else if (isConflicting(answer, ourRecord)) {
              // Someone else is sending out records that conflict with ours!
              // We need to start over.

              respondPromise.reject(
                "Conflicting record was received from another host.",
              );

              aborted = true;
            }
          }
        }
      }
    }
  })();

  return respondPromise;
}

/** Returns answers (as resource records) for a given set of questions.
 *
 * Applies known answer suppression, and also adds NSEC records for questions to which we know there is no answer.
 */
function answersFor(
  questions: DnsQuestionSection[],
  /** The pool of potential answers to select from. */
  answers: ResourceRecord[],
  /** Answers the querying party already knows. */
  knownAnswers: ResourceRecord[],
  /** The family of IP addresses used by us. */
  family: "IPv4" | "IPv6",
) {
  const validAnswers = new Set<RespondingRecord>();
  /** A map of names to resource types we actually hold. */
  const heldTypesForNsec = new Map<string, Set<ResourceType>>();

  for (const question of questions) {
    for (const record of answers) {
      const isRightType = record.TYPE === question.QTYPE ||
        question.QTYPE === ResourceType.ANY;
      const isRightName = record.NAME.join(".").toUpperCase() ===
        question.QNAME.join(".").toUpperCase();

      if (isRightType && isRightName) {
        let shouldSuppress = false;

        // Check if we should suppress this answer.
        for (const knownAnswer of knownAnswers) {
          const isKnownName = record.NAME.join(".").toUpperCase() ===
            knownAnswer.NAME.join(".").toUpperCase();
          const isKnownType = record.TYPE === knownAnswer.TYPE;
          const ttlIsMoreThanHalfOfOwn = knownAnswer.TTL >= record.TTL / 2;

          if (isKnownName && isKnownType && ttlIsMoreThanHalfOfOwn) {
            shouldSuppress = true;
          }
        }

        if (shouldSuppress) {
          continue;
        }

        validAnswers.add(record);
      }

      /** There are some records which we can't definitively know don't exist
       * For instance, we can't know there's no AAAA record if we are using a IPv4 interface
       */
      const unknowableByUs =
        (question.QTYPE === ResourceType.AAAA && family === "IPv4") ||
        (question.QTYPE === ResourceType.A && family === "IPv6");

      if (isRightName && !isRightType && record.isUnique && !unknowableByUs) {
        const name = question.QNAME.join(".");

        const resourceTypesForName = heldTypesForNsec.get(name);

        if (resourceTypesForName) {
          resourceTypesForName.add(record.TYPE);
        } else {
          heldTypesForNsec.set(name, new Set([record.TYPE]));
        }
      }
    }
  }

  for (const [name, heldTypes] of heldTypesForNsec) {
    // Make an NSEC record to add to valid answers
    const nsecRecord: ResourceRecordNSEC = {
      CLASS: DnsClass.IN,
      isUnique: false,
      NAME: name.split("."),
      TYPE: ResourceType.NSEC,
      TTL: 120,
      RDATA: {
        nextDomainName: name.split("."),
        types: Array.from(heldTypes),
      },
      RDLENGTH: heldTypes.size,
    };

    validAnswers.add(nsecRecord);
  }

  return Array.from(validAnswers);
}

/** Normalise TTLs of specific types of resource records  */
function alterTTLs(records: RespondingRecord[]) {
  const alteredRecords: RespondingRecord[] = [];

  const ttl120Types = [
    ResourceType.A,
    ResourceType.AAAA,
    ResourceType.SRV,
    ResourceType.SRV,
    ResourceType.PTR,
  ];

  for (const record of records) {
    if (ttl120Types.includes(record.TYPE)) {
      alteredRecords.push({
        ...record,
        // 2 minutes
        TTL: 120,
      });
    } else {
      alteredRecords.push({
        ...record,
        // 75 minutes
        TTL: 60 * 75,
      });
    }
  }

  return alteredRecords;
}

/** This thing can aggregate several answers (given over time) into a single DNS message.
 *
 * It also keeps track of messages sent in the last second so that it won't send them again and flood the network.
 */
class AggregatingScheduledSend {
  private minterface: MulticastInterface;
  private queuedAnswers = new Set<RespondingRecord>();

  private answersSentInLastSecond = new Set<ResourceRecord>();
  /** The timer for the next scheduled send. Null indicates no scheduled send.*/
  private scheduledSend: null | number = null;
  /** Timeout IDs for removing records from answers sent in the last second*/
  private removalTimers: number[] = [];

  constructor(minterface: MulticastInterface) {
    this.minterface = minterface;
  }

  private getNextTimeout() {
    return Math.random() * (120 - 20) + 20;
  }

  private scheduleSend() {
    this.scheduledSend = setTimeout(() => {
      this.dispatchMessage();
    }, this.getNextTimeout());
  }

  /** Dispatch some answers immediately, used when sending out stuff like A records. */
  dispatchImmediately(answers: RespondingRecord[]) {
    const answersToSend = new Set<RespondingRecord>();

    for (const record of answers) {
      if (this.answersSentInLastSecond.has(record)) {
        continue;
      }

      answersToSend.add(record);
    }

    if (answersToSend.size === 0) {
      return;
    }

    const allAdditionals = new Set<ResourceRecord>();

    for (const record of answersToSend) {
      if (!record.additional) {
        continue;
      }

      for (const additional of record.additional) {
        allAdditionals.add(additional);
      }
    }

    const response: DnsMessage = {
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
        ANCOUNT: answersToSend.size,
        NSCOUNT: 0,
        ARCOUNT: allAdditionals.size,
      },
      question: [],
      answer: Array.from(answersToSend).map((record) => {
        return {
          ...record,
          isUnique: record.TYPE !== ResourceType.PTR,
        };
      }),
      authority: [],
      additional: Array.from(allAdditionals),
    };

    this.minterface.send(response);

    this.onSentAnswers(answers);
  }

  /** When some answers were sent, we need to remember that we did for one second so that we don't send them again during that period. */
  private onSentAnswers(sentAnswers: ResourceRecord[]) {
    for (const answer of sentAnswers) {
      this.answersSentInLastSecond.add(answer);

      const removeTimeout = setTimeout(() => {
        this.answersSentInLastSecond.delete(answer);
      }, 1000);

      this.removalTimers.push(removeTimeout);
    }
  }

  private dispatchMessage() {
    const allAdditionals = new Set<ResourceRecord>();

    for (const record of this.queuedAnswers) {
      if (!record.additional) {
        continue;
      }

      for (const additional of record.additional) {
        allAdditionals.add(additional);
      }
    }

    const response: DnsMessage = {
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
        ANCOUNT: this.queuedAnswers.size,
        NSCOUNT: 0,
        ARCOUNT: allAdditionals.size,
      },
      question: [],
      answer: Array.from(this.queuedAnswers).map((record) => {
        return {
          ...record,
          isUnique: record.TYPE !== ResourceType.PTR,
        };
      }),
      authority: [],
      additional: Array.from(allAdditionals),
    };

    this.onSentAnswers(Array.from(this.queuedAnswers));

    this.queuedAnswers.clear();

    this.scheduledSend = null;

    this.minterface.send(response);
  }

  /** Queue answers for sending.
   *
   * Does not queue an answer if it was sent in the last second
   */
  addAnswers(records: RespondingRecord[]) {
    for (const record of records) {
      if (this.answersSentInLastSecond.has(record)) {
        continue;
      }

      this.queuedAnswers.add(record);
    }

    if (this.scheduledSend === null) {
      this.scheduleSend();
    }
  }

  /** Cancel this thing, clear all the timers. */
  stop() {
    if (this.scheduledSend) {
      clearTimeout(this.scheduledSend);
    }

    for (const timer of this.removalTimers) {
      clearTimeout(timer);
    }

    return Array.from(this.queuedAnswers);
  }
}

// PROBE

type ProbeOpts = {
  proposedRecords: ResourceRecord[];
  multicastInterface: MulticastInterface;
  untilFirstProbeMs?: number;
  signal?: AbortSignal;
};

type ProbeResult = "name_taken" | "simultaneous_probe" | "success";

/** Probes the network for another peer who might have already claimed authority for certain records.
 *
 * Returns a promise indicating whether probing was successful or if a conflict was found.
 */
function probe(opts: ProbeOpts): Promise<ProbeResult> {
  const promise = deferred<ProbeResult>();

  const desiredNames = desiredNamesFromRecords(opts.proposedRecords);

  // Create questions to be sent in the probe message.
  const questions = desiredNames.map((name) => ({
    QNAME: name,
    QTYPE: ResourceType.ANY,
    QCLASS: DnsClass.IN,
  }));

  const probeTimers: number[] = [];

  const clearProbeTimers = () => {
    for (const timer of probeTimers) {
      clearTimeout(timer);
    }
  };

  opts.signal?.addEventListener("abort", () => {
    clearProbeTimers();
  });

  let firstProbeSent = false;

  // Listen for incoming answers to our probe.
  // AND for other host probing for the same name.
  (async () => {
    for await (const [message, host] of opts.multicastInterface.messages()) {
      // Is this something we sent ourselves?
      if (firstProbeSent === false) {
        continue;
      }

      if (opts.multicastInterface.isOwnAddress(host.hostname)) {
        continue;
      }

      if (message.header.QR === 1) {
        // It's a response.

        // If someone replies with our desired names.
        if (hasAnyUniqueAnswersForQuestions(questions, message.answer)) {
          // stop the interval
          clearProbeTimers();
          // choose a new name

          promise.resolve("name_taken");
          break;
        }
      } else {
        // It's a query

        // If someone is also probing for the same name...
        if (
          message.authority.length > 0 &&
          isProbingForRecords(message.question, opts.proposedRecords)
        ) {
          // stop the interval.

          // tiebreak!
          const { ourTieBreakers, theirTieBreakers } = getTieBreakerQuestions(
            opts.proposedRecords,
            message.authority,
          );

          const order = sortManyRecords(
            ourTieBreakers,
            theirTieBreakers,
          );

          if (order === -1) {
            // if we lose, probe with the same name again in one second.

            promise.resolve("simultaneous_probe");
            clearProbeTimers();
            break;
          }

          // Continue to probe...
        }
      }
    }
  })();

  const untilFirstProbe = opts.untilFirstProbeMs || Math.random() * 250;

  const probeMessage: DnsMessage = {
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
      QDCOUNT: questions.length,
      ANCOUNT: 0,
      NSCOUNT: opts.proposedRecords.length,
      ARCOUNT: 0,
    },
    question: questions,
    answer: [],
    authority: opts.proposedRecords,
    additional: [],
  };

  let probeCount = 0;

  const sendProbe = () => {
    opts.multicastInterface.send(probeMessage).then(() => {
      firstProbeSent = true;
      probeCount++;

      if (probeCount === 3) {
        promise.resolve("success");
        return;
      }

      const timer = setTimeout(() => {
        sendProbe();
      }, 250);

      probeTimers.push(timer);
    });
  };

  const firstProbeTimer = setTimeout(() => {
    sendProbe();
  }, untilFirstProbe);

  probeTimers.push(firstProbeTimer);

  return promise;
}

// Announce

/** Announce (unsolicited) the records we are claiming authority to.
 *
 * Returns a promise which resolves after two announcements have been broadcast.
 */
async function announce(opts: RespondOpts) {
  const additionalRecords = new Set<ResourceRecord>();

  for (const record of opts.proposedRecords) {
    if (!record.additional) {
      continue;
    }

    for (const additionalRecord of record.additional) {
      additionalRecords.add(additionalRecord);
    }
  }

  const announceMessage: DnsMessage = {
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
      ANCOUNT: opts.proposedRecords.length,
      NSCOUNT: 0,
      ARCOUNT: additionalRecords.size,
    },
    question: [],
    answer: opts.proposedRecords.map((record) => {
      return {
        ...record,
        isUnique: record.TYPE !== ResourceType.PTR,
      };
    }),
    authority: [],
    additional: Array.from(additionalRecords),
  };

  // Two announcements, one second apart.
  const announcePromise = deferred();

  await opts.multicastInterface.send(announceMessage);

  const secondAnnounceTimer = setTimeout(async () => {
    await opts.multicastInterface.send(announceMessage);
    announcePromise.resolve();
  }, 1000);

  opts.signal?.addEventListener("abort", () => {
    clearTimeout(secondAnnounceTimer);
  });

  return announcePromise;
}

// Conflict resolving stuff

/** Lexicographically compare two arrays of resource records */
function sortManyRecords(
  aRecords: ResourceRecord[],
  bRecords: ResourceRecord[],
) {
  const aSorted = aRecords.toSorted(recordSort);
  const bSorted = bRecords.toSorted(recordSort);

  for (let i = 0; i < Math.max(aSorted.length, bSorted.length); i++) {
    // This means b has more records than a, so b comes lexicographically later.
    if (i >= aRecords.length) {
      return -1;
    }

    const aRecord = aSorted[i];

    // This means a has more records than b, so a comes lexicographically later.
    if (i >= bSorted.length) {
      return 1;
    }

    const bRecord = bSorted[i];

    const result = recordSort(aRecord, bRecord);

    if (result === 0) {
      continue;
    } else if (result === 1) {
      return 1;
    } else {
      return -1;
    }
  }

  // Fun fact: if two peers have exactly the same set of records, this isn't a conflict, but indicates some fault-tolerant use of mDNS.
  return 0;
}

/** Compare two records to determine lexicographical order. */
export function recordSort(a: ResourceRecord, b: ResourceRecord): 1 | 0 | -1 {
  if (a.CLASS < b.CLASS) {
    return -1;
  } else if (a.CLASS > b.CLASS) {
    return 1;
  }

  if (a.TYPE < b.TYPE) {
    return -1;
  } else if (a.TYPE > b.TYPE) {
    return 1;
  }

  // Now we have to compare RDATA. Great. I didn't plan for this,
  // so RDATA is only in its decoded form here. We need to quickly re-encode it.
  // This might actually be better because the RDATA must be decompressed first.
  let rdataA: Uint8Array;
  let rdataB: Uint8Array;

  if (isResourceRecordA(a) && isResourceRecordA(b)) {
    rdataA = encodeRdataA(a);
    rdataB = encodeRdataA(b);
  } else if (isResourceRecordPTR(a) && isResourceRecordPTR(b)) {
    rdataA = encodeRdataPTR(a.RDATA);
    rdataB = encodeRdataPTR(b.RDATA);
  } else if (isResourceRecordTXT(a) && isResourceRecordTXT(b)) {
    rdataA = encodeRdataTXT(a.RDATA);
    rdataB = encodeRdataTXT(b.RDATA);
  } else if (isResourceRecordAAAA(a) && isResourceRecordAAAA(b)) {
    rdataA = encodeRdataAAAA(a.RDATA);
    rdataB = encodeRdataAAAA(b.RDATA);
  } else if (isResourceRecordSRV(a) && isResourceRecordSRV(b)) {
    rdataA = encodeRdataSRV(a);
    rdataB = encodeRdataSRV(b);
  } else if (isResourceRecordNSEC(a) && isResourceRecordNSEC(b)) {
    rdataA = encodeRdataNSEC(a);
    rdataB = encodeRdataNSEC(b);
  } else {
    rdataA = a.RDATA as Uint8Array;
    rdataB = b.RDATA as Uint8Array;
  }

  const aView = new DataView(rdataA.buffer);
  const bView = new DataView(rdataB.buffer);

  for (let i = 0; i < Math.max(rdataA.byteLength, rdataB.byteLength); i++) {
    if (i >= rdataA.byteLength) {
      return -1;
    }

    const aNum = aView.getUint8(i);

    if (i >= rdataB.byteLength) {
      return 1;
    }

    const bNum = bView.getUint8(i);

    if (aNum > bNum) {
      return 1;
    } else if (aNum < bNum) {
      return -1;
    }
  }

  return 0;
}

/** Checks if all records in a set of answers are unique */
function allAnswersAreUnique(answers: ResourceRecord[]) {
  let allAreUnique = true;

  for (const answer of answers) {
    if (!answer.isUnique) {
      allAreUnique = false;
    }
  }

  return allAreUnique;
}

/** Checks if a record set answers *all* of the given questions */
function canAnswerAllQuestions(
  questions: DnsQuestionSection[],
  answers: ResourceRecord[],
): boolean {
  let canAnswerAllQuestions = true;

  for (const question of questions) {
    for (const record of answers) {
      const isRightType = record.TYPE === question.QTYPE ||
        question.QTYPE === ResourceType.ANY;
      const isRightName = record.NAME.join(".").toUpperCase() ===
        question.QNAME.join(".").toUpperCase();

      if ((isRightType && isRightName) === false) {
        canAnswerAllQuestions = false;
      }
    }
  }

  return canAnswerAllQuestions;
}

/** Checks if *any* of the given unique answers answer any of the given questions. */
function hasAnyUniqueAnswersForQuestions(
  questions: DnsQuestionSection[],
  answers: ResourceRecord[],
): boolean {
  for (const question of questions) {
    for (const record of answers) {
      const isRightType = record.TYPE === question.QTYPE ||
        question.QTYPE === ResourceType.ANY;
      const isRightName = record.NAME.join(".").toUpperCase() ===
        question.QNAME.join(".").toUpperCase();

      if (isRightType && isRightName && record.isUnique) {
        return true;
      }
    }
  }

  return false;
}

function isProbingForRecords(
  questions: DnsQuestionSection[],
  records: ResourceRecord[],
): boolean {
  for (const record of records) {
    if (record.isUnique === false) {
      continue;
    }

    for (const question of questions) {
      const isRightType = record.TYPE === question.QTYPE ||
        question.QTYPE === ResourceType.ANY;
      const isRightName = record.NAME.join(".").toUpperCase() ===
        question.QNAME.join(".").toUpperCase();

      if (isRightType && isRightName) {
        return true;
      }
    }
  }

  return false;
}

function getTieBreakerQuestions(
  ourRecords: ResourceRecord[],
  theirRecords: ResourceRecord[],
): {
  ourTieBreakers: ResourceRecord[];
  theirTieBreakers: ResourceRecord[];
} {
  // compare their records with ours

  // our tiebreakers should be ones that conflict with theirs
  // theirs should be ones that conflict with ours.

  // each record should appear only once...

  const ourTieBreakers = new Set<ResourceRecord>();
  const theirTieBreakers = new Set<ResourceRecord>();

  for (const ourRecord of ourRecords) {
    for (const theirRecord of theirRecords) {
      if (ourRecord.isUnique === false || theirRecord.isUnique === false) {
        continue;
      }

      const isSameType = ourRecord.TYPE === theirRecord.TYPE;
      const isSameName = ourRecord.NAME.join(".").toUpperCase() ===
        theirRecord.NAME.join(".").toUpperCase();

      if (isSameType && isSameName) {
        ourTieBreakers.add(ourRecord);
        theirTieBreakers.add(theirRecord);
      }
    }
  }

  return {
    ourTieBreakers: Array.from(ourTieBreakers),
    theirTieBreakers: Array.from(theirTieBreakers),
  };
}

/** Checks if two records conflict with each other.
 *
 * This is when the have the same name and type, but different RDATA.
 */
export function isConflicting(a: ResourceRecord, b: ResourceRecord) {
  if (a.isUnique === false || b.isUnique === false) {
    return false;
  }

  const isSameType = a.TYPE === b.TYPE;

  if (isSameType === false) {
    return false;
  }

  const isSameName = a.NAME.join(".").toUpperCase() ===
    b.NAME.join(".").toUpperCase();

  if (isSameName === false) {
    return false;
  }

  // Records conflict if they have the same name and type but different RDATA.
  const order = recordSort(a, b);

  if (order === 0) {
    return false;
  }

  return true;
}

/** Return all unique names from a set of records */
function desiredNamesFromRecords(records: ResourceRecord[]): string[][] {
  const allNames = [];
  const seenNames = new Set<string>();

  for (const record of records) {
    if (!seenNames.has(record.NAME.join("."))) {
      allNames.push(record.NAME);
    }

    seenNames.add(record.NAME.join("."));
  }

  return allNames;
}

// Slightly different encoding methods (which do not support decompression)
// Which are only used to compare RDATA.
// Duplication over over-abstraction, man

function encodeRdataPTR(
  labelSeq: string[],
): Uint8Array {
  return encodeLabelSequence(labelSeq);
}

function encodeRdataSRV(
  record: ResourceRecordSRV,
): Uint8Array {
  const srvBytes = new Uint8Array(6);
  const srvView = new DataView(srvBytes.buffer);

  srvView.setUint16(0, record.RDATA.priority);
  srvView.setUint16(2, record.RDATA.weight);
  srvView.setUint16(4, record.RDATA.port);

  const labelBytes = encodeLabelSequence(record.NAME);

  return concat(srvBytes, labelBytes);
}

function encodeRdataNSEC(
  record: ResourceRecordNSEC,
): Uint8Array {
  const labelBytes = encodeLabelSequence(
    record.NAME,
  );

  const maskLength = record.RDATA.types.length
    ? Math.ceil(Math.max(...record.RDATA.types) / 8)
    : 0;

  const masks = Array(maskLength).fill(0);

  for (const type of record.RDATA.types) {
    const index = ~~(type / 8); // which mask this rrtype is on
    const bit = 7 - type % 8; // convert to network bit order

    masks[index] |= 1 << bit;
  }

  const maskBytes = new Uint8Array(2 + maskLength);
  const maskView = new DataView(maskBytes.buffer);

  maskView.setUint8(0, 0);
  maskView.setUint8(1, maskLength);

  for (let i = 0; i < masks.length; i++) {
    const mask = masks[i];

    maskView.setUint8(i + 2, mask);
  }

  return concat(labelBytes, maskBytes);
}

function encodeLabelSequence(
  /** The label sequence to be encoded. */
  labelSequence: string[],
): Uint8Array {
  if (labelSequence.length === 0) {
    // TODO: handle 0-length string
  }

  /** How long all of the labels in this sequence will be in bytes */
  const labelsLength = labelSequence.reduce((prev, next) => {
    // Add an extra 1 for the length byte
    return prev + 1 + next.length;
  }, 0);

  /** The length of a pointer in bytes */
  const pointerLength = 0;
  /** The length of the terminator, if present */
  const terminatorLength = 1;

  const bytes = new Uint8Array(labelsLength + pointerLength + terminatorLength);
  const dataView = new DataView(bytes.buffer);

  let position = 0;

  for (let i = 0; i < labelSequence.length; i++) {
    const label = labelSequence[i];

    // First byte is length
    dataView.setUint8(position, label.length);

    position += 1;

    // Followed by label characters
    for (let charIdx = 0; charIdx < label.length; charIdx++) {
      dataView.setUint8(position, label[charIdx].charCodeAt(0));
      position += 1;
    }
  }

  dataView.setUint8(position, 0);

  return bytes;
}
