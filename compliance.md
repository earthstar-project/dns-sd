# mDNS

## SHOULD

- When a Multicast DNS querier receives an answer, the answer contains a TTL
  value that indicates for how many seconds this answer is valid. After this
  interval has passed, the answer will no longer be valid and SHOULD be deleted
  from the cache. Before the record expiry time is reached, a Multicast DNS
  querier that has local clients with an active interest in the state of that
  record (e.g., a network browsing window displaying a list of discovered
  services to the user) SHOULD reissue its query to determine whether the record
  is still valid.

## MAY

- DNS queries for names that do not end with ".local." MAY be sent to the mDNS
  multicast address, if no other conventional DNS server is available.
- On receipt of a question for a particular name, rrtype, and rrclass, for which
  a responder does have one or more unique answers, the responder MAY also
  include an NSEC record in the Additional Record Section indicating the
  nonexistence of other rrtypes for that name and rrclass.
- Implementers working with devices with sufficient memory and CPU resources MAY
  choose to implement code to handle the full generality of the DNS NSEC record
  [RFC4034], including bitmaps up to 65,536 bits long. To facilitate use by
  devices with limited memory and CPU resources, Multicast DNS queriers are only
  REQUIRED to be able to parse a restricted form of the DNS NSEC record.

## MUST

- Except in the rare case of a Multicast DNS responder that is advertising only
  shared resource records and no unique records, a Multicast DNS responder MUST
  also implement a Multicast DNS querier so that it can first verify the
  uniqueness of those records before it begins answering queries for them.
- Therefore, when retransmitting Multicast DNS queries to implement this kind of
  continuous monitoring, the interval between the first two queries MUST be at
  least one second, the intervals between successive queries MUST increase by at
  least a factor of two, and the querier MUST implement Known-Answer
  Suppression, as described below in section 7.1
- For example, a host with no IPv6 address, that has claimed sole ownership of
  the name "host.local." for all rrtypes, MUST respond to AAAA queries for
  "host.local." by sending a negative answer indicating that no AAAA records
  exist for that name.
- Any time a responder receives a query for a name for which it has verified
  exclusive ownership, for a type for which that name has no records, the
  responder MUST (except as allowed in (a) below) respond asserting the
  nonexistence of that record using a DNS NSEC record [RFC4034]. In the case of
  Multicast DNS the NSEC record is not being used for its usual DNSSEC [RFC4033]
  security properties, but simply as a way of expressing which records do or do
  not exist with a given name.

## MUST NOT

- A Multicast DNS responder MUST NOT place records from its cache, which have
  been learned from other responders on the network, in the Resource Record
  Sections of outgoing response messages. Only an authoritative source for a
  given record is allowed to issue responses containing that record.
