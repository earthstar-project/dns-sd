// Probing stuff

Deno.test("Probes for the record it wishes to be unique for", () => {});
Deno.test("Waits 0 - 250ms to send the first probe", () => {});
Deno.test("Sends a probe packet every 250ms, three times only", () => {});
Deno.test("If a conflicting response is received after querying, choose new resource record names", () => {});
Deno.test("If there are fifteen conflicts within ten seconds, wait five seconds before each successive probe attempt", () => {});
Deno.test("Populates authority section with record(s) it is proposing to use", () => {});
Deno.test("If another host is probing for the same record, and they win, probe again in one second", () => {});
Deno.test("If another host is probing for the same record, and they win, start announcing", () => {});
Deno.test("Switches to announcing after three unanswered probes sent", () => {});

// Announcing

Deno.test("Switches to announcing after three unanswered probes sent", () => {});
Deno.test("Places claimed records in the answers section of the response", () => {});
Deno.test("Sets the cache-flush bit on records verified unique", () => {});

// Conflict resolution
Deno.test("Switches back to probing phase if a response is seen with a conflicting record", () => {});

// Responding

Deno.test("Responds with own records when a qualifying query is received", () => {});
Deno.test("Responds when it authoritatively knows a record does not exist", () => {});
Deno.test("Responds immediately to queries where ALL answers are unique", () => {});
Deno.test("Delays response by 20 - 120ms if some answers are shared resources", () => {});
Deno.test("Sets a TTL of 120 for A, AAAA, SRV, or reverse-mapping PTR records", () => {});
Deno.test("Does not assert non-existence of records it cannot know about", () => {
  // IPv6 interface cannot refute existence of A address.
});
Deno.test("Aggregates as many responses as possible into a single multicast DNS message", () => {});
Deno.test("Responds to ANY type queries with ALL matching records.", () => {});

// Resolving conflicts

Deno.test("Resolves conflicts when any conflicting responses from other hosts are seen", () => {});
Deno.test("Announces a record if it sees another host announce that same record with a TTL less than half of our own record", () => {});

// Says goodbye

Deno.test("Sends a goodbye packet when it is being shut down", () => {});

// Resumes gracefully
// How can we even tell that we were disconnected, reconnected?

Deno.test("Switches to probing after being resumed", () => {});
Deno.test("Announces unique records with cache-flush bit set after resuming and successful probe", () => {});
