import { walk } from "@std/fs";
import { assertEquals } from "@std/assert";
import { decodeMessage } from "../src/decode/message_decode.ts";
import { encodeMessage } from "../src/decode/message_encode.ts";
import { ResourceRecord } from "../src/decode/types.ts";

function assertEqualResourceRecords(
  actual: ResourceRecord[],
  expected: ResourceRecord[],
) {
  assertEquals(actual.length, expected.length);

  for (let i = 0; i < actual.length; i++) {
    assertEquals(actual[i].NAME, expected[i].NAME);
    assertEquals(actual[i].CLASS, expected[i].CLASS);
    assertEquals(actual[i].TYPE, expected[i].TYPE);
    assertEquals(actual[i].TTL, expected[i].TTL);
    // RDLENGTH is allowed to mismatch as we may have compressed it.
    assertEquals(actual[i].RDATA, expected[i].RDATA);
  }
}

Deno.test("Encode message", async (test) => {
  for await (const entry of walk("./test/packets")) {
    await test.step(entry.name, async () => {
      if (entry.isFile) {
        const packet = await Deno.readFile(entry.path);

        const decoded = decodeMessage(packet);

        const encoded = encodeMessage(decoded);
        const decodedAgain = decodeMessage(encoded);

        assertEquals(decodedAgain.header, decoded.header);
        assertEquals(decodedAgain.question, decoded.question);

        assertEqualResourceRecords(decodedAgain.answer, decoded.answer);
        assertEqualResourceRecords(decodedAgain.authority, decoded.authority);
        assertEqualResourceRecords(decodedAgain.additional, decoded.additional);
      }
    });
  }
});
